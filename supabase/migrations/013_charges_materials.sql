-- 013 — Charges, package rates, commodity rates, packing materials (stock, suppliers, purchases).
--  • Rate cards: + per CBM, + box size ("per dimension"), + commodity (General / Electronics / …)
--  • Package rates: all-in price per item (e.g. TV incl. wooden box, customs duty, freight)
--  • Extra charges: handling, packing … per shipment / per box / per kg
--  • Packing materials per branch. Counted items (cartons) keep stock + average cost;
--    consumables (bubble roll, tape, lamination) are expensed on purchase and never counted.
--  • Invoice lines carry a kind → income account: freight/package 4000, charge 4030, material 4020 (+ cost of sale).

-- ---------------------------------------------------------------
-- 1. Accounts used by the new postings
-- ---------------------------------------------------------------
insert into public.accounts (code, name, type, is_system) values
 ('1200', 'Packing materials stock',          'asset',   true),
 ('4020', 'Packing material sales',           'income',  true),
 ('4030', 'Handling & service charges',       'income',  true),
 ('5050', 'Cost of packing materials sold',   'expense', true)
on conflict (code) do nothing;
update public.accounts set is_system = true where code = '5500';   -- consumables are booked here

-- ---------------------------------------------------------------
-- 2. Commodities + rate card additions
-- ---------------------------------------------------------------
create table if not exists public.commodities (
    code   text primary key,
    name   text not null,
    active boolean not null default true,
    sort   integer not null default 0
);
alter table public.commodities enable row level security;
insert into public.commodities (code, name, sort) values ('GEN', 'General', 0), ('ELEC', 'Electronics', 10)
on conflict (code) do nothing;

alter table public.rate_cards add column if not exists commodity text not null default '*';
alter table public.rate_cards add column if not exists sizes jsonb not null default '[]';   -- box_size: [{ "name": "Medium", "l": 60, "w": 40, "h": 40, "price": 15 }]
alter table public.rate_cards drop constraint if exists rate_cards_method_check;
alter table public.rate_cards add constraint rate_cards_method_check
    check (method in ('per_kg', 'vol_band', 'per_package', 'per_box', 'per_cbm', 'box_size'));
alter table public.rate_cards drop constraint if exists rate_cards_branch_code_dest_country_code_cargo_type_code_key;
create unique index if not exists rate_cards_key on public.rate_cards (branch_code, dest_country_code, cargo_type_code, commodity);

-- ---------------------------------------------------------------
-- 3. Package rates + extra charges
-- ---------------------------------------------------------------
create table if not exists public.package_rates (
    id                bigserial primary key,
    branch_code       text not null,
    dest_country_code text not null default '*',
    name              text not null,                 -- e.g. "TV up to 55 inch"
    price             numeric(14,3) not null check (price >= 0),
    includes          text,                          -- e.g. "Wooden box, customs duty, freight"
    active            boolean not null default true,
    updated_at        timestamptz not null default now()
);
create index if not exists package_rates_idx on public.package_rates (branch_code, dest_country_code);
alter table public.package_rates enable row level security;

create table if not exists public.charge_items (
    id          bigserial primary key,
    branch_code text not null,
    name        text not null,                       -- Handling, Packing, Documentation …
    basis       text not null default 'per_shipment' check (basis in ('per_shipment', 'per_box', 'per_kg')),
    price       numeric(14,3) not null check (price >= 0),
    active      boolean not null default true,
    unique (branch_code, name)
);
alter table public.charge_items enable row level security;

-- ---------------------------------------------------------------
-- 4. Packing materials, stock, suppliers, purchases
-- ---------------------------------------------------------------
create table if not exists public.products (
    id          bigserial primary key,
    sku         text not null unique,
    name        text not null,
    unit        text not null default 'pcs',         -- pcs, roll, m, kg …
    track_stock boolean not null default true,       -- false = consumable (bubble roll, tape …)
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);
alter table public.products enable row level security;

create table if not exists public.branch_products (
    branch_code   text not null,
    product_id    bigint not null references public.products(id) on delete cascade,
    sell_price    numeric(14,3) not null default 0,
    avg_cost      numeric(14,4) not null default 0,
    qty           numeric(14,3) not null default 0,
    reorder_level numeric(14,3) not null default 0,
    primary key (branch_code, product_id)
);
alter table public.branch_products enable row level security;

