-- 016 — Boxes on branch transfers.
--  Sending: only the ticked boxes go on the manifest (null = all).
--  Receiving: staff tick the boxes that arrived; the rest are recorded as missing.

alter table public.transfers
    add column if not exists pieces          integer[],   -- boxes sent (null = all)
    add column if not exists received_pieces integer[],   -- boxes that arrived (null = all sent)
    add column if not exists missing_pieces  integer[];   -- sent but not received

drop function if exists public.transfer_outbound(text[], text, text, text, text, text, text, uuid, text);
create or replace function public.transfer_outbound(
    p_awbs text[], p_from text, p_to text, p_vehicle text, p_driver text, p_seal text, p_notes text,
    p_user_id uuid, p_user_name text, p_pieces jsonb default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
    m public.transfer_manifests%rowtype;
    b public.bookings%rowtype;
    v_awb text; v_to_name text; v_sel integer[]; v_total integer; v_note text;
begin
    if coalesce(trim(p_to), '') = '' or upper(p_to) = upper(p_from) then raise exception 'Choose a different destination branch.'; end if;
    select branch_name into v_to_name from public.branches where branch_code = p_to;
    if not found then raise exception 'Branch % not found.', p_to; end if;
    if coalesce(array_length(p_awbs, 1), 0) = 0 then raise exception 'Scan at least one shipment.'; end if;

    insert into public.transfer_manifests (from_branch, to_branch, vehicle, driver, seal_no, notes, created_by, created_by_name)
    values (p_from, p_to, nullif(trim(p_vehicle), ''), nullif(trim(p_driver), ''), nullif(trim(p_seal), ''), nullif(trim(p_notes), ''), p_user_id, p_user_name)
    returning * into m;
    update public.transfer_manifests set manifest_no = 'TR-' || p_from || '-' || lpad(m.id::text, 5, '0') where id = m.id
    returning * into m;

    foreach v_awb in array p_awbs loop
        select * into b from public.bookings where awb = upper(trim(v_awb)) for update;
        if not found then raise exception 'Booking % not found', v_awb; end if;
        if b.branch_code is distinct from p_from then raise exception 'Booking % is not held by %.', b.awb, p_from; end if;
        if b.current_stage >= 8 or b.current_status_code = 'CANCELLED' then raise exception 'Booking % is closed (%).', b.awb, b.current_status; end if;
        if exists (select 1 from public.transfers where booking_id = b.id and status = 'pending') then
            raise exception 'Booking % is already in transit on another manifest.', b.awb;
        end if;
        select count(*) into v_total from public.booking_pieces where booking_id = b.id;
        v_sel := null;
        if p_pieces ? b.awb then
            select array_agg(distinct x::integer order by x::integer) into v_sel from jsonb_array_elements_text(p_pieces -> b.awb) x where x::integer between 1 and v_total;
            if v_sel is null or cardinality(v_sel) = 0 then raise exception 'Tick at least one box of %.', b.awb; end if;
            if cardinality(v_sel) >= v_total then v_sel := null; end if;
        end if;
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
end;
$$;

-- p_pieces = { "AWB": [1,2] } boxes that arrived (missing AWB key = all boxes that were sent)
drop function if exists public.transfer_inbound(text[], text, uuid, text, text);
create or replace function public.transfer_inbound(p_awbs text[], p_branch text, p_user_id uuid, p_user_name text, p_note text default null, p_pieces jsonb default null)
returns jsonb
language plpgsql set search_path = public as $$
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
            out := out || jsonb_build_object('awb', b.awb, 'result', case when b.branch_code = p_branch then 'already_here' else 'not_expected' end);
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
        update public.bookings set branch_code = p_branch, updated_at = now() where id = b.id;
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
end;
$$;

revoke all on function public.transfer_outbound(text[], text, text, text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.transfer_inbound(text[], text, uuid, text, text, jsonb) from public, anon, authenticated;
