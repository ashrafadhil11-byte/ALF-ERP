-- 011 — Branch transfers (outbound / inbound manifests), consolidation (MAWB / bag), notification read marker.
-- Status rule: a transfer or consolidation never moves a shipment backwards. Early shipments get the
-- matching milestone (In Transit to Hub / Arrived at Origin Hub / Consolidated); later ones only get a
-- timeline entry, so their customer status stays correct and they are not counted as exceptions.

-- ---------------------------------------------------------------
-- 1. Transfer manifests
-- ---------------------------------------------------------------
create table if not exists public.transfer_manifests (
    id               bigserial primary key,
    manifest_no      text unique,
    from_branch      text not null,
    to_branch        text not null,
    vehicle          text,
    driver           text,
    seal_no          text,
    notes            text,
    status           text not null default 'in_transit' check (status in ('in_transit', 'partial', 'received', 'cancelled')),
    created_at       timestamptz not null default now(),
    created_by       uuid,
    created_by_name  text,
    received_at      timestamptz,
    received_by_name text
);
create index if not exists transfer_manifests_to_idx on public.transfer_manifests (to_branch, status);
create index if not exists transfer_manifests_from_idx on public.transfer_manifests (from_branch, created_at desc);
alter table public.transfer_manifests enable row level security;

alter table public.transfers
    add column if not exists manifest_id bigint references public.transfer_manifests(id) on delete cascade,
    add column if not exists note text;
create index if not exists transfers_manifest_idx on public.transfers (manifest_id);
create unique index if not exists transfers_one_pending on public.transfers (booking_id) where status = 'pending';

-- timeline entry without changing the status
create or replace function public.add_event(p_booking uuid, p_text text, p_remark text, p_user_id uuid, p_user_name text, p_branch text)
returns void language sql set search_path = public as $$
    insert into public.tracking_events (booking_id, status_code, status, location, remark, created_by, created_by_name, branch_code, source)
    values (p_booking, null, p_text, p_branch, p_remark, p_user_id, p_user_name, p_branch, 'scan');
$$;

create or replace function public.transfer_outbound(
    p_awbs text[], p_from text, p_to text, p_vehicle text, p_driver text, p_seal text, p_notes text,
    p_user_id uuid, p_user_name text
) returns jsonb
language plpgsql set search_path = public as $$
declare
    m public.transfer_manifests%rowtype;
    b public.bookings%rowtype;
    v_awb text;
    v_to_name text;
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
        insert into public.transfers (booking_id, from_branch, to_branch, sent_by, manifest_id)
        values (b.id, p_from, p_to, p_user_id, m.id);
        if b.current_sort < 310 then
            perform public.set_status(array[b.awb], 'OUTBOUND_HUB', p_user_id, p_user_name, p_from, null,
                                      'To: ' || p_to || ' • ' || m.manifest_no, now(), false, 'scan');
        else
            perform public.add_event(b.id, 'Sent to ' || coalesce(v_to_name, p_to), m.manifest_no, p_user_id, p_user_name, p_from);
        end if;
    end loop;
    return jsonb_build_object('id', m.id, 'manifest_no', m.manifest_no, 'count', array_length(p_awbs, 1));
end;
$$;

