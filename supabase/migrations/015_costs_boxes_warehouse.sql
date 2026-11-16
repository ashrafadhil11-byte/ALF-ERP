-- 015 — Suppliers & agents, sea containers, box-level status, shipment cost center, central warehouse.
--  • suppliers → "parties": supplier / agent / both, with contact, terms and services
--  • consolidations: + container (sea) with container no / size / seal / vessel / BL
--  • booking_pieces: one row per box (kept in sync with bookings.boxes); staff tick which boxes a status applies to
--  • cost_bills: agent / supplier costs per MAWB-container or per shipment → allocated by chargeable kg (containers: CBM)
--  • central warehouse = branch_type 'warehouse'; branches request materials, warehouse dispatches at its
--    transfer price (internal sale), branch receives (owes the warehouse), head office settles

-- ---------------------------------------------------------------
-- 1. Parties (suppliers + agents)
-- ---------------------------------------------------------------
alter table public.suppliers
    add column if not exists kind               text not null default 'supplier' check (kind in ('supplier', 'agent', 'both')),
    add column if not exists contact_person     text,
    add column if not exists email              text,
    add column if not exists address            text,
    add column if not exists country            text,
    add column if not exists tax_no             text,
    add column if not exists payment_terms_days integer not null default 0,
    add column if not exists services           text[] not null default '{}';   -- air, sea, customs, delivery, trucking, packing

-- ---------------------------------------------------------------
-- 2. Branch type: central warehouse
-- ---------------------------------------------------------------
alter table public.branches add column if not exists branch_type text not null default 'branch';
alter table public.branches drop constraint if exists branches_branch_type_check;
alter table public.branches add constraint branches_branch_type_check check (branch_type in ('branch', 'warehouse'));

-- ---------------------------------------------------------------
-- 3. Containers (sea consolidation)
-- ---------------------------------------------------------------
alter table public.consolidations drop constraint if exists consolidations_kind_check;
alter table public.consolidations add constraint consolidations_kind_check check (kind in ('mawb', 'bag', 'container'));
alter table public.consolidations
    add column if not exists container_size text,     -- 20GP, 40GP, 40HC, LCL …
    add column if not exists seal_no        text,
    add column if not exists vessel         text,
    add column if not exists voyage         text,
    add column if not exists bl_no          text,
    add column if not exists eta            date;
alter table public.consolidation_items add column if not exists pieces integer[];   -- null = all boxes

-- ---------------------------------------------------------------
-- 4. Boxes (pieces)
-- ---------------------------------------------------------------
create table if not exists public.booking_pieces (
    booking_id  uuid not null references public.bookings(id) on delete cascade,
    piece_no    integer not null,
    weight      numeric,
    l           numeric,
    w           numeric,
    h           numeric,
    commodity   text,
    status_code text references public.statuses(code),
    status      text,
    updated_at  timestamptz not null default now(),
    primary key (booking_id, piece_no)
);
alter table public.booking_pieces enable row level security;

create or replace function public.sync_booking_pieces() returns trigger
language plpgsql set search_path = public as $$
declare n integer; i integer; bx jsonb;
begin
    n := greatest(case when jsonb_typeof(new.boxes) = 'array' then jsonb_array_length(new.boxes) else 0 end, coalesce(new.pieces, 0), 1);
    for i in 1..n loop
        bx := case when jsonb_typeof(new.boxes) = 'array' then new.boxes -> (i - 1) end;
        insert into public.booking_pieces (booking_id, piece_no, weight, l, w, h, commodity, status_code, status)
        values (new.id, i, nullif(bx->>'weight', '')::numeric, nullif(bx->>'l', '')::numeric, nullif(bx->>'w', '')::numeric,
                nullif(bx->>'h', '')::numeric, nullif(bx->>'commodity', ''), new.current_status_code, new.current_status)
        on conflict (booking_id, piece_no) do update set
            weight = excluded.weight, l = excluded.l, w = excluded.w, h = excluded.h, commodity = excluded.commodity;
    end loop;
    delete from public.booking_pieces where booking_id = new.id and piece_no > n;
    return new;
