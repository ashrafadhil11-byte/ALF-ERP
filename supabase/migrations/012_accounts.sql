-- 012 — Phase C: Accounts.
-- Every money event posts a balanced double-entry journal in the branch's own currency.
-- Reports are per currency (no conversion). Tax is supported but off by default (branch tax_rate = 0).
-- Access: service role only through /api/accounts (role rules live in the API).

-- ---------------------------------------------------------------
-- 0. No VAT for now: invoices use the branch tax rate, so default it to 0
-- ---------------------------------------------------------------
alter table public.branches alter column tax_rate set default 0;
update public.branches set tax_rate = 0 where tax_rate = 5;   -- the old placeholder default

-- ---------------------------------------------------------------
-- 1. Chart of accounts
-- ---------------------------------------------------------------
create table if not exists public.accounts (
    code      text primary key,
    name      text not null,
    type      text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
    is_system boolean not null default false,   -- used by automatic postings: can rename, can't deactivate
    active    boolean not null default true,
    constraint accounts_system_active_ck check (not is_system or active)
);
alter table public.accounts enable row level security;
insert into public.accounts (code, name, type, is_system) values
 ('1000', 'Cash on hand',               'asset',     true),
 ('1010', 'Card / POS clearing',        'asset',     true),
 ('1020', 'Bank',                       'asset',     true),
 ('1100', 'Accounts receivable',        'asset',     true),
 ('2000', 'Accounts payable',           'liability', true),
 ('2100', 'Tax payable',                'liability', true),
 ('3000', 'Owner''s equity',            'equity',    true),
 ('3900', 'Cash over / short',          'equity',    true),
 ('4000', 'Freight income',             'income',    true),
 ('4010', 'Other income',               'income',    false),
 ('5000', 'Carrier / agent charges',    'expense',   false),
 ('5100', 'Salaries & wages',           'expense',   false),
 ('5200', 'Rent',                       'expense',   false),
 ('5300', 'Fuel & local transport',     'expense',   false),
 ('5400', 'Utilities & phone',          'expense',   false),
 ('5500', 'Office & packing supplies',  'expense',   false),
 ('5600', 'Customs & clearance',        'expense',   false),
 ('5900', 'Other expenses',             'expense',   false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------
-- 2. Journal
-- ---------------------------------------------------------------
create table if not exists public.journal_entries (
    id              bigserial primary key,
    entry_date      date not null default current_date,
    branch_code     text not null,
    currency        text not null,
    source          text not null check (source in ('invoice', 'payment', 'expense', 'manual', 'closing', 'void')),
    source_id       bigint,
    memo            text,
    created_at      timestamptz not null default now(),
    created_by_name text
);
create table if not exists public.journal_lines (
    id           bigserial primary key,
    entry_id     bigint not null references public.journal_entries(id) on delete cascade,
    account_code text not null references public.accounts(code),
    debit        numeric(14,3) not null default 0 check (debit >= 0),
    credit       numeric(14,3) not null default 0 check (credit >= 0),
    note         text,
    check (debit = 0 or credit = 0)
);
create index if not exists journal_entries_idx on public.journal_entries (branch_code, currency, entry_date);
create index if not exists journal_lines_entry_idx on public.journal_lines (entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines (account_code);
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

-- Posts one balanced entry. p_lines = [{ "account": "1000", "debit": 5, "credit": 0, "note": "…" }, …]
create or replace function public.post_journal(
    p_date date, p_branch text, p_currency text, p_source text, p_source_id bigint, p_memo text, p_user_name text, p_lines jsonb
) returns bigint
language plpgsql set search_path = public as $$
declare
    v_id bigint; v_dr numeric := 0; v_cr numeric := 0; v_line jsonb;
begin
    if coalesce(trim(p_currency), '') = '' then raise exception 'Currency is required.'; end if;
    for v_line in select * from jsonb_array_elements(p_lines) loop
        if not exists (select 1 from public.accounts where code = v_line->>'account' and active) then
            raise exception 'Unknown or inactive account %.', v_line->>'account';
        end if;
        v_dr := v_dr + round(coalesce((v_line->>'debit')::numeric, 0), 3);
        v_cr := v_cr + round(coalesce((v_line->>'credit')::numeric, 0), 3);
    end loop;
    if v_dr <= 0 or v_dr <> v_cr then raise exception 'Journal does not balance (debit %, credit %).', v_dr, v_cr; end if;
    insert into public.journal_entries (entry_date, branch_code, currency, source, source_id, memo, created_by_name)
    values (coalesce(p_date, current_date), p_branch, upper(p_currency), p_source, p_source_id, p_memo, p_user_name)
    returning id into v_id;
    insert into public.journal_lines (entry_id, account_code, debit, credit, note)
    select v_id, l->>'account', round(coalesce((l->>'debit')::numeric, 0), 3), round(coalesce((l->>'credit')::numeric, 0), 3), l->>'note'
    from jsonb_array_elements(p_lines) l
    where round(coalesce((l->>'debit')::numeric, 0), 3) > 0 or round(coalesce((l->>'credit')::numeric, 0), 3) > 0;
    return v_id;
end;
$$;

-- Reverses every journal posted for a document (used by void)
create or replace function public.reverse_journal(p_source text, p_source_id bigint, p_user_name text, p_memo text)
returns void language plpgsql set search_path = public as $$
declare e public.journal_entries%rowtype;
begin
    for e in select * from public.journal_entries where source = p_source and source_id = p_source_id loop
        perform public.post_journal(current_date, e.branch_code, e.currency, 'void', e.id, p_memo, p_user_name,
            (select jsonb_agg(jsonb_build_object('account', account_code, 'debit', credit, 'credit', debit)) from public.journal_lines where entry_id = e.id));
    end loop;
end;
$$;

-- ---------------------------------------------------------------
-- 3. Document numbers: INV-<branch>-000001, RCT-…, EXP-… (per branch, never reset)
-- ---------------------------------------------------------------
create table if not exists public.doc_counters (
    branch_code text not null,
    kind        text not null,
    last_no     bigint not null default 0,
    primary key (branch_code, kind)
);
alter table public.doc_counters enable row level security;
create or replace function public.next_doc_no(p_branch text, p_kind text) returns text
language sql set search_path = public as $$
    insert into public.doc_counters (branch_code, kind, last_no) values (p_branch, p_kind, 1)
    on conflict (branch_code, kind) do update set last_no = doc_counters.last_no + 1
    returning p_kind || '-' || p_branch || '-' || lpad(last_no::text, 6, '0');
$$;

-- ---------------------------------------------------------------
-- 4. Rate cards (branch + destination + cargo; '*' = any)
-- ---------------------------------------------------------------
create table if not exists public.rate_cards (
    id                bigserial primary key,
    branch_code       text not null,
    dest_country_code text not null default '*',
    cargo_type_code   text not null default '*',
    method            text not null check (method in ('per_kg', 'vol_band', 'per_package', 'per_box')),
    currency          text not null,
    rate              numeric(14,3) not null default 0,     -- per kg / per package / per box
    min_charge        numeric(14,3) not null default 0,
    bands             jsonb not null default '[]',          -- vol_band: [{ "upto": 10, "price": 15 }, …] (kg, ascending)
    extra_per_kg      numeric(14,3) not null default 0,     -- vol_band: price per kg above the last band
    note              text,
    active            boolean not null default true,
    updated_at        timestamptz not null default now(),
    updated_by_name   text,
    unique (branch_code, dest_country_code, cargo_type_code)
);
alter table public.rate_cards enable row level security;

-- ---------------------------------------------------------------
-- 5. Invoices, payments, expenses, cash closing
-- ---------------------------------------------------------------
create table if not exists public.invoices (
    id              bigserial primary key,
    invoice_no      text not null unique,
    branch_code     text not null,
    booking_id      uuid references public.bookings(id) on delete set null,
    awb             text,
    customer_name   text,
    customer_phone  text,
    currency        text not null,
    lines           jsonb not null default '[]',   -- [{ description, qty, rate, amount }]
    subtotal        numeric(14,3) not null,
    tax_rate        numeric(6,3) not null default 0,
    tax             numeric(14,3) not null default 0,
    total           numeric(14,3) not null,
    paid            numeric(14,3) not null default 0,
    balance         numeric(14,3) generated always as (total - paid) stored,
    status          text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'void')),
    terms           text not null default 'cash' check (terms in ('cash', 'credit', 'pay_on_delivery')),
    issued_at       timestamptz not null default now(),
    due_date        date,
    notes           text,
    created_by_name text,
    void_reason     text,
    voided_at       timestamptz
);
create index if not exists invoices_branch_idx on public.invoices (branch_code, issued_at desc);
create index if not exists invoices_open_idx on public.invoices (branch_code, customer_phone) where status in ('unpaid', 'partial');
create unique index if not exists invoices_one_per_booking on public.invoices (booking_id) where status <> 'void';
alter table public.invoices enable row level security;

