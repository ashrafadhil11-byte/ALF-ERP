-- 025 — Loyalty points.
--  • Earn: every receipt on a customer's invoice earns points = amount × rate for that currency × tier bonus
--    (default 1 point per OMR 1; currencies without a rate earn nothing). Voiding the receipt takes them back.
--  • Tier: by points earned in the last 12 months (Silver / Gold / Platinum, bonus 0 / 25 / 50 %). Settings editable.
--  • Spend: points pay part of an invoice (default 100 points = OMR 1). Books: Dr 5800 Loyalty discounts, Cr 1100.
--    Voiding the invoice gives the points back. Merging customers moves their points.

insert into public.accounts (code, name, type, is_system, active) values ('5800', 'Loyalty discounts', 'expense', true, true)
on conflict (code) do nothing;

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
    'invoice', 'payment', 'expense', 'manual', 'closing', 'void', 'purchase', 'supplier_payment', 'stock', 'cost', 'internal', 'transfer', 'loyalty'));

create table if not exists public.loyalty_settings (
    id          integer primary key default 1 check (id = 1),
    active      boolean not null default true,
    earn_rate   jsonb not null default '{"OMR": 1}',         -- points per 1 unit of currency received
    point_value jsonb not null default '{"OMR": 0.01}',      -- what 1 point is worth when spent
    min_redeem  integer not null default 100,
    tiers       jsonb not null default '[{"name":"Silver","min":0,"bonus":0},{"name":"Gold","min":300,"bonus":25},{"name":"Platinum","min":1000,"bonus":50}]',
    updated_at  timestamptz not null default now(),
    updated_by  text
);
insert into public.loyalty_settings (id) values (1) on conflict (id) do nothing;
alter table public.loyalty_settings enable row level security;

create table if not exists public.loyalty_ledger (
    id          bigserial primary key,
    customer_id bigint not null references public.customers (id),
    kind        text not null check (kind in ('earn', 'redeem', 'reverse', 'adjust')),
    points      integer not null check (points <> 0),
    currency    text,
    amount      numeric(14,3),                 -- money behind the points (receipt amount, or discount value)
    payment_id  bigint references public.payments (id),
    invoice_id  bigint references public.invoices (id),
    reverses    bigint references public.loyalty_ledger (id),
    note        text,
    created_at  timestamptz not null default now(),
    created_by_name text
);
create index if not exists loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id, created_at desc);
create index if not exists loyalty_ledger_payment_idx on public.loyalty_ledger (payment_id);
create index if not exists loyalty_ledger_invoice_idx on public.loyalty_ledger (invoice_id);
alter table public.loyalty_ledger enable row level security;

-- balance, points earned in the last 12 months, tier, and what the balance is worth
create or replace function public.loyalty_status(p_customer bigint)
returns jsonb language sql stable set search_path to 'public' as $$
    with s as (select * from public.loyalty_settings where id = 1),
    b as (select coalesce(sum(points), 0)::int bal,
                 coalesce(sum(points) filter (where kind in ('earn', 'reverse') and created_at > now() - interval '12 months'), 0)::int yr
          from public.loyalty_ledger where customer_id = p_customer),
    t as (select x from s, jsonb_array_elements(s.tiers) x, b where (x->>'min')::int <= greatest(b.yr, 0)
          order by (x->>'min')::int desc limit 1),
    nxt as (select x from s, jsonb_array_elements(s.tiers) x, b where (x->>'min')::int > greatest(b.yr, 0)
            order by (x->>'min')::int limit 1)
    select jsonb_build_object('active', s.active, 'balance', b.bal, 'year_points', b.yr,
        'tier', coalesce((select x->>'name' from t), 'Member'), 'bonus', coalesce((select (x->>'bonus')::numeric from t), 0),
        'next_tier', (select x->>'name' from nxt), 'next_at', (select (x->>'min')::int from nxt),
        'point_value', s.point_value, 'min_redeem', s.min_redeem, 'earn_rate', s.earn_rate)
    from s, b;
$$;

-- earn on a receipt for a customer's invoice
create or replace function public.loyalty_on_payment() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_cust bigint; s public.loyalty_settings%rowtype; v_rate numeric; v_bonus numeric; v_pts integer;
begin
    if new.invoice_id is null then return new; end if;
    select * into s from public.loyalty_settings where id = 1;
    if not found or not s.active then return new; end if;
    v_rate := nullif(s.earn_rate->>upper(new.currency), '')::numeric;
    if coalesce(v_rate, 0) <= 0 then return new; end if;
    select customer_id into v_cust from public.invoices where id = new.invoice_id;
    if v_cust is null or exists (select 1 from public.customers where id = v_cust and blocked) then return new; end if;
    v_bonus := coalesce((public.loyalty_status(v_cust)->>'bonus')::numeric, 0);
    v_pts := floor(new.amount * v_rate * (1 + v_bonus / 100));
    if v_pts > 0 then
        insert into public.loyalty_ledger (customer_id, kind, points, currency, amount, payment_id, invoice_id, note, created_by_name)
        values (v_cust, 'earn', v_pts, upper(new.currency), new.amount, new.id, new.invoice_id, new.receipt_no, new.received_by_name);
    end if;
    return new;