end;
$$;
drop trigger if exists bookings_sync_pieces on public.bookings;
create trigger bookings_sync_pieces after insert or update of boxes, pieces on public.bookings
    for each row execute function public.sync_booking_pieces();
-- backfill existing bookings
update public.bookings set pieces = pieces;

-- set_status: every box follows the shipment (piece-aware callers restore boxes that were left behind)
create or replace function public.set_status(
    p_awbs       text[],
    p_code       text,
    p_user_id    uuid,
    p_user_name  text,
    p_branch     text,
    p_location   text        default null,
    p_remark     text        default null,
    p_event_at   timestamptz default now(),
    p_allow_back boolean     default false,
    p_source     text        default 'manual'
) returns integer
language plpgsql
set search_path = public
as $$
declare
    st  public.statuses%rowtype;
    b   public.bookings%rowtype;
    n   integer := 0;
    v_awb text;
begin
    select * into st from public.statuses where code = p_code and active;
    if not found then
        raise exception 'Unknown or inactive status: %', p_code;
    end if;
    if 'remark' = any(st.requires) and coalesce(trim(p_remark), '') = '' then
        raise exception 'Status "%" needs a remark', st.label;
    end if;

    foreach v_awb in array p_awbs loop
        select * into b from public.bookings where bookings.awb = upper(trim(v_awb)) for update;
        if not found then
            raise exception 'Booking % not found', v_awb;
        end if;
        if p_source = 'carrier_api' and not st.is_exception
           and (st.stage, st.sort) <= (b.current_stage, b.current_sort) then
            continue;
        end if;
        if not st.is_exception and not p_allow_back
           and (st.stage, st.sort) < (b.current_stage, b.current_sort) then
            raise exception 'Booking % is already at a later step (%); going back needs a manager', b.awb, b.current_status;
        end if;

        insert into public.tracking_events (booking_id, status_code, status, location, remark, event_at,
                                            created_by, created_by_name, branch_code, source)
        values (b.id, st.code, st.label, coalesce(p_location, p_branch), p_remark, coalesce(p_event_at, now()),
                p_user_id, p_user_name, p_branch, p_source);

        update public.bookings set
            current_status_code = st.code,
            current_status      = st.label,
            current_stage       = case when st.is_exception then current_stage else st.stage end,
            current_sort        = case when st.is_exception then current_sort  else st.sort  end,
            updated_at          = now()
        where id = b.id;
        update public.booking_pieces set status_code = st.code, status = st.label, updated_at = now() where booking_id = b.id;

        n := n + 1;
    end loop;
    return n;
end;
$$;

-- Status for some boxes only. p_pieces null/empty or all boxes = whole shipment.
-- The shipment takes the new status; boxes that were not ticked keep their previous status.
create or replace function public.set_status_pieces(
    p_awb text, p_pieces integer[], p_code text, p_user_id uuid, p_user_name text, p_branch text,
    p_location text default null, p_remark text default null, p_allow_back boolean default false, p_source text default 'scan'
) returns jsonb
language plpgsql set search_path = public as $$
declare
    b public.bookings%rowtype; v_total integer; v_sel integer[]; v_keep jsonb; v_note text;
begin
    select * into b from public.bookings where awb = upper(trim(p_awb));
    if not found then raise exception 'Booking % not found', p_awb; end if;
    select count(*) into v_total from public.booking_pieces where booking_id = b.id;
    select array_agg(distinct x order by x) into v_sel from unnest(coalesce(p_pieces, '{}')) x where x between 1 and greatest(v_total, 1);
    if v_sel is null or cardinality(v_sel) = 0 or cardinality(v_sel) >= v_total then
        perform public.set_status(array[b.awb], p_code, p_user_id, p_user_name, p_branch, p_location, p_remark, now(), p_allow_back, p_source);
        return jsonb_build_object('awb', b.awb, 'boxes', v_total, 'updated', v_total);
    end if;
    select jsonb_object_agg(piece_no, jsonb_build_object('c', status_code, 's', status)) into v_keep
      from public.booking_pieces where booking_id = b.id and not (piece_no = any(v_sel));
    v_note := 'Boxes ' || array_to_string(v_sel, ', ') || ' of ' || v_total;
    perform public.set_status(array[b.awb], p_code, p_user_id, p_user_name, p_branch, p_location,
                              v_note || coalesce(' • ' || nullif(trim(p_remark), ''), ''), now(), p_allow_back, p_source);
    update public.booking_pieces bp set status_code = v_keep -> bp.piece_no::text ->> 'c', status = v_keep -> bp.piece_no::text ->> 's'
     where bp.booking_id = b.id and v_keep ? bp.piece_no::text;
    return jsonb_build_object('awb', b.awb, 'boxes', v_total, 'updated', cardinality(v_sel), 'pieces', v_sel);
