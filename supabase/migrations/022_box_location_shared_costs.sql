-- 022 — Booking code only for branches, box-level cargo stock, consolidation costs shared by branch.
--
--  • Main Office and the warehouse make no bookings: their booking code may be 0 (unique only among branches).
--  • Every box knows where it is (booking_pieces.at_branch). A transfer moves only the boxes that arrive; boxes
--    left behind stay in the sender's stock, missing boxes are in nobody's stock. cargo_stock(branch) = boxes on hand.
--  • An agent / supplier bill on a consolidation is shared between the branches whose shipments are inside
--    (chargeable kg, containers by CBM). Each branch carries its share as its own cost and the running balance
--    with Main Office (2060 / 1160) settles who paid. Without a Main Office (or other currency) it stays whole.

-- ---------- 1. booking code: branches only ----------
alter table public.branches drop constraint if exists branches_booking_code_key;
create unique index if not exists branches_booking_code_branch_key on public.branches (booking_code) where branch_type = 'branch';

create or replace function public.next_booking_ref(p_branch_code text, p_country_code text, p_cargo_code text)
returns text language plpgsql set search_path to 'public' as $$
declare
    v_branch_digit text; v_type text;
    v_country      text := upper(trim(p_country_code));
    v_dest         text;
    v_series       text;
    v_no           integer;
    v_ref          text;
begin
    select booking_code, branch_type into v_branch_digit, v_type from branches where branch_code = p_branch_code;
    if v_type is distinct from 'branch' then
        raise exception 'Bookings are made at a branch — % is %.', p_branch_code, case v_type when 'warehouse' then 'the warehouse' when 'main_office' then 'Main Office' else 'not a branch' end;
    end if;
    if coalesce(trim(v_branch_digit), '') = '' then
        raise exception 'Branch % has no booking code (AWB digit). Set it in Branch Network.', p_branch_code;
    end if;
    if v_country !~ '^[A-Z]{2}$' then
        raise exception 'Destination country code must be 2 letters (got %)', p_country_code;
    end if;
    if not exists (select 1 from cargo_types where code = p_cargo_code and active) then
        raise exception 'Unknown or inactive cargo type %', p_cargo_code;
    end if;
    select code into v_dest from destination_codes where country_code = v_country and active;
    if v_dest is null then
        v_dest := v_country;
        v_series := 'ALPHA';
    else
        v_series := v_dest;
    end if;
    loop
        insert into booking_counters (branch_code, series, last_no) values (p_branch_code, v_series, 1)
        on conflict (branch_code, series) do update set last_no = booking_counters.last_no + 1, updated_at = now()
        returning last_no into v_no;
        if v_no > 999999 then
            raise exception 'Reference series % for branch % is full', v_series, p_branch_code;
        end if;
        v_ref := v_dest || trim(v_branch_digit) || p_cargo_code || lpad(v_no::text, 6, '0');
        exit when not exists (select 1 from bookings where awb = v_ref);
    end loop;
    return v_ref;
end $$;

-- ---------- 2. where each box is ----------
alter table public.booking_pieces add column if not exists at_branch text;
update public.booking_pieces p set at_branch = b.branch_code from public.bookings b where b.id = p.booking_id and p.at_branch is null;
create index if not exists booking_pieces_at_idx on public.booking_pieces (at_branch);

-- a new box starts where its booking is
create or replace function public.booking_piece_place() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    if new.at_branch is null then new.at_branch := (select branch_code from public.bookings where id = new.booking_id); end if;
    return new;
end $$;
drop trigger if exists booking_piece_place on public.booking_pieces;
create trigger booking_piece_place before insert on public.booking_pieces for each row execute function public.booking_piece_place();

-- an admin moving a booking to another branch (booking edit) takes the boxes that were at the old branch along
-- (transfer_inbound changes at_branch itself first, so for transfers nothing is left to move here)
create or replace function public.booking_boxes_follow() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    update public.booking_pieces set at_branch = new.branch_code where booking_id = new.id and at_branch = old.branch_code;
    return new;
end $$;
drop trigger if exists booking_boxes_follow on public.bookings;
create trigger booking_boxes_follow after update of branch_code on public.bookings
    for each row when (old.branch_code is distinct from new.branch_code) execute function public.booking_boxes_follow();