create table if not exists public.stock_moves (
    id              bigserial primary key,
    branch_code     text not null,
    product_id      bigint not null references public.products(id),
    qty             numeric(14,3) not null,           -- + in, − out
    unit_cost       numeric(14,4) not null default 0,
    kind            text not null check (kind in ('purchase', 'sale', 'adjust', 'void')),
    ref_type        text,                             -- invoice | purchase | count
    ref_id          bigint,
    note            text,
    created_at      timestamptz not null default now(),
    created_by_name text
);
create index if not exists stock_moves_idx on public.stock_moves (branch_code, product_id, created_at desc);
create index if not exists stock_moves_ref_idx on public.stock_moves (ref_type, ref_id);
alter table public.stock_moves enable row level security;

create table if not exists public.suppliers (
    id     bigserial primary key,
    name   text not null unique,
    phone  text,
    notes  text,
    active boolean not null default true
);
alter table public.suppliers enable row level security;

create table if not exists public.purchases (
    id              bigserial primary key,
    purchase_no     text not null unique,
    branch_code     text not null,
    supplier_id     bigint references public.suppliers(id),
    currency        text not null,
    bill_ref        text,
    purchase_date   date not null default current_date,
    lines           jsonb not null default '[]',      -- [{ product_id, description, qty, unit_cost, amount, stock }]
    total           numeric(14,3) not null,
    paid            numeric(14,3) not null default 0,
    balance         numeric(14,3) generated always as (total - paid) stored,
    status          text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'void')),
    notes           text,
    created_at      timestamptz not null default now(),
    created_by_name text,
    void_reason     text
);
create index if not exists purchases_idx on public.purchases (branch_code, purchase_date desc);
alter table public.purchases enable row level security;

create table if not exists public.supplier_payments (
    id              bigserial primary key,
    payment_no      text not null unique,
    purchase_id     bigint references public.purchases(id),
    supplier_id     bigint references public.suppliers(id),
    branch_code     text not null,
    currency        text not null,
    amount          numeric(14,3) not null check (amount > 0),
    method          text not null check (method in ('cash', 'card', 'bank')),
    reference       text,
    paid_at         timestamptz not null default now(),
    created_by_name text,
    void            boolean not null default false
);
alter table public.supplier_payments enable row level security;

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
    check (source in ('invoice', 'payment', 'expense', 'manual', 'closing', 'void', 'purchase', 'supplier_payment', 'stock'));

-- Stock in/out for one branch product; keeps average cost. Returns the unit cost used.
create or replace function public.stock_apply(
    p_branch text, p_product bigint, p_qty numeric, p_unit_cost numeric, p_kind text,
    p_ref_type text, p_ref_id bigint, p_note text, p_user_name text
) returns numeric
language plpgsql set search_path = public as $$
declare bp public.branch_products%rowtype; v_cost numeric;
begin
    insert into public.branch_products (branch_code, product_id) values (p_branch, p_product) on conflict do nothing;
    select * into bp from public.branch_products where branch_code = p_branch and product_id = p_product for update;
    if p_qty > 0 and p_kind = 'purchase' then
        v_cost := p_unit_cost;
        update public.branch_products set
            avg_cost = case when bp.qty <= 0 then p_unit_cost else (bp.qty * bp.avg_cost + p_qty * p_unit_cost) / (bp.qty + p_qty) end,
            qty = bp.qty + p_qty
        where branch_code = p_branch and product_id = p_product;
    else
        v_cost := coalesce(p_unit_cost, bp.avg_cost);
        update public.branch_products set qty = bp.qty + p_qty where branch_code = p_branch and product_id = p_product;
    end if;
    insert into public.stock_moves (branch_code, product_id, qty, unit_cost, kind, ref_type, ref_id, note, created_by_name)
    values (p_branch, p_product, p_qty, v_cost, p_kind, p_ref_type, p_ref_id, p_note, p_user_name);
    return v_cost;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Invoices with line kinds (replaces the 012 version, same signature)
--    line: { kind: freight|package|charge|material, description, qty, rate, product_id? }
-- ---------------------------------------------------------------
create or replace function public.invoice_create(
    p_branch text, p_booking_id uuid, p_awb text, p_customer_name text, p_customer_phone text, p_currency text,
    p_lines jsonb, p_tax_rate numeric, p_pay_method text, p_due_days integer, p_notes text, p_user_name text
) returns jsonb
language plpgsql set search_path = public as $$
declare
    v_lines jsonb := '[]'; v_sub numeric := 0; v_tax numeric; v_total numeric; v_no text; v_id bigint; v_terms text; v_pay jsonb;
    l jsonb; v_kind text; v_qty numeric; v_rate numeric; v_amt numeric; v_pid bigint; p public.products%rowtype;
    v_income jsonb := '{}'; v_cogs numeric := 0; v_cost numeric; v_jl jsonb; k text;