end;
$$;

-- consolidation_add with box selection: p_pieces = { "AWB": [1,2] } (missing AWB = all boxes)
drop function if exists public.consolidation_add(bigint, text[], uuid, text, text);
create or replace function public.consolidation_add(p_id bigint, p_awbs text[], p_user_id uuid, p_user_name text, p_branch text, p_pieces jsonb default null)
returns integer
language plpgsql set search_path = public as $$
declare
    c public.consolidations%rowtype;
    b public.bookings%rowtype;
    v_awb text; v_other text; v_sel integer[]; v_total integer;
    n integer := 0;
begin
    select * into c from public.consolidations where id = p_id for update;
    if not found then raise exception 'Consolidation not found.'; end if;
    if c.closed then raise exception '% is closed — reopen it to add shipments.', c.mawb; end if;
    foreach v_awb in array p_awbs loop
        select * into b from public.bookings where awb = upper(trim(v_awb)) for update;
        if not found then raise exception 'Booking % not found', v_awb; end if;
        if b.current_stage >= 8 or b.current_status_code = 'CANCELLED' then raise exception 'Booking % is closed (%).', b.awb, b.current_status; end if;
        if exists (select 1 from public.consolidation_items where consolidation_id = c.id and booking_id = b.id) then continue; end if;
        select c2.mawb into v_other from public.consolidation_items ci join public.consolidations c2 on c2.id = ci.consolidation_id
        where ci.booking_id = b.id and not c2.closed limit 1;
        if found then raise exception 'Booking % is already in open consolidation %.', b.awb, v_other; end if;
        select count(*) into v_total from public.booking_pieces where booking_id = b.id;
        v_sel := null;
        if p_pieces ? b.awb then
            select array_agg(distinct x::integer order by x::integer) into v_sel from jsonb_array_elements_text(p_pieces -> b.awb) x;
            if v_sel is null or cardinality(v_sel) = 0 then raise exception 'Tick at least one box of %.', b.awb; end if;
            if cardinality(v_sel) >= v_total then v_sel := null; end if;
        end if;
        insert into public.consolidation_items (consolidation_id, booking_id, pieces) values (c.id, b.id, v_sel);
        if b.current_sort < 340 then
            perform public.set_status_pieces(b.awb, v_sel, 'CONSOLIDATED', p_user_id, p_user_name, p_branch, null,
                                             upper(c.kind) || ': ' || c.mawb, false, 'scan');
        else
            perform public.add_event(b.id, 'Added to ' || upper(c.kind) || ' ' || c.mawb, case when v_sel is not null then 'Boxes ' || array_to_string(v_sel, ', ') || ' of ' || v_total end, p_user_id, p_user_name, p_branch);
        end if;
        n := n + 1;
    end loop;
    return n;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Cost center: agent / supplier bills per MAWB-container or per shipment
-- ---------------------------------------------------------------
insert into public.accounts (code, name, type, is_system) values
 ('1150', 'Due from branches (warehouse)',  'asset',     true),
 ('2050', 'Due to central warehouse',       'liability', true),
 ('4040', 'Material sales to branches',     'income',    true),
 ('5010', 'Trucking & local transport',     'expense',   true),
 ('5020', 'Handling & terminal charges',    'expense',   true)
on conflict (code) do nothing;
update public.accounts set is_system = true where code in ('5000', '5600', '5900');