-- boxes of one booking at a branch (sorted)
create or replace function public.boxes_at(p_booking uuid, p_branch text) returns integer[]
language sql stable set search_path to 'public' as
$$ select array_agg(piece_no order by piece_no) from public.booking_pieces where booking_id = p_booking and at_branch = p_branch $$;

create or replace function public.transfer_outbound(
    p_awbs text[], p_from text, p_to text, p_vehicle text, p_driver text, p_seal text, p_notes text,
    p_user_id uuid, p_user_name text, p_pieces jsonb default null
) returns jsonb
language plpgsql set search_path to 'public' as $$
declare
    m public.transfer_manifests%rowtype;
    b public.bookings%rowtype;
    v_awb text; v_to_name text; v_to_type text; v_here integer[]; v_sel integer[]; v_total integer; v_note text;
begin
    if coalesce(trim(p_to), '') = '' or upper(p_to) = upper(p_from) then raise exception 'Choose a different destination branch.'; end if;
    select branch_name, branch_type into v_to_name, v_to_type from public.branches where branch_code = p_to;
    if not found then raise exception 'Branch % not found.', p_to; end if;
    if v_to_type = 'main_office' then raise exception 'Cargo goes to a branch or the warehouse, not to Main Office.'; end if;
    if coalesce(array_length(p_awbs, 1), 0) = 0 then raise exception 'Scan at least one shipment.'; end if;
    insert into public.transfer_manifests (from_branch, to_branch, vehicle, driver, seal_no, notes, created_by, created_by_name)
    values (p_from, p_to, nullif(trim(p_vehicle), ''), nullif(trim(p_driver), ''), nullif(trim(p_seal), ''), nullif(trim(p_notes), ''), p_user_id, p_user_name)
    returning * into m;
    update public.transfer_manifests set manifest_no = 'TR-' || p_from || '-' || lpad(m.id::text, 5, '0') where id = m.id
    returning * into m;
    foreach v_awb in array p_awbs loop
        select * into b from public.bookings where awb = upper(trim(v_awb)) for update;
        if not found then raise exception 'Booking % not found', v_awb; end if;
        if b.current_stage >= 8 or b.current_status_code = 'CANCELLED' then raise exception 'Booking % is closed (%).', b.awb, b.current_status; end if;
        if exists (select 1 from public.transfers where booking_id = b.id and status = 'pending') then
            raise exception 'Booking % is already in transit on another manifest.', b.awb;
        end if;
        v_here := public.boxes_at(b.id, p_from);
        if v_here is null then raise exception 'No box of % is at %.', b.awb, p_from; end if;
        select count(*) into v_total from public.booking_pieces where booking_id = b.id;
        v_sel := v_here;
        if p_pieces ? b.awb then
            select array_agg(distinct x::integer order by x::integer) into v_sel from jsonb_array_elements_text(p_pieces -> b.awb) x where x::integer = any(v_here);
            if v_sel is null or cardinality(v_sel) = 0 then raise exception 'Tick at least one box of % that is at %.', b.awb, p_from; end if;
        end if;
        if cardinality(v_sel) >= v_total then v_sel := null; end if;          -- null = the whole shipment
        v_note := case when v_sel is not null then 'Boxes ' || array_to_string(v_sel, ', ') || ' of ' || v_total || ' • ' else '' end;
        insert into public.transfers (booking_id, from_branch, to_branch, sent_by, manifest_id, pieces)
        values (b.id, p_from, p_to, p_user_id, m.id, v_sel);
        if b.current_sort < 310 then
            perform public.set_status_pieces(b.awb, v_sel, 'OUTBOUND_HUB', p_user_id, p_user_name, p_from, null,
                                             'To: ' || p_to || ' • ' || m.manifest_no, false, 'scan');
        else
            perform public.add_event(b.id, 'Sent to ' || coalesce(v_to_name, p_to), v_note || m.manifest_no, p_user_id, p_user_name, p_from);
        end if;
    end loop;
    return jsonb_build_object('id', m.id, 'manifest_no', m.manifest_no, 'count', array_length(p_awbs, 1));
end $$;

