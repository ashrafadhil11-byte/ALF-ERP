-- 010 — Phase B: delivery runs, proof of delivery (POD), customer review.
-- A booking can have many delivery attempts; at most one is open ('out') at a time.
-- Access is service-role only (through /api/delivery and /api/track), like every other table.

create table if not exists public.deliveries (
    id                bigserial primary key,
    booking_id        uuid not null references public.bookings(id) on delete cascade,
    awb               text not null,
    attempt           smallint not null default 1,
    mode              text not null check (mode in ('driver', 'agent', 'collection')),
    driver_id         uuid,                 -- employees.id when our own driver
    driver_name       text,
    agent_name        text,                 -- 3rd-party delivery company
    agent_ref         text,                 -- their tracking / docket no.
    branch_code       text,
    status            text not null default 'out' check (status in ('out', 'delivered', 'failed', 'cancelled')),
    assigned_at       timestamptz not null default now(),
    assigned_by_name  text,
    completed_at      timestamptz,
    completed_by_name text,
    received_by       text,
    receiver_relation text,
    receiver_id_no    text,
    failure_reason    text,
    notes             text,
    pod_photo         text,                 -- path in the private "pod" storage bucket
    pod_signature     text,
    lat               numeric,
    lng               numeric
);
create unique index if not exists deliveries_one_open on public.deliveries (booking_id) where status = 'out';
create index if not exists deliveries_driver_idx on public.deliveries (driver_id, status);
create index if not exists deliveries_branch_idx on public.deliveries (branch_code, status);
alter table public.deliveries enable row level security;

alter table public.bookings
    add column if not exists delivered_at   timestamptz,
    add column if not exists review_token   text unique,
    add column if not exists review_rating  smallint check (review_rating between 1 and 5),
    add column if not exists review_comment text,
    add column if not exists reviewed_at    timestamptz;