begin
    for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        v_kind := coalesce(nullif(l->>'kind', ''), 'freight');
        if v_kind not in ('freight', 'package', 'charge', 'material') then raise exception 'Unknown line type %.', v_kind; end if;
        v_qty := coalesce((l->>'qty')::numeric, 1);
        v_rate := round(coalesce((l->>'rate')::numeric, 0), 3);
        v_amt := round(v_qty * v_rate, 3);
        if v_qty <= 0 or v_amt < 0 then raise exception 'Line quantities and prices must be positive.'; end if;
        if v_amt = 0 then continue; end if;
        v_pid := nullif(l->>'product_id', '')::bigint;
        if v_kind = 'material' then
            select * into p from public.products where id = v_pid and active;
            if not found then raise exception 'Choose a packing material from the list.'; end if;
        end if;
        v_lines := v_lines || jsonb_build_object('kind', v_kind, 'description', coalesce(nullif(trim(l->>'description'), ''), case when v_kind = 'material' then p.name else 'Charge' end),
                                                 'qty', v_qty, 'rate', v_rate, 'amount', v_amt, 'product_id', v_pid);
        k := case v_kind when 'charge' then '4030' when 'material' then '4020' else '4000' end;
        v_income := jsonb_set(v_income, array[k], to_jsonb(coalesce((v_income->>k)::numeric, 0) + v_amt));
        v_sub := v_sub + v_amt;
    end loop;
    if v_sub <= 0 then raise exception 'The invoice total must be above zero.'; end if;
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

    v_jl := jsonb_build_array(jsonb_build_object('account', '1100', 'debit', v_total), jsonb_build_object('account', '2100', 'credit', v_tax));
    for k in select jsonb_object_keys(v_income) loop
        v_jl := v_jl || jsonb_build_object('account', k, 'credit', (v_income->>k)::numeric);
    end loop;
    perform public.post_journal(current_date, p_branch, p_currency, 'invoice', v_id, v_no || coalesce(' · ' || nullif(upper(trim(p_awb)), ''), ''), p_user_name, v_jl);

    -- counted materials leave stock at average cost (consumables don't)
    for l in select * from jsonb_array_elements(v_lines) loop
        if l->>'kind' = 'material' and exists (select 1 from public.products where id = (l->>'product_id')::bigint and track_stock) then
            v_cost := public.stock_apply(p_branch, (l->>'product_id')::bigint, -(l->>'qty')::numeric, null, 'sale', 'invoice', v_id, v_no, p_user_name);
            v_cogs := v_cogs + round((l->>'qty')::numeric * v_cost, 3);
        end if;
    end loop;
    if v_cogs > 0 then
        perform public.post_journal(current_date, p_branch, p_currency, 'invoice', v_id, v_no || ' cost of materials', p_user_name,
            jsonb_build_array(jsonb_build_object('account', '5050', 'debit', v_cogs), jsonb_build_object('account', '1200', 'credit', v_cogs)));
    end if;

    if p_pay_method in ('cash', 'card', 'bank') then
        v_pay := public.payment_record(v_id, v_total, p_pay_method, null, p_user_name);
    end if;
    return jsonb_build_object('id', v_id, 'invoice_no', v_no, 'total', v_total, 'currency', upper(p_currency), 'payment', v_pay);
end;
$$;

-- Void also puts sold materials back into stock
create or replace function public.invoice_void(p_id bigint, p_reason text, p_user_name text) returns void
language plpgsql set search_path = public as $$
declare i public.invoices%rowtype; m public.stock_moves%rowtype;
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
    for m in select * from public.stock_moves where ref_type = 'invoice' and ref_id = p_id and kind = 'sale' loop
        perform public.stock_apply(m.branch_code, m.product_id, -m.qty, m.unit_cost, 'void', 'invoice', p_id, 'Void ' || i.invoice_no, p_user_name);
    end loop;
end;
$$;

-- ---------------------------------------------------------------
-- 6. Purchases
--    line: { product_id?, description, qty, unit_cost }  — counted product → stock (1200), else → supplies expense (5500)
--    p_pay_method: cash | card | bank (paid now) | credit (owed to supplier, 2000)
-- ---------------------------------------------------------------
create or replace function public.purchase_create(
    p_branch text, p_supplier_id bigint, p_currency text, p_lines jsonb, p_pay_method text,
    p_bill_ref text, p_date date, p_notes text, p_user_name text
) returns jsonb
language plpgsql set search_path = public as $$
declare
    l jsonb; v_lines jsonb := '[]'; v_total numeric := 0; v_stock numeric := 0; v_exp numeric := 0;
    v_qty numeric; v_cost numeric; v_amt numeric; v_pid bigint; v_track boolean; v_no text; v_id bigint; p public.products%rowtype;
begin
    if p_pay_method not in ('cash', 'card', 'bank', 'credit') then raise exception 'Choose how the purchase was paid.'; end if;
    if p_pay_method = 'credit' and p_supplier_id is null then raise exception 'Choose the supplier for a credit purchase.'; end if;
    for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        v_qty := coalesce((l->>'qty')::numeric, 0);
        v_cost := round(coalesce((l->>'unit_cost')::numeric, 0), 4);
        v_amt := round(v_qty * v_cost, 3);
        if v_qty <= 0 or v_cost < 0 then raise exception 'Each line needs a quantity and a cost.'; end if;
        v_pid := nullif(l->>'product_id', '')::bigint;
        v_track := false;
        if v_pid is not null then
            select * into p from public.products where id = v_pid;
            if not found then raise exception 'Unknown packing material.'; end if;
            v_track := p.track_stock;
        end if;
        v_lines := v_lines || jsonb_build_object('product_id', v_pid, 'description', coalesce(nullif(trim(l->>'description'), ''), p.name, 'Item'),
                                                 'qty', v_qty, 'unit_cost', v_cost, 'amount', v_amt, 'stock', v_track);
        v_total := v_total + v_amt;
        if v_track then v_stock := v_stock + v_amt; else v_exp := v_exp + v_amt; end if;
    end loop;
    if v_total <= 0 then raise exception 'The purchase total must be above zero.'; end if;
    v_no := public.next_doc_no(p_branch, 'PUR');
    insert into public.purchases (purchase_no, branch_code, supplier_id, currency, bill_ref, purchase_date, lines, total, paid, status, notes, created_by_name)
    values (v_no, p_branch, p_supplier_id, upper(p_currency), nullif(trim(p_bill_ref), ''), coalesce(p_date, current_date), v_lines, v_total,
            case when p_pay_method = 'credit' then 0 else v_total end, case when p_pay_method = 'credit' then 'unpaid' else 'paid' end,
            nullif(trim(p_notes), ''), p_user_name)
    returning id into v_id;
    perform public.post_journal(coalesce(p_date, current_date), p_branch, p_currency, 'purchase', v_id, v_no || coalesce(' · ' || nullif(trim(p_bill_ref), ''), ''), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', '1200', 'debit', v_stock),
            jsonb_build_object('account', '5500', 'debit', v_exp),
            jsonb_build_object('account', case when p_pay_method = 'credit' then '2000' else public.cash_account(p_pay_method) end, 'credit', v_total)));
    for l in select * from jsonb_array_elements(v_lines) loop
        if (l->>'stock')::boolean then
            perform public.stock_apply(p_branch, (l->>'product_id')::bigint, (l->>'qty')::numeric, (l->>'unit_cost')::numeric, 'purchase', 'purchase', v_id, v_no, p_user_name);
        end if;
    end loop;
    return jsonb_build_object('id', v_id, 'purchase_no', v_no, 'total', v_total);