create or replace function public.transfer_inbound(p_awbs text[], p_branch text, p_user_id uuid, p_user_name text, p_note text default null, p_pieces jsonb default null)
returns jsonb
language plpgsql set search_path to 'public' as $$
declare
    v_awb text;
    b public.bookings%rowtype;
    t public.transfers%rowtype;
    v_from_name text; v_total integer; v_sent integer[]; v_got integer[]; v_missing integer[]; v_box text; v_remark text;
    out jsonb := '[]'::jsonb;
    v_ids bigint[] := '{}';
begin
    foreach v_awb in array p_awbs loop
        select * into b from public.bookings where awb = upper(trim(v_awb)) for update;
        if not found then out := out || jsonb_build_object('awb', upper(trim(v_awb)), 'result', 'not_found'); continue; end if;
        select * into t from public.transfers where booking_id = b.id and status = 'pending' for update;
        if not found then
            out := out || jsonb_build_object('awb', b.awb, 'result', case when public.boxes_at(b.id, p_branch) is not null then 'already_here' else 'not_expected' end);
            continue;
        end if;
        if t.to_branch <> p_branch then
            out := out || jsonb_build_object('awb', b.awb, 'result', 'wrong_branch', 'to_branch', t.to_branch);
            continue;
        end if;
        select count(*) into v_total from public.booking_pieces where booking_id = b.id;
        v_sent := coalesce(t.pieces, (select array_agg(piece_no order by piece_no) from public.booking_pieces where booking_id = b.id));
        v_got := v_sent;
        if p_pieces ? b.awb then
            select array_agg(distinct x::integer order by x::integer) into v_got from jsonb_array_elements_text(p_pieces -> b.awb) x where x::integer = any(v_sent);
            if v_got is null or cardinality(v_got) = 0 then
                out := out || jsonb_build_object('awb', b.awb, 'result', 'no_boxes');
                continue;
            end if;
        end if;
        select array_agg(x order by x) into v_missing from unnest(v_sent) x where not (x = any(v_got));
        v_box := case when v_missing is not null then 'Received boxes ' || array_to_string(v_got, ', ') || ' of ' || v_total || ' — MISSING box ' || array_to_string(v_missing, ', ')
                      when t.pieces is not null then 'Boxes ' || array_to_string(v_got, ', ') || ' of ' || v_total end;
        v_remark := nullif(concat_ws(' • ', v_box, nullif(trim(p_note), '')), '');
        update public.transfers set status = 'received', inbound_at = now(), received_by = p_user_id, note = v_remark,
               received_pieces = case when v_missing is null and t.pieces is null then null else v_got end, missing_pieces = v_missing
        where id = t.id;
        -- the boxes that arrived are here now; missing ones are in nobody's stock until found
        update public.booking_pieces set at_branch = p_branch, updated_at = now() where booking_id = b.id and piece_no = any(v_got);
        if v_missing is not null then
            update public.booking_pieces set at_branch = null, updated_at = now() where booking_id = b.id and piece_no = any(v_missing);
        end if;
        -- the shipment belongs to the receiver once no box is left at the sender
        if public.boxes_at(b.id, t.from_branch) is null then
            update public.bookings set branch_code = p_branch, updated_at = now() where id = b.id;
        else
            update public.bookings set updated_at = now() where id = b.id;
        end if;
        select branch_name into v_from_name from public.branches where branch_code = t.from_branch;
        if b.current_status_code = 'OUTBOUND_HUB' then
            perform public.set_status_pieces(b.awb, case when cardinality(v_got) >= v_total then null else v_got end, 'ARRIVED_ORIGIN_HUB', p_user_id, p_user_name, p_branch, null,
                                             concat_ws(' • ', 'From: ' || t.from_branch, case when v_missing is not null then 'MISSING box ' || array_to_string(v_missing, ', ') end, nullif(trim(p_note), '')), false, 'scan');
        else
            perform public.add_event(b.id, 'Received at ' || p_branch || ' from ' || coalesce(v_from_name, t.from_branch), v_remark, p_user_id, p_user_name, p_branch);
        end if;
        if t.manifest_id is not null then v_ids := array_append(v_ids, t.manifest_id); end if;
        out := out || jsonb_build_object('awb', b.awb, 'result', case when v_missing is null then 'received' else 'received_short' end,
                                         'manifest_id', t.manifest_id, 'missing', to_jsonb(v_missing), 'boxes', v_total);
    end loop;

    update public.transfer_manifests m set
        status = case when exists (select 1 from public.transfers x where x.manifest_id = m.id and x.status = 'pending') then 'partial' else 'received' end,
        received_at = coalesce(m.received_at, now()),
        received_by_name = coalesce(m.received_by_name, p_user_name)
    where m.id = any(v_ids);
    return out;