create table if not exists public.payments (
    id               bigserial primary key,
    receipt_no       text not null unique,
    invoice_id       bigint references public.invoices(id),
    branch_code      text not null,
    currency         text not null,
    amount           numeric(14,3) not null check (amount > 0),
    method           text not null check (method in ('cash', 'card', 'bank')),
    reference        text,
    customer_name    text,
    customer_phone   text,
    received_at      timestamptz not null default now(),
    received_by_name text,
    void             boolean not null default false,
    void_reason      text
);
create index if not exists payments_branch_idx on public.payments (branch_code, received_at desc);
alter table public.payments enable row level security;

create table if not exists public.expenses (
    id              bigserial primary key,
    expense_no      text not null unique,
    branch_code     text not null,
    account_code    text not null references public.accounts(code),
    currency        text not null,
    amount          numeric(14,3) not null check (amount > 0),
    method          text not null check (method in ('cash', 'card', 'bank', 'payable')),
    paid_to         text,
    reference       text,
    expense_date    date not null default current_date,
    notes           text,
    created_by_name text,
    void            boolean not null default false,
    void_reason     text
);
create index if not exists expenses_branch_idx on public.expenses (branch_code, expense_date desc);
alter table public.expenses enable row level security;

create table if not exists public.cash_closings (
    id             bigserial primary key,
    branch_code    text not null,
    currency       text not null,
    close_date     date not null,
    opening        numeric(14,3) not null default 0,
    cash_in        numeric(14,3) not null default 0,
    cash_out       numeric(14,3) not null default 0,
    expected       numeric(14,3) not null,
    counted        numeric(14,3) not null,
    difference     numeric(14,3) generated always as (counted - expected) stored,
    notes          text,
    closed_at      timestamptz not null default now(),
    closed_by_name text,
    unique (branch_code, currency, close_date)
);
alter table public.cash_closings enable row level security;