create table if not exists public.cost_bills (
    id               bigserial primary key,
    bill_no          text not null unique,
    branch_code      text not null,
    supplier_id      bigint references public.suppliers(id),
    consolidation_id bigint references public.consolidations(id),
    booking_id       uuid references public.bookings(id) on delete set null,
    cost_type        text not null check (cost_type in ('freight', 'customs', 'trucking', 'handling', 'other')),
    description      text,
    currency         text not null,
    amount           numeric(14,3) not null check (amount > 0),
    paid             numeric(14,3) not null default 0,
    balance          numeric(14,3) generated always as (amount - paid) stored,
    status           text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'void')),
    bill_ref         text,
    bill_date        date not null default current_date,
    created_at       timestamptz not null default now(),
    created_by_name  text,
    void_reason      text,
    check (consolidation_id is not null or booking_id is not null)
);
create index if not exists cost_bills_cons_idx on public.cost_bills (consolidation_id);
create index if not exists cost_bills_booking_idx on public.cost_bills (booking_id);
alter table public.cost_bills enable row level security;
alter table public.supplier_payments add column if not exists cost_bill_id bigint references public.cost_bills(id);

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
    check (source in ('invoice', 'payment', 'expense', 'manual', 'closing', 'void', 'purchase', 'supplier_payment', 'stock', 'cost', 'internal'));

create or replace function public.cost_account(p_type text) returns text
language sql immutable set search_path = public as $$
    select case p_type when 'freight' then '5000' when 'customs' then '5600' when 'trucking' then '5010' when 'handling' then '5020' else '5900' end
$$;

create or replace function public.cost_bill_create(
    p_branch text, p_supplier_id bigint, p_consolidation_id bigint, p_booking_id uuid, p_type text, p_description text,
    p_currency text, p_amount numeric, p_pay_method text, p_bill_ref text, p_date date, p_user_name text
) returns jsonb
language plpgsql set search_path = public as $$
declare v_no text; v_id bigint; v_amt numeric := round(p_amount, 3); v_for text;
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if p_type not in ('freight', 'customs', 'trucking', 'handling', 'other') then raise exception 'Choose the cost type.'; end if;
    if p_consolidation_id is null and p_booking_id is null then raise exception 'Choose the MAWB / container or the shipment.'; end if;
    if p_pay_method not in ('cash', 'card', 'bank', 'credit') then raise exception 'Choose how it was paid.'; end if;
    if p_pay_method = 'credit' and p_supplier_id is null then raise exception 'Choose the agent / supplier for a bill on credit.'; end if;
    v_for := coalesce((select kind || ' ' || mawb from public.consolidations where id = p_consolidation_id), (select awb from public.bookings where id = p_booking_id));
    v_no := public.next_doc_no(p_branch, 'CST');
    insert into public.cost_bills (bill_no, branch_code, supplier_id, consolidation_id, booking_id, cost_type, description, currency, amount, paid, status, bill_ref, bill_date, created_by_name)
    values (v_no, p_branch, p_supplier_id, p_consolidation_id, p_booking_id, p_type, nullif(trim(p_description), ''), upper(p_currency), v_amt,
            case when p_pay_method = 'credit' then 0 else v_amt end, case when p_pay_method = 'credit' then 'unpaid' else 'paid' end,
            nullif(trim(p_bill_ref), ''), coalesce(p_date, current_date), p_user_name)
    returning id into v_id;
    perform public.post_journal(coalesce(p_date, current_date), p_branch, p_currency, 'cost', v_id, v_no || ' · ' || p_type || ' · ' || coalesce(v_for, ''), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', public.cost_account(p_type), 'debit', v_amt),
            jsonb_build_object('account', case when p_pay_method = 'credit' then '2000' else public.cash_account(p_pay_method) end, 'credit', v_amt)));
    return jsonb_build_object('id', v_id, 'bill_no', v_no);
end;
$$;