end $$;

-- Cargo on hand at a location: boxes that are there and have not left with the agent / been delivered,
-- not counting boxes already sent out on a manifest that is on the way. One row per shipment.
create or replace function public.cargo_stock(p_branch text)
returns table (awb text, consignee text, dest_city text, dest_country text, current_status text, boxes_total integer,
               boxes integer[], weight numeric, cbm numeric, since timestamptz)
language sql stable set search_path to 'public' as $$
    select b.awb, b.consignee, b.dest_city, b.dest_country, b.current_status,
           (select count(*)::int from public.booking_pieces x where x.booking_id = b.id),
           array_agg(p.piece_no order by p.piece_no),
           round(sum(coalesce(p.weight, b.weight / greatest(coalesce(b.pieces, 1), 1), 0)), 2),
           round(sum(coalesce(p.l, 0) * coalesce(p.w, 0) * coalesce(p.h, 0)) / 1000000.0, 3),
           max(p.updated_at)
    from public.booking_pieces p
    join public.bookings b on b.id = p.booking_id
    left join public.statuses s on s.code = coalesce(p.status_code, b.current_status_code)
    where p.at_branch = p_branch
      and not coalesce(b.archived, false)
      and coalesce(p.status_code, b.current_status_code) not in ('CANCELLED', 'RETURNED_TO_SHIPPER', 'DELIVERED')
      and coalesce(s.sort, 0) < 430
      and not exists (select 1 from public.transfers t where t.booking_id = b.id and t.status = 'pending' and t.from_branch = p_branch
                      and (t.pieces is null or p.piece_no = any(t.pieces)))
    group by b.id
    order by max(p.updated_at) desc;
$$;

-- ---------- 3. consolidation bills shared by branch ----------
-- The branch that booked a shipment keeps it for costs (and earns its revenue), wherever the boxes are now.
alter table public.bookings add column if not exists booked_branch text;
update public.bookings set booked_branch = branch_code where booked_branch is null;
create or replace function public.booking_booked_branch() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    if new.booked_branch is null then new.booked_branch := new.branch_code; end if;
    return new;
end $$;
drop trigger if exists booking_booked_branch on public.bookings;
create trigger booking_booked_branch before insert on public.bookings for each row execute function public.booking_booked_branch();