-- method → cash-type account
create or replace function public.cash_account(p_method text) returns text
language sql immutable set search_path = public as $$ select case p_method when 'cash' then '1000' when 'card' then '1010' when 'bank' then '1020' when 'payable' then '2000' end $$;

-- ---------------------------------------------------------------
-- 6. Invoice / payment / expense / closing functions
-- ---------------------------------------------------------------
create or replace function public.payment_record(
    p_invoice_id bigint, p_amount numeric, p_method text, p_reference text, p_user_name text, p_branch text default null,
    p_currency text default null, p_customer_name text default null, p_customer_phone text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
    i public.invoices%rowtype; v_no text; v_id bigint; v_amt numeric := round(p_amount, 3); v_branch text; v_cur text;
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if p_method not in ('cash', 'card', 'bank') then raise exception 'Payment method must be cash, card or bank.'; end if;
    if p_invoice_id is not null then
        select * into i from public.invoices where id = p_invoice_id for update;
        if not found then raise exception 'Invoice not found.'; end if;
        if i.status = 'void' then raise exception 'Invoice % is void.', i.invoice_no; end if;
        if v_amt > i.total - i.paid then raise exception 'Amount is more than the balance due (% %).', i.currency, i.total - i.paid; end if;
        v_branch := i.branch_code; v_cur := i.currency;
    else
        v_branch := p_branch; v_cur := upper(p_currency);   -- advance / on-account receipt
    end if;
    v_no := public.next_doc_no(v_branch, 'RCT');
    insert into public.payments (receipt_no, invoice_id, branch_code, currency, amount, method, reference, customer_name, customer_phone, received_by_name)
    values (v_no, p_invoice_id, v_branch, v_cur, v_amt, p_method, nullif(trim(p_reference), ''),
            coalesce(i.customer_name, p_customer_name), coalesce(i.customer_phone, p_customer_phone), p_user_name)
    returning id into v_id;
    perform public.post_journal(current_date, v_branch, v_cur, 'payment', v_id,
        v_no || coalesce(' for ' || i.invoice_no, ' on account'), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', public.cash_account(p_method), 'debit', v_amt),
            jsonb_build_object('account', '1100', 'credit', v_amt)));
    if p_invoice_id is not null then
        update public.invoices set paid = paid + v_amt,
            status = case when paid + v_amt >= total then 'paid' else 'partial' end
        where id = p_invoice_id;
    end if;
    return jsonb_build_object('id', v_id, 'receipt_no', v_no, 'amount', v_amt, 'currency', v_cur);