end $$;
drop trigger if exists loyalty_on_payment on public.payments;
create trigger loyalty_on_payment after insert on public.payments for each row execute function public.loyalty_on_payment();

-- a voided receipt takes its points back
create or replace function public.loyalty_on_payment_void() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    if new.void and not old.void then
        insert into public.loyalty_ledger (customer_id, kind, points, currency, amount, payment_id, invoice_id, reverses, note, created_by_name)
        select l.customer_id, 'reverse', -l.points, l.currency, l.amount, l.payment_id, l.invoice_id, l.id, 'Void ' || new.receipt_no, 'system'
        from public.loyalty_ledger l
        where l.payment_id = new.id and l.kind = 'earn' and not exists (select 1 from public.loyalty_ledger r where r.reverses = l.id);
    end if;
    return new;
end $$;
drop trigger if exists loyalty_on_payment_void on public.payments;
create trigger loyalty_on_payment_void after update of void on public.payments for each row execute function public.loyalty_on_payment_void();

-- spend points on an invoice (capped at the balance due); returns what was used
create or replace function public.loyalty_redeem(p_invoice_id bigint, p_points integer, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare i public.invoices%rowtype; s public.loyalty_settings%rowtype; v_val numeric; v_pts integer; v_bal integer; v_amt numeric; v_id bigint;
begin
    select * into s from public.loyalty_settings where id = 1;
    if not s.active then raise exception 'Loyalty points are switched off.'; end if;
    select * into i from public.invoices where id = p_invoice_id for update;
    if not found then raise exception 'Invoice not found.'; end if;
    if i.status = 'void' then raise exception '% is void.', i.invoice_no; end if;
    if i.customer_id is null then raise exception 'This invoice has no customer.'; end if;
    v_val := nullif(s.point_value->>i.currency, '')::numeric;
    if coalesce(v_val, 0) <= 0 then raise exception 'Points cannot be used for % invoices.', i.currency; end if;
    perform 1 from public.customers where id = i.customer_id for update;          -- one redemption at a time per customer
    select coalesce(sum(points), 0) into v_bal from public.loyalty_ledger where customer_id = i.customer_id;
    v_pts := least(coalesce(p_points, 0), v_bal, floor((i.total - i.paid) / v_val)::int);
    if v_pts < s.min_redeem then raise exception 'At least % points are needed (customer has %, invoice allows %).', s.min_redeem, v_bal, floor((i.total - i.paid) / v_val)::int; end if;
    v_amt := round(v_pts * v_val, 3);
    insert into public.loyalty_ledger (customer_id, kind, points, currency, amount, invoice_id, note, created_by_name)
    values (i.customer_id, 'redeem', -v_pts, i.currency, v_amt, i.id, 'Paid on ' || i.invoice_no, p_user_name)
    returning id into v_id;
    perform public.post_journal(current_date, i.branch_code, i.currency, 'loyalty', v_id, i.invoice_no || ' paid with ' || v_pts || ' points', p_user_name,
        jsonb_build_array(jsonb_build_object('account', '5800', 'debit', v_amt), jsonb_build_object('account', '1100', 'credit', v_amt)));
    update public.invoices set paid = paid + v_amt, status = case when paid + v_amt >= total then 'paid' else 'partial' end where id = i.id;
    return jsonb_build_object('points', v_pts, 'amount', v_amt, 'currency', i.currency, 'invoice_no', i.invoice_no);
end $$;

-- a voided invoice gives back the points spent on it (the discount entry is reversed too)
create or replace function public.loyalty_on_invoice_void() returns trigger
language plpgsql set search_path to 'public' as $$
declare l public.loyalty_ledger%rowtype;
begin
    if new.status = 'void' and old.status <> 'void' then
        for l in select * from public.loyalty_ledger x where x.invoice_id = new.id and x.kind = 'redeem'
                   and not exists (select 1 from public.loyalty_ledger r where r.reverses = x.id) loop
            insert into public.loyalty_ledger (customer_id, kind, points, currency, amount, invoice_id, reverses, note, created_by_name)
            values (l.customer_id, 'reverse', -l.points, l.currency, l.amount, l.invoice_id, l.id, 'Void ' || new.invoice_no, 'system');
            perform public.reverse_journal('loyalty', l.id, 'system', 'Void ' || new.invoice_no || ': points given back');
        end loop;
    end if;
    return new;
end $$;
drop trigger if exists loyalty_on_invoice_void on public.invoices;
create trigger loyalty_on_invoice_void after update of status on public.invoices for each row execute function public.loyalty_on_invoice_void();

-- merged customers: points move to the one kept
create or replace function public.loyalty_on_merge() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    if new.merged_into is not null and old.merged_into is distinct from new.merged_into then
        update public.loyalty_ledger set customer_id = new.merged_into where customer_id = new.id;
    end if;
    return new;
end $$;
drop trigger if exists loyalty_on_merge on public.customers;
create trigger loyalty_on_merge after update of merged_into on public.customers for each row execute function public.loyalty_on_merge();

revoke all on function public.loyalty_redeem(bigint, integer, text) from public, anon, authenticated;
revoke all on function public.loyalty_status(bigint) from public, anon, authenticated;