create or replace function public.consolidation_branch_shares(p_id bigint)
returns table (branch_code text, basis numeric, share numeric)
language sql stable set search_path to 'public' as $$
    with c as (select kind from public.consolidations where id = p_id),
    items as (
        select coalesce(b.booked_branch, b.branch_code) as branch_code,
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
    g as (select i.branch_code, sum(i.basis) basis, count(*) n from items i group by i.branch_code),
    t as (select sum(basis) s, sum(n) n from g)
    select g.branch_code, round(g.basis, 4), case when t.s > 0 then g.basis / t.s else g.n::numeric / t.n end
    from g cross join t where t.n > 0 order by g.branch_code;
$$;

create or replace function public.cost_bill_create(
    p_branch text, p_supplier_id bigint, p_consolidation_id bigint, p_booking_id uuid, p_type text, p_description text,
    p_currency text, p_amount numeric, p_pay_method text, p_bill_ref text, p_date date, p_user_name text
) returns jsonb
language plpgsql set search_path to 'public' as $$
declare v_no text; v_id bigint; v_amt numeric := round(p_amount, 3); v_for text; v_date date := coalesce(p_date, current_date);
        v_cur text := upper(p_currency); v_credit text; v_shares jsonb := '[]'; v_left numeric; v_a numeric; v_own numeric; v_away numeric := 0;
        r record; v_n integer; v_i integer := 0; v_split boolean := false;
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if p_type not in ('freight', 'customs', 'trucking', 'handling', 'other') then raise exception 'Choose the cost type.'; end if;
    if p_consolidation_id is null and p_booking_id is null then raise exception 'Choose the MAWB / container or the shipment.'; end if;
    if p_pay_method not in ('cash', 'card', 'bank', 'credit') then raise exception 'Choose how it was paid.'; end if;
    if p_pay_method = 'credit' and p_supplier_id is null then raise exception 'Choose the agent / supplier for a bill on credit.'; end if;
    v_for := coalesce((select kind || ' ' || mawb from public.consolidations where id = p_consolidation_id), (select awb from public.bookings where id = p_booking_id));
    v_credit := case when p_pay_method = 'credit' then '2000' else public.cash_account(p_pay_method) end;

    -- shares of the branches inside the consolidation (rounded; the last one takes the rest)
    if p_consolidation_id is not null and public.main_office_code() is not null then
        select count(*) into v_n from public.consolidation_branch_shares(p_consolidation_id);
        v_left := v_amt;
        for r in select * from public.consolidation_branch_shares(p_consolidation_id) loop
            v_i := v_i + 1;
            v_a := case when v_i = v_n then v_left else round(v_amt * r.share, 3) end;
            v_left := v_left - v_a;
            if v_a > 0 then v_shares := v_shares || jsonb_build_array(jsonb_build_object('branch', r.branch_code, 'amount', v_a)); end if;
        end loop;
        v_split := exists (select 1 from jsonb_array_elements(v_shares) x where x->>'branch' <> p_branch)
                   and not exists (select 1 from jsonb_array_elements(v_shares) x where public.branch_currency(x->>'branch') <> v_cur);
    end if;

    v_no := public.next_doc_no(p_branch, 'CST');
    insert into public.cost_bills (bill_no, branch_code, supplier_id, consolidation_id, booking_id, cost_type, description, currency, amount, paid, status, bill_ref, bill_date, created_by_name, split)
    values (v_no, p_branch, p_supplier_id, p_consolidation_id, p_booking_id, p_type, nullif(trim(p_description), ''), v_cur, v_amt,
            case when p_pay_method = 'credit' then 0 else v_amt end, case when p_pay_method = 'credit' then 'unpaid' else 'paid' end,
            nullif(trim(p_bill_ref), ''), v_date, p_user_name, v_split)
    returning id into v_id;

    if not v_split then
        perform public.post_journal(v_date, p_branch, v_cur, 'cost', v_id, v_no || ' · ' || p_type || ' · ' || coalesce(v_for, ''), p_user_name,
            jsonb_build_array(
                jsonb_build_object('account', public.cost_account(p_type), 'debit', v_amt),
                jsonb_build_object('account', v_credit, 'credit', v_amt)));
        return jsonb_build_object('id', v_id, 'bill_no', v_no, 'shares', '[]'::jsonb);
    end if;

    insert into public.cost_bill_shares (cost_bill_id, branch_code, amount)
    select v_id, x->>'branch', (x->>'amount')::numeric from jsonb_array_elements(v_shares) x;
    v_own := coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(v_shares) x where x->>'branch' = p_branch), 0);
    v_away := v_amt - v_own;
    -- the branch that took the bill: its own share is its cost, the rest is owed back to it through Main Office
    perform public.post_journal(v_date, p_branch, v_cur, 'cost', v_id, v_no || ' · ' || p_type || ' · shared · ' || coalesce(v_for, ''), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', public.cost_account(p_type), 'debit', v_own),
            jsonb_build_object('account', public.interoffice_account(p_branch), 'debit', v_away),
            jsonb_build_object('account', v_credit, 'credit', v_amt)));
    -- every other branch: its share is its cost, owed to Main Office
    for r in select x->>'branch' br, (x->>'amount')::numeric amt from jsonb_array_elements(v_shares) x where x->>'branch' <> p_branch loop
        perform public.post_journal(v_date, r.br, v_cur, 'cost', v_id, v_no || ' · ' || p_type || ' · share (bill at ' || p_branch || ') · ' || coalesce(v_for, ''), p_user_name,
            jsonb_build_array(
                jsonb_build_object('account', public.cost_account(p_type), 'debit', r.amt),
                jsonb_build_object('account', public.interoffice_account(r.br), 'credit', r.amt)));
    end loop;
    return jsonb_build_object('id', v_id, 'bill_no', v_no, 'shares', v_shares);
end $$;

revoke all on function public.cargo_stock(text) from public, anon, authenticated;
revoke all on function public.transfer_outbound(text[], text, text, text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.transfer_inbound(text[], text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cost_bill_create(text, bigint, bigint, uuid, text, text, text, numeric, text, text, date, text) from public, anon, authenticated;