end;
$$;

-- p_lines: [{ description, qty, rate }]; amount = qty × rate. Tax from p_tax_rate (0 = none).
-- p_pay_method cash|card|bank → paid now (receipt created); credit|pay_on_delivery → left as balance due.
create or replace function public.invoice_create(
    p_branch text, p_booking_id uuid, p_awb text, p_customer_name text, p_customer_phone text, p_currency text,
    p_lines jsonb, p_tax_rate numeric, p_pay_method text, p_due_days integer, p_notes text, p_user_name text
) returns jsonb
language plpgsql set search_path = public as $$
declare
    v_lines jsonb; v_sub numeric; v_tax numeric; v_total numeric; v_no text; v_id bigint; v_terms text; v_pay jsonb;
begin
    select jsonb_agg(jsonb_build_object(
               'description', coalesce(nullif(trim(l->>'description'), ''), 'Charge'),
               'qty', coalesce((l->>'qty')::numeric, 1),
               'rate', round(coalesce((l->>'rate')::numeric, 0), 3),
               'amount', round(coalesce((l->>'qty')::numeric, 1) * coalesce((l->>'rate')::numeric, 0), 3))),
           sum(round(coalesce((l->>'qty')::numeric, 1) * coalesce((l->>'rate')::numeric, 0), 3))
      into v_lines, v_sub
      from jsonb_array_elements(coalesce(p_lines, '[]')) l;
    if coalesce(v_sub, 0) <= 0 then raise exception 'The invoice total must be above zero.'; end if;
    v_tax := round(v_sub * coalesce(p_tax_rate, 0) / 100, 3);
    v_total := v_sub + v_tax;
    v_terms := case when p_pay_method in ('credit', 'pay_on_delivery') then p_pay_method else 'cash' end;
    v_no := public.next_doc_no(p_branch, 'INV');
    insert into public.invoices (invoice_no, branch_code, booking_id, awb, customer_name, customer_phone, currency, lines,
                                 subtotal, tax_rate, tax, total, terms, due_date, notes, created_by_name)
    values (v_no, p_branch, p_booking_id, nullif(upper(trim(p_awb)), ''), nullif(trim(p_customer_name), ''), nullif(trim(p_customer_phone), ''),
            upper(p_currency), v_lines, v_sub, coalesce(p_tax_rate, 0), v_tax, v_total, v_terms,
            case when v_terms = 'credit' then current_date + coalesce(p_due_days, 30) end, nullif(trim(p_notes), ''), p_user_name)
    returning id into v_id;
    perform public.post_journal(current_date, p_branch, p_currency, 'invoice', v_id, v_no || coalesce(' · ' || nullif(upper(trim(p_awb)), ''), ''), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', '1100', 'debit', v_total),
            jsonb_build_object('account', '4000', 'credit', v_sub),
            jsonb_build_object('account', '2100', 'credit', v_tax)));
    if p_pay_method in ('cash', 'card', 'bank') then
        v_pay := public.payment_record(v_id, v_total, p_pay_method, null, p_user_name);
    end if;
    return jsonb_build_object('id', v_id, 'invoice_no', v_no, 'total', v_total, 'currency', upper(p_currency), 'payment', v_pay);
end;
$$;