create or replace function public.cost_bill_pay(p_id bigint, p_amount numeric, p_method text, p_reference text, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare cb public.cost_bills%rowtype; v_no text; v_id bigint; v_amt numeric := round(p_amount, 3);
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if p_method not in ('cash', 'card', 'bank') then raise exception 'Payment method must be cash, card or bank.'; end if;
    select * into cb from public.cost_bills where id = p_id for update;
    if not found then raise exception 'Cost bill not found.'; end if;
    if cb.status = 'void' then raise exception '% is void.', cb.bill_no; end if;
    if v_amt > cb.amount - cb.paid then raise exception 'Amount is more than what is owed (% %).', cb.currency, cb.amount - cb.paid; end if;
    v_no := public.next_doc_no(cb.branch_code, 'SPY');
    insert into public.supplier_payments (payment_no, cost_bill_id, supplier_id, branch_code, currency, amount, method, reference, created_by_name)
    values (v_no, cb.id, cb.supplier_id, cb.branch_code, cb.currency, v_amt, p_method, nullif(trim(p_reference), ''), p_user_name)
    returning id into v_id;
    perform public.post_journal(current_date, cb.branch_code, cb.currency, 'supplier_payment', v_id, v_no || ' for ' || cb.bill_no, p_user_name,
        jsonb_build_array(jsonb_build_object('account', '2000', 'debit', v_amt), jsonb_build_object('account', public.cash_account(p_method), 'credit', v_amt)));
    update public.cost_bills set paid = paid + v_amt, status = case when paid + v_amt >= amount then 'paid' else 'partial' end where id = cb.id;
    return jsonb_build_object('id', v_id, 'payment_no', v_no, 'amount', v_amt);
end;
$$;

create or replace function public.cost_bill_void(p_id bigint, p_reason text, p_user_name text) returns void
language plpgsql set search_path = public as $$
declare cb public.cost_bills%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
    select * into cb from public.cost_bills where id = p_id for update;
    if not found then raise exception 'Cost bill not found.'; end if;
    if cb.status = 'void' then raise exception '% is already void.', cb.bill_no; end if;
    if exists (select 1 from public.supplier_payments where cost_bill_id = p_id and not void) then raise exception '% has payments — it cannot be voided.', cb.bill_no; end if;
    update public.cost_bills set status = 'void', void_reason = trim(p_reason) where id = p_id;
    perform public.reverse_journal('cost', p_id, p_user_name, 'Void ' || cb.bill_no || ': ' || trim(p_reason));
end;
$$;

-- Each shipment's share of a consolidation's costs: chargeable kg (containers: CBM of the boxes inside; equal split if nothing measured)
create or replace function public.consolidation_allocation(p_id bigint)
returns table (booking_id uuid, awb text, basis numeric, share numeric, currency text, allocated numeric)
language sql stable set search_path = public as $$
    with c as (select * from public.consolidations where id = p_id),
    items as (
        select b.id, b.awb, ci.pieces,
               case when (select kind from c) = 'container'
                    then (select coalesce(sum(coalesce(bp.l, 0) * coalesce(bp.w, 0) * coalesce(bp.h, 0)) / 1000000.0, 0)
                          from public.booking_pieces bp where bp.booking_id = b.id and (ci.pieces is null or bp.piece_no = any(ci.pieces)))
                    else coalesce(b.chargeable_weight, b.weight, 0)
                         * case when ci.pieces is null then 1
                                else cardinality(ci.pieces)::numeric / greatest((select count(*) from public.booking_pieces bp where bp.booking_id = b.id), 1) end
               end as basis
        from public.consolidation_items ci join public.bookings b on b.id = ci.booking_id
        where ci.consolidation_id = p_id
    ),
    tot as (select sum(basis) s, count(*) n from items),
    costs as (select cb.currency, sum(cb.amount) amt from public.cost_bills cb where cb.consolidation_id = p_id and cb.status <> 'void' group by cb.currency)
    select i.id, i.awb, round(i.basis, 4),
           case when t.s > 0 then i.basis / t.s else 1.0 / t.n end as share,
           k.currency,
           round(k.amt * case when t.s > 0 then i.basis / t.s else 1.0 / t.n end, 3)
    from items i cross join tot t cross join costs k
    where t.n > 0;
$$;

-- Profit per shipment: invoiced (before tax, not void) − direct cost bills − share of consolidation costs
create or replace function public.shipment_profit(p_branch text, p_from date, p_to date)
returns table (booking_id uuid, awb text, branch_code text, booked_at timestamptz, consignee text, dest_country text, currency text,
               revenue numeric, direct_cost numeric, allocated_cost numeric, profit numeric)
language sql stable set search_path = public as $$
    with b as (
        select * from public.bookings
        where (p_branch is null or branch_code = p_branch)
          and (p_from is null or booked_at::date >= p_from) and (p_to is null or booked_at::date <= p_to)
    ),
    rev as (select i.booking_id, i.currency, sum(i.subtotal) amt from public.invoices i join b on b.id = i.booking_id where i.status <> 'void' group by 1, 2),
    dir as (select cb.booking_id, cb.currency, sum(cb.amount) amt from public.cost_bills cb join b on b.id = cb.booking_id where cb.status <> 'void' group by 1, 2),
    alc as (select a.booking_id, a.currency, sum(a.allocated) amt
            from public.consolidations c, lateral public.consolidation_allocation(c.id) a
            where exists (select 1 from public.consolidation_items ci join b on b.id = ci.booking_id where ci.consolidation_id = c.id)
            group by 1, 2),
    keys as (select booking_id, currency from rev union select booking_id, currency from dir union select booking_id, currency from alc)
    select b.id, b.awb, b.branch_code, b.booked_at, b.consignee, b.dest_country, k.currency,
           coalesce(r.amt, 0), coalesce(d.amt, 0), coalesce(a.amt, 0), coalesce(r.amt, 0) - coalesce(d.amt, 0) - coalesce(a.amt, 0)
    from keys k join b on b.id = k.booking_id
    left join rev r on r.booking_id = k.booking_id and r.currency = k.currency
    left join dir d on d.booking_id = k.booking_id and d.currency = k.currency
    left join alc a on a.booking_id = k.booking_id and a.currency = k.currency
    order by b.booked_at desc;
$$;

-- ---------------------------------------------------------------
-- 6. Central warehouse → branch stock requests (internal sale / purchase)
-- ---------------------------------------------------------------
alter table public.stock_moves drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check check (kind in ('purchase', 'sale', 'adjust', 'void', 'transfer_out', 'transfer_in'));

create table if not exists public.stock_requests (
    id               bigserial primary key,
    request_no       text not null unique,
    warehouse        text not null,
    branch_code      text not null,
    currency         text,
    status           text not null default 'requested' check (status in ('requested', 'dispatched', 'received', 'rejected', 'cancelled')),
    lines            jsonb not null default '[]',   -- [{ product_id, name, unit, qty_requested, qty_sent, unit_price, amount }]
    total            numeric(14,3) not null default 0,
    notes            text,
    requested_at     timestamptz not null default now(),
    requested_by     text,
    dispatched_at    timestamptz,
    dispatched_by    text,
    received_at      timestamptz,
    received_by      text,
    reject_reason    text
);
create index if not exists stock_requests_idx on public.stock_requests (warehouse, status);
create index if not exists stock_requests_branch_idx on public.stock_requests (branch_code, status);
alter table public.stock_requests enable row level security;

create table if not exists public.internal_settlements (
    id              bigserial primary key,
    warehouse       text not null,
    branch_code     text not null,
    currency        text not null,
    amount          numeric(14,3) not null check (amount > 0),
    method          text not null check (method in ('cash', 'card', 'bank')),
    reference       text,
    settled_at      timestamptz not null default now(),
    created_by_name text
);
alter table public.internal_settlements enable row level security;

create or replace function public.stock_request_create(p_branch text, p_warehouse text, p_lines jsonb, p_notes text, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare l jsonb; v_lines jsonb := '[]'; v_no text; v_id bigint; p public.products%rowtype;
begin
    if not exists (select 1 from public.branches where branch_code = p_warehouse and branch_type = 'warehouse') then raise exception 'Choose the central warehouse.'; end if;
    if p_branch = p_warehouse then raise exception 'The warehouse cannot request from itself.'; end if;
    for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        select * into p from public.products where id = (l->>'product_id')::bigint and active and track_stock;
        if not found then raise exception 'Only counted items (cartons…) can be requested.'; end if;
        if coalesce((l->>'qty')::numeric, 0) <= 0 then continue; end if;
        v_lines := v_lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit, 'qty_requested', (l->>'qty')::numeric);
    end loop;
    if jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one item with a quantity.'; end if;
    v_no := public.next_doc_no(p_branch, 'SRQ');
    insert into public.stock_requests (request_no, warehouse, branch_code, lines, notes, requested_by)
    values (v_no, p_warehouse, p_branch, v_lines, nullif(trim(p_notes), ''), p_user_name) returning id into v_id;
    return jsonb_build_object('id', v_id, 'request_no', v_no);
end;
$$;

-- Warehouse sends: p_lines = [{ product_id, qty, unit_price }] (price defaults to the warehouse's price for branches = its sell price)
create or replace function public.stock_request_dispatch(p_id bigint, p_lines jsonb, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare
    r public.stock_requests%rowtype; l jsonb; v_lines jsonb := '[]'; v_total numeric := 0; v_cogs numeric := 0;
    v_cur text; v_bcur text; v_qty numeric; v_price numeric; v_cost numeric; p public.products%rowtype; bp public.branch_products%rowtype;
begin
    select * into r from public.stock_requests where id = p_id for update;
    if not found then raise exception 'Request not found.'; end if;
    if r.status <> 'requested' then raise exception '% is already %.', r.request_no, r.status; end if;
    select currency into v_cur from public.branches where branch_code = r.warehouse;
    select currency into v_bcur from public.branches where branch_code = r.branch_code;
    if coalesce(v_cur, 'OMR') <> coalesce(v_bcur, 'OMR') then raise exception 'Warehouse (%) and branch (%) use different currencies — not supported yet.', v_cur, v_bcur; end if;
    for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        v_qty := coalesce((l->>'qty')::numeric, 0);
        if v_qty <= 0 then continue; end if;
        select * into p from public.products where id = (l->>'product_id')::bigint and track_stock;
        if not found then raise exception 'Unknown item.'; end if;
        select * into bp from public.branch_products where branch_code = r.warehouse and product_id = p.id;
        v_price := round(coalesce(nullif(l->>'unit_price', '')::numeric, bp.sell_price, 0), 3);
        if v_price <= 0 then raise exception 'Set the price for branches on % (warehouse sell price) or enter it.', p.name; end if;
        if coalesce(bp.qty, 0) < v_qty then raise exception 'Not enough % in the warehouse (% left).', p.name, coalesce(bp.qty, 0); end if;
        v_cost := public.stock_apply(r.warehouse, p.id, -v_qty, null, 'transfer_out', 'stock_request', r.id, r.request_no || ' → ' || r.branch_code, p_user_name);
        v_cogs := v_cogs + round(v_qty * v_cost, 3);
        v_total := v_total + round(v_qty * v_price, 3);
        v_lines := v_lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit,
                     'qty_requested', (select (x->>'qty_requested')::numeric from jsonb_array_elements(r.lines) x where (x->>'product_id')::bigint = p.id limit 1),
                     'qty_sent', v_qty, 'unit_price', v_price, 'amount', round(v_qty * v_price, 3));
    end loop;
    if v_total <= 0 then raise exception 'Enter the quantities to send.'; end if;
    update public.stock_requests set status = 'dispatched', lines = v_lines, total = v_total, currency = coalesce(v_cur, 'OMR'),
           dispatched_at = now(), dispatched_by = p_user_name where id = r.id;
    -- warehouse books: internal sale + cost of goods
    perform public.post_journal(current_date, r.warehouse, coalesce(v_cur, 'OMR'), 'internal', r.id, r.request_no || ' to ' || r.branch_code, p_user_name,
        jsonb_build_array(jsonb_build_object('account', '1150', 'debit', v_total), jsonb_build_object('account', '4040', 'credit', v_total)));
    perform public.post_journal(current_date, r.warehouse, coalesce(v_cur, 'OMR'), 'internal', r.id, r.request_no || ' cost', p_user_name,
        jsonb_build_array(jsonb_build_object('account', '5050', 'debit', v_cogs), jsonb_build_object('account', '1200', 'credit', v_cogs)));
    return jsonb_build_object('request_no', r.request_no, 'total', v_total);
end;
$$;

create or replace function public.stock_request_receive(p_id bigint, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare r public.stock_requests%rowtype; l jsonb;
begin
    select * into r from public.stock_requests where id = p_id for update;
    if not found then raise exception 'Request not found.'; end if;
    if r.status <> 'dispatched' then raise exception '% is %, not on the way.', r.request_no, r.status; end if;
    for l in select * from jsonb_array_elements(r.lines) loop
        perform public.stock_apply(r.branch_code, (l->>'product_id')::bigint, (l->>'qty_sent')::numeric, (l->>'unit_price')::numeric,
                                   'purchase', 'stock_request', r.id, r.request_no || ' from ' || r.warehouse, p_user_name);
    end loop;
    update public.stock_moves set kind = 'transfer_in' where ref_type = 'stock_request' and ref_id = r.id and branch_code = r.branch_code and kind = 'purchase';
    perform public.post_journal(current_date, r.branch_code, r.currency, 'internal', r.id, r.request_no || ' from ' || r.warehouse, p_user_name,
        jsonb_build_array(jsonb_build_object('account', '1200', 'debit', r.total), jsonb_build_object('account', '2050', 'credit', r.total)));
    update public.stock_requests set status = 'received', received_at = now(), received_by = p_user_name where id = r.id;
    return jsonb_build_object('request_no', r.request_no, 'total', r.total);
end;
$$;

-- Head office settles what a branch owes the warehouse (both sides' books)
create or replace function public.internal_settle(p_warehouse text, p_branch text, p_amount numeric, p_method text, p_reference text, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare v_cur text; v_owed numeric; v_amt numeric := round(p_amount, 3); v_id bigint;
begin
    if p_method not in ('cash', 'card', 'bank') then raise exception 'Choose how it was paid.'; end if;
    select currency into v_cur from public.branches where branch_code = p_warehouse;
    v_cur := coalesce(v_cur, 'OMR');
    select coalesce((select sum(total) from public.stock_requests where warehouse = p_warehouse and branch_code = p_branch and status in ('dispatched', 'received')), 0)
         - coalesce((select sum(amount) from public.internal_settlements where warehouse = p_warehouse and branch_code = p_branch), 0)
      into v_owed;
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if v_amt > v_owed then raise exception '% owes the warehouse only % %.', p_branch, v_cur, v_owed; end if;
    insert into public.internal_settlements (warehouse, branch_code, currency, amount, method, reference, created_by_name)
    values (p_warehouse, p_branch, v_cur, v_amt, p_method, nullif(trim(p_reference), ''), p_user_name) returning id into v_id;
    perform public.post_journal(current_date, p_warehouse, v_cur, 'internal', v_id, 'Settlement from ' || p_branch, p_user_name,
        jsonb_build_array(jsonb_build_object('account', public.cash_account(p_method), 'debit', v_amt), jsonb_build_object('account', '1150', 'credit', v_amt)));
    perform public.post_journal(current_date, p_branch, v_cur, 'internal', v_id, 'Settlement to ' || p_warehouse, p_user_name,
        jsonb_build_array(jsonb_build_object('account', '2050', 'debit', v_amt), jsonb_build_object('account', public.cash_account(p_method), 'credit', v_amt)));
    return jsonb_build_object('id', v_id, 'remaining', v_owed - v_amt);
end;
$$;

revoke all on function public.sync_booking_pieces() from public, anon, authenticated;
revoke all on function public.set_status(text[], text, uuid, text, text, text, text, timestamptz, boolean, text) from public, anon, authenticated;
revoke all on function public.set_status_pieces(text, integer[], text, uuid, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.consolidation_add(bigint, text[], uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cost_account(text) from public, anon, authenticated;
revoke all on function public.cost_bill_create(text, bigint, bigint, uuid, text, text, text, numeric, text, text, date, text) from public, anon, authenticated;
revoke all on function public.cost_bill_pay(bigint, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.cost_bill_void(bigint, text, text) from public, anon, authenticated;
revoke all on function public.consolidation_allocation(bigint) from public, anon, authenticated;
revoke all on function public.shipment_profit(text, date, date) from public, anon, authenticated;
revoke all on function public.stock_request_create(text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.stock_request_dispatch(bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.stock_request_receive(bigint, text) from public, anon, authenticated;
revoke all on function public.internal_settle(text, text, numeric, text, text, text) from public, anon, authenticated;