-- Receive scanned AWBs at p_branch. Returns per-AWB results; never fails the whole batch for one bad scan.
create or replace function public.transfer_inbound(p_awbs text[], p_branch text, p_user_id uuid, p_user_name text, p_note text default null)
returns jsonb
language plpgsql set search_path = public as $$
declare
    v_awb text;
    b public.bookings%rowtype;
    t public.transfers%rowtype;
    v_from_name text;
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
        update public.transfers set status = 'received', inbound_at = now(), received_by = p_user_id, note = nullif(trim(p_note), '') where id = t.id;
        update public.bookings set branch_code = p_branch, updated_at = now() where id = b.id;
        select branch_name into v_from_name from public.branches where branch_code = t.from_branch;
        if b.current_status_code = 'OUTBOUND_HUB' then
            perform public.set_status(array[b.awb], 'ARRIVED_ORIGIN_HUB', p_user_id, p_user_name, p_branch, null,
                                      'From: ' || t.from_branch || coalesce(' • ' || nullif(trim(p_note), ''), ''), now(), false, 'scan');
        else
            perform public.add_event(b.id, 'Received at ' || p_branch || ' from ' || coalesce(v_from_name, t.from_branch), nullif(trim(p_note), ''), p_user_id, p_user_name, p_branch);
        end if;
        if t.manifest_id is not null then v_ids := array_append(v_ids, t.manifest_id); end if;
        out := out || jsonb_build_object('awb', b.awb, 'result', 'received', 'manifest_id', t.manifest_id);
    end loop;

    update public.transfer_manifests m set
        status = case when exists (select 1 from public.transfers x where x.manifest_id = m.id and x.status = 'pending') then 'partial' else 'received' end,
        received_at = coalesce(m.received_at, now()),
        received_by_name = coalesce(m.received_by_name, p_user_name)
    where m.id = any(v_ids);
    return out;
end;
$$;

-- ---------------------------------------------------------------
-- 2. Consolidation (MAWB / bag)
-- ---------------------------------------------------------------
alter table public.consolidations
    add column if not exists kind            text not null default 'mawb' check (kind in ('mawb', 'bag')),
    add column if not exists origin_branch   text,
    add column if not exists dest_country    text,
    add column if not exists carrier         text,
    add column if not exists flight_no       text,
    add column if not exists departure_date  date,
    add column if not exists notes           text,
    add column if not exists closed          boolean not null default false,
    add column if not exists closed_at       timestamptz,
    add column if not exists created_by_name text;
alter table public.consolidation_items add column if not exists added_at timestamptz not null default now();
create index if not exists consolidation_items_booking_idx on public.consolidation_items (booking_id);

create or replace function public.consolidation_add(p_id bigint, p_awbs text[], p_user_id uuid, p_user_name text, p_branch text)
returns integer
language plpgsql set search_path = public as $$
declare
    c public.consolidations%rowtype;
    b public.bookings%rowtype;
    v_awb text;
    v_other text;
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
        insert into public.consolidation_items (consolidation_id, booking_id) values (c.id, b.id);
        if b.current_sort < 340 then
            perform public.set_status(array[b.awb], 'CONSOLIDATED', p_user_id, p_user_name, p_branch, null,
                                      upper(c.kind) || ': ' || c.mawb, now(), false, 'scan');
        else
            perform public.add_event(b.id, 'Added to ' || upper(c.kind) || ' ' || c.mawb, null, p_user_id, p_user_name, p_branch);
        end if;
        n := n + 1;
    end loop;
    return n;
end;
$$;

create or replace function public.consolidation_remove(p_id bigint, p_awb text, p_user_id uuid, p_user_name text, p_branch text)
returns void
language plpgsql set search_path = public as $$
declare c public.consolidations%rowtype; b public.bookings%rowtype;
begin
    select * into c from public.consolidations where id = p_id for update;
    if not found then raise exception 'Consolidation not found.'; end if;
    if c.closed then raise exception '% is closed — reopen it first.', c.mawb; end if;
    select * into b from public.bookings where awb = upper(trim(p_awb));
    if not found then raise exception 'Booking % not found', p_awb; end if;
    delete from public.consolidation_items where consolidation_id = c.id and booking_id = b.id;
    if not found then raise exception '% is not in %.', b.awb, c.mawb; end if;
    perform public.add_event(b.id, 'Removed from ' || upper(c.kind) || ' ' || c.mawb, null, p_user_id, p_user_name, p_branch);
end;
$$;

-- ---------------------------------------------------------------
-- 3. Notifications: everything after this time is "unread" for the user
-- ---------------------------------------------------------------
alter table public.employees add column if not exists notif_seen_at timestamptz;

revoke all on function public.add_event(uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.transfer_outbound(text[], text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.transfer_inbound(text[], text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.consolidation_add(bigint, text[], uuid, text, text) from public, anon, authenticated;
revoke all on function public.consolidation_remove(bigint, text, uuid, text, text) from public, anon, authenticated;