-- Private bucket for POD photos and signatures (read through short-lived signed URLs only)
do $$ begin
    if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('pod', 'pod', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
        on conflict (id) do nothing;
    end if;
end $$;

-- ---------------------------------------------------------------
-- Send shipments out for delivery (own driver or 3rd-party agent)
-- ---------------------------------------------------------------
create or replace function public.delivery_dispatch(
    p_awbs        text[],
    p_mode        text,
    p_driver_id   uuid,
    p_driver_name text,
    p_agent_name  text,
    p_agent_ref   text,
    p_user_id     uuid,
    p_user_name   text,
    p_branch      text
) returns integer
language plpgsql
set search_path = public
as $$
declare
    b public.bookings%rowtype;
    v_awb text;
    v_attempt smallint;
    v_remark text;
    n integer := 0;
begin
    if p_mode not in ('driver', 'agent') then raise exception 'Choose a driver or a delivery agent.'; end if;
    if p_mode = 'driver' and coalesce(trim(p_driver_name), '') = '' then raise exception 'Choose the driver.'; end if;
    if p_mode = 'agent' and coalesce(trim(p_agent_name), '') = '' then raise exception 'Enter the delivery agent.'; end if;
    v_remark := case when p_mode = 'driver' then 'Driver: ' || trim(p_driver_name)
                     else 'Agent: ' || trim(p_agent_name) || coalesce(' / ' || nullif(trim(p_agent_ref), ''), '') end;

    foreach v_awb in array p_awbs loop
        select * into b from public.bookings where awb = upper(trim(v_awb)) for update;
        if not found then raise exception 'Booking % not found', v_awb; end if;
        if b.current_stage >= 8 then raise exception 'Booking % is already delivered.', b.awb; end if;
        if b.current_status_code = 'CANCELLED' then raise exception 'Booking % is cancelled.', b.awb; end if;
        if exists (select 1 from public.deliveries where booking_id = b.id and status = 'out') then
            raise exception 'Booking % is already out for delivery — mark that attempt first.', b.awb;
        end if;
        select coalesce(max(attempt), 0) + 1 into v_attempt from public.deliveries where booking_id = b.id;

        insert into public.deliveries (booking_id, awb, attempt, mode, driver_id, driver_name, agent_name, agent_ref, branch_code, assigned_by_name)
        values (b.id, b.awb, v_attempt, p_mode,
                case when p_mode = 'driver' then p_driver_id end,
                case when p_mode = 'driver' then trim(p_driver_name) end,
                case when p_mode = 'agent' then trim(p_agent_name) end,
                case when p_mode = 'agent' then nullif(trim(p_agent_ref), '') end,
                coalesce(p_branch, b.branch_code), p_user_name);

        -- allow_back: a parcel waiting "Ready for collection" can still be sent out
        perform public.set_status(array[b.awb], 'OUT_FOR_DELIVERY', p_user_id, p_user_name, p_branch, null,
                                  case when v_attempt > 1 then 'Attempt ' || v_attempt || ' • ' else '' end || v_remark,
                                  now(), true, 'manual');
        n := n + 1;
    end loop;
    return n;
end;
$$;

-- ---------------------------------------------------------------
-- Close a delivery attempt: delivered (with POD) or failed (with reason).
-- "Delivered" with no open attempt = customer collected it at the branch.
-- ---------------------------------------------------------------
create or replace function public.delivery_complete(
    p_awb        text,
    p_outcome    text,
    p_received_by text,
    p_relation   text,
    p_id_no      text,
    p_reason     text,
    p_notes      text,
    p_photo      text,
    p_signature  text,
    p_lat        numeric,
    p_lng        numeric,
    p_user_id    uuid,
    p_user_name  text,
    p_branch     text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
    b public.bookings%rowtype;
    d public.deliveries%rowtype;
    v_token text;
begin
    if p_outcome not in ('delivered', 'failed') then raise exception 'Unknown outcome.'; end if;
    select * into b from public.bookings where awb = upper(trim(p_awb)) for update;
    if not found then raise exception 'Booking % not found', p_awb; end if;
    if b.current_stage >= 8 then raise exception 'Booking % is already delivered.', b.awb; end if;

    select * into d from public.deliveries where booking_id = b.id and status = 'out' for update;
    if not found then
        if p_outcome = 'failed' then raise exception 'Booking % is not out for delivery.', b.awb; end if;
        insert into public.deliveries (booking_id, awb, attempt, mode, branch_code, assigned_by_name)
        values (b.id, b.awb, (select coalesce(max(attempt), 0) + 1 from public.deliveries where booking_id = b.id),
                'collection', coalesce(p_branch, b.branch_code), p_user_name)
        returning * into d;
    end if;

    if p_outcome = 'delivered' then
        if coalesce(trim(p_received_by), '') = '' then raise exception 'Enter who received the shipment.'; end if;
        update public.deliveries set status = 'delivered', completed_at = now(), completed_by_name = p_user_name,
            received_by = trim(p_received_by), receiver_relation = nullif(trim(p_relation), ''), receiver_id_no = nullif(trim(p_id_no), ''),
            notes = nullif(trim(p_notes), ''), pod_photo = p_photo, pod_signature = p_signature, lat = p_lat, lng = p_lng
        where id = d.id;
        perform public.set_status(array[b.awb], 'DELIVERED', p_user_id, p_user_name, p_branch, null,
            'Received by ' || trim(p_received_by) || coalesce(' (' || nullif(trim(p_relation), '') || ')', '')
                || case when d.mode = 'collection' then ' • collected at branch' else '' end,
            now(), true, 'manual');
        v_token := coalesce(b.review_token, replace(gen_random_uuid()::text, '-', ''));
        update public.bookings set delivered_at = now(), review_token = v_token where id = b.id;
    else
        if coalesce(trim(p_reason), '') = '' then raise exception 'Choose why the delivery failed.'; end if;
        update public.deliveries set status = 'failed', completed_at = now(), completed_by_name = p_user_name,
            failure_reason = trim(p_reason), notes = nullif(trim(p_notes), ''), pod_photo = p_photo, lat = p_lat, lng = p_lng
        where id = d.id;
        perform public.set_status(array[b.awb], 'DELIVERY_FAILED', p_user_id, p_user_name, p_branch, null,
            'Attempt ' || d.attempt || ': ' || trim(p_reason) || coalesce(' • ' || nullif(trim(p_notes), ''), ''),
            now(), true, 'manual');
    end if;
    return jsonb_build_object('awb', b.awb, 'attempt', d.attempt, 'outcome', p_outcome, 'review_token', v_token);
end;
$$;

-- ---------------------------------------------------------------
-- Customer review from the public tracking page (one per shipment)
-- ---------------------------------------------------------------
create or replace function public.review_submit(p_token text, p_rating integer, p_comment text)
returns text
language plpgsql
set search_path = public
as $$
declare b public.bookings%rowtype;
begin
    if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose 1 to 5 stars.'; end if;
    select * into b from public.bookings where review_token = p_token for update;
    if not found then raise exception 'This review link is not valid.'; end if;
    if b.reviewed_at is not null then raise exception 'Thank you — this shipment is already reviewed.'; end if;
    update public.bookings set review_rating = p_rating, review_comment = left(nullif(trim(p_comment), ''), 1000), reviewed_at = now()
    where id = b.id;
    perform public.set_status(array[b.awb], 'REVIEWED', null, 'Customer', b.branch_code, null,
        p_rating || '★' || coalesce(' • ' || left(nullif(trim(p_comment), ''), 200), ''), now(), true, 'system');
    return b.awb;
end;
$$;

revoke all on function public.delivery_dispatch(text[], text, uuid, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.delivery_complete(text, text, text, text, text, text, text, text, text, numeric, numeric, uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_submit(text, integer, text) from public, anon, authenticated;