create or replace function public.payment_void(p_id bigint, p_reason text, p_user_name text) returns void
language plpgsql set search_path = public as $$
declare p public.payments%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
    select * into p from public.payments where id = p_id for update;
    if not found then raise exception 'Receipt not found.'; end if;
    if p.void then raise exception '% is already void.', p.receipt_no; end if;
    update public.payments set void = true, void_reason = trim(p_reason) where id = p_id;
    perform public.reverse_journal('payment', p_id, p_user_name, 'Void ' || p.receipt_no || ': ' || trim(p_reason));
    if p.invoice_id is not null then
        update public.invoices set paid = paid - p.amount,
            status = case when paid - p.amount <= 0 then 'unpaid' else 'partial' end
        where id = p.invoice_id and status <> 'void';
    end if;
end;
$$;

create or replace function public.invoice_void(p_id bigint, p_reason text, p_user_name text) returns void
language plpgsql set search_path = public as $$
declare i public.invoices%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
    select * into i from public.invoices where id = p_id for update;
    if not found then raise exception 'Invoice not found.'; end if;
    if i.status = 'void' then raise exception '% is already void.', i.invoice_no; end if;
    if exists (select 1 from public.payments where invoice_id = p_id and not void) then
        raise exception '% has payments — void the receipts first.', i.invoice_no;
    end if;
    update public.invoices set status = 'void', void_reason = trim(p_reason), voided_at = now() where id = p_id;
    perform public.reverse_journal('invoice', p_id, p_user_name, 'Void ' || i.invoice_no || ': ' || trim(p_reason));
end;
$$;

create or replace function public.expense_record(
    p_branch text, p_account text, p_currency text, p_amount numeric, p_method text, p_paid_to text,
    p_reference text, p_date date, p_notes text, p_user_name text
) returns jsonb
language plpgsql set search_path = public as $$
declare v_no text; v_id bigint; v_amt numeric := round(p_amount, 3);
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if not exists (select 1 from public.accounts where code = p_account and type = 'expense' and active) then
        raise exception 'Choose an expense category.';
    end if;
    if p_method not in ('cash', 'card', 'bank', 'payable') then raise exception 'Choose how it was paid.'; end if;
    v_no := public.next_doc_no(p_branch, 'EXP');
    insert into public.expenses (expense_no, branch_code, account_code, currency, amount, method, paid_to, reference, expense_date, notes, created_by_name)
    values (v_no, p_branch, p_account, upper(p_currency), v_amt, p_method, nullif(trim(p_paid_to), ''), nullif(trim(p_reference), ''),
            coalesce(p_date, current_date), nullif(trim(p_notes), ''), p_user_name)
    returning id into v_id;
    perform public.post_journal(coalesce(p_date, current_date), p_branch, p_currency, 'expense', v_id,
        v_no || coalesce(' · ' || nullif(trim(p_paid_to), ''), ''), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', p_account, 'debit', v_amt),
            jsonb_build_object('account', public.cash_account(p_method), 'credit', v_amt)));
    return jsonb_build_object('id', v_id, 'expense_no', v_no);
end;
$$;

create or replace function public.expense_void(p_id bigint, p_reason text, p_user_name text) returns void
language plpgsql set search_path = public as $$
declare e public.expenses%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
    select * into e from public.expenses where id = p_id for update;
    if not found then raise exception 'Expense not found.'; end if;
    if e.void then raise exception '% is already void.', e.expense_no; end if;
    update public.expenses set void = true, void_reason = trim(p_reason) where id = p_id;
    perform public.reverse_journal('expense', p_id, p_user_name, 'Void ' || e.expense_no || ': ' || trim(p_reason));
end;
$$;