end;
$$;

create or replace function public.supplier_pay(p_purchase_id bigint, p_amount numeric, p_method text, p_reference text, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare pu public.purchases%rowtype; v_no text; v_id bigint; v_amt numeric := round(p_amount, 3);
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if p_method not in ('cash', 'card', 'bank') then raise exception 'Payment method must be cash, card or bank.'; end if;
    select * into pu from public.purchases where id = p_purchase_id for update;
    if not found then raise exception 'Purchase not found.'; end if;
    if pu.status = 'void' then raise exception '% is void.', pu.purchase_no; end if;
    if v_amt > pu.total - pu.paid then raise exception 'Amount is more than what is owed (% %).', pu.currency, pu.total - pu.paid; end if;
    v_no := public.next_doc_no(pu.branch_code, 'SPY');
    insert into public.supplier_payments (payment_no, purchase_id, supplier_id, branch_code, currency, amount, method, reference, created_by_name)
    values (v_no, pu.id, pu.supplier_id, pu.branch_code, pu.currency, v_amt, p_method, nullif(trim(p_reference), ''), p_user_name)
    returning id into v_id;
    perform public.post_journal(current_date, pu.branch_code, pu.currency, 'supplier_payment', v_id, v_no || ' for ' || pu.purchase_no, p_user_name,
        jsonb_build_array(jsonb_build_object('account', '2000', 'debit', v_amt), jsonb_build_object('account', public.cash_account(p_method), 'credit', v_amt)));
    update public.purchases set paid = paid + v_amt, status = case when paid + v_amt >= total then 'paid' else 'partial' end where id = pu.id;
    return jsonb_build_object('id', v_id, 'payment_no', v_no, 'amount', v_amt);
end;
$$;

create or replace function public.purchase_void(p_id bigint, p_reason text, p_user_name text) returns void
language plpgsql set search_path = public as $$
declare pu public.purchases%rowtype; m public.stock_moves%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
    select * into pu from public.purchases where id = p_id for update;
    if not found then raise exception 'Purchase not found.'; end if;
    if pu.status = 'void' then raise exception '% is already void.', pu.purchase_no; end if;
    if exists (select 1 from public.supplier_payments where purchase_id = p_id and not void) then
        raise exception '% has supplier payments — it cannot be voided.', pu.purchase_no;
    end if;
    update public.purchases set status = 'void', void_reason = trim(p_reason) where id = p_id;
    perform public.reverse_journal('purchase', p_id, p_user_name, 'Void ' || pu.purchase_no || ': ' || trim(p_reason));
    for m in select * from public.stock_moves where ref_type = 'purchase' and ref_id = p_id and kind = 'purchase' loop
        perform public.stock_apply(m.branch_code, m.product_id, -m.qty, m.unit_cost, 'void', 'purchase', p_id, 'Void ' || pu.purchase_no, p_user_name);
    end loop;
end;
$$;

-- Stock count: set the real quantity; the difference is booked against supplies expense (5500)
create or replace function public.stock_count(p_branch text, p_product bigint, p_counted numeric, p_note text, p_user_name text, p_currency text)
returns jsonb
language plpgsql set search_path = public as $$
declare bp public.branch_products%rowtype; v_diff numeric; v_val numeric;
begin
    if p_counted is null or p_counted < 0 then raise exception 'Enter the counted quantity.'; end if;
    if not exists (select 1 from public.products where id = p_product and track_stock) then raise exception 'Only counted items have stock.'; end if;
    insert into public.branch_products (branch_code, product_id) values (p_branch, p_product) on conflict do nothing;
    select * into bp from public.branch_products where branch_code = p_branch and product_id = p_product for update;
    v_diff := p_counted - bp.qty;
    if v_diff = 0 then return jsonb_build_object('difference', 0); end if;
    perform public.stock_apply(p_branch, p_product, v_diff, bp.avg_cost, 'adjust', 'count', null, coalesce(nullif(trim(p_note), ''), 'Stock count'), p_user_name);
    v_val := round(abs(v_diff) * bp.avg_cost, 3);
    if v_val > 0 then
        perform public.post_journal(current_date, p_branch, p_currency, 'stock', p_product, 'Stock count ' || coalesce(nullif(trim(p_note), ''), ''), p_user_name,
            case when v_diff < 0
                 then jsonb_build_array(jsonb_build_object('account', '5500', 'debit', v_val), jsonb_build_object('account', '1200', 'credit', v_val))
                 else jsonb_build_array(jsonb_build_object('account', '1200', 'debit', v_val), jsonb_build_object('account', '5500', 'credit', v_val)) end);
    end if;
    return jsonb_build_object('difference', v_diff, 'value', v_val);
end;
$$;

revoke all on function public.stock_apply(text, bigint, numeric, numeric, text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.invoice_create(text, uuid, text, text, text, text, jsonb, numeric, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.invoice_void(bigint, text, text) from public, anon, authenticated;
revoke all on function public.purchase_create(text, bigint, text, jsonb, text, text, date, text, text) from public, anon, authenticated;
revoke all on function public.supplier_pay(bigint, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.purchase_void(bigint, text, text) from public, anon, authenticated;
revoke all on function public.stock_count(text, bigint, numeric, text, text, text) from public, anon, authenticated;