-- Cash on hand movement for a branch/currency on a day (from the journal, so voids are already netted out)
create or replace function public.cash_day(p_branch text, p_currency text, p_date date) returns jsonb
language sql stable set search_path = public as $$
    with prev as (
        select counted, close_date from public.cash_closings
        where branch_code = p_branch and currency = upper(p_currency) and close_date < p_date
        order by close_date desc limit 1
    ), mv as (
        select coalesce(sum(l.debit) filter (where e.entry_date = p_date), 0) as cash_in,
               coalesce(sum(l.credit) filter (where e.entry_date = p_date), 0) as cash_out,
               coalesce(sum(l.debit - l.credit) filter (where e.entry_date < p_date
                        and e.entry_date > coalesce((select close_date from prev), '1900-01-01')), 0) as since_last
        from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
        where l.account_code = '1000' and e.branch_code = p_branch and e.currency = upper(p_currency) and e.source <> 'closing'
    )
    select jsonb_build_object(
        'opening', coalesce((select counted from prev), 0) + mv.since_last,
        'cash_in', mv.cash_in, 'cash_out', mv.cash_out,
        'expected', coalesce((select counted from prev), 0) + mv.since_last + mv.cash_in - mv.cash_out,
        'last_closed', (select close_date from prev))
    from mv;
$$;

create or replace function public.cash_close(p_branch text, p_currency text, p_date date, p_counted numeric, p_notes text, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare d jsonb; v_id bigint; v_diff numeric;
begin
    if p_counted is null or p_counted < 0 then raise exception 'Enter the cash you counted.'; end if;
    if p_date > current_date then raise exception 'You cannot close a future day.'; end if;
    d := public.cash_day(p_branch, p_currency, p_date);
    insert into public.cash_closings (branch_code, currency, close_date, opening, cash_in, cash_out, expected, counted, notes, closed_by_name)
    values (p_branch, upper(p_currency), p_date, (d->>'opening')::numeric, (d->>'cash_in')::numeric, (d->>'cash_out')::numeric,
            (d->>'expected')::numeric, round(p_counted, 3), nullif(trim(p_notes), ''), p_user_name)
    returning id, difference into v_id, v_diff;
    if v_diff <> 0 then   -- book the over / short so the cash account matches the drawer
        perform public.post_journal(p_date, p_branch, p_currency, 'closing', v_id, 'Cash ' || case when v_diff > 0 then 'over' else 'short' end || ' ' || p_date, p_user_name,
            case when v_diff > 0
                 then jsonb_build_array(jsonb_build_object('account', '1000', 'debit', v_diff), jsonb_build_object('account', '3900', 'credit', v_diff))
                 else jsonb_build_array(jsonb_build_object('account', '3900', 'debit', -v_diff), jsonb_build_object('account', '1000', 'credit', -v_diff)) end);
    end if;
    return jsonb_build_object('id', v_id, 'difference', v_diff);
exception when unique_violation then
    raise exception '% % is already closed for %.', p_branch, upper(p_currency), p_date;
end;
$$;

-- Account totals for reports (trial balance, P&L, balance sheet). p_branch null = all branches.
create or replace function public.ledger_summary(p_branch text, p_from date, p_to date)
returns table (currency text, account_code text, name text, type text, debit numeric, credit numeric)
language sql stable set search_path = public as $$
    select e.currency, a.code, a.name, a.type, sum(l.debit), sum(l.credit)
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.accounts a on a.code = l.account_code
    where (p_branch is null or e.branch_code = p_branch)
      and (p_from is null or e.entry_date >= p_from)
      and (p_to is null or e.entry_date <= p_to)
    group by e.currency, a.code, a.name, a.type
    order by e.currency, a.code;
$$;

revoke all on function public.post_journal(date, text, text, text, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.reverse_journal(text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.next_doc_no(text, text) from public, anon, authenticated;
revoke all on function public.payment_record(bigint, numeric, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.invoice_create(text, uuid, text, text, text, text, jsonb, numeric, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.payment_void(bigint, text, text) from public, anon, authenticated;
revoke all on function public.invoice_void(bigint, text, text) from public, anon, authenticated;
revoke all on function public.expense_record(text, text, text, numeric, text, text, text, date, text, text) from public, anon, authenticated;
revoke all on function public.expense_void(bigint, text, text) from public, anon, authenticated;
revoke all on function public.cash_day(text, text, date) from public, anon, authenticated;
revoke all on function public.cash_close(text, text, date, numeric, text, text) from public, anon, authenticated;
revoke all on function public.ledger_summary(text, date, date) from public, anon, authenticated;
revoke all on function public.cash_account(text) from public, anon, authenticated;
