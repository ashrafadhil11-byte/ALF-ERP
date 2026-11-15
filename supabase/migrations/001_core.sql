-- ALF-ERP Phase 0 — core operations schema
-- Applied to Supabase project ALF-ERP on 2026-11-15. Safe to re-run (IF NOT EXISTS / ON CONFLICT).
--
-- Access model: every new table has RLS ON with no policies, so only the service-role key
-- (used inside /api functions) can read/write. Browsers never talk to these tables directly.
-- Branch links use branches.branch_code (text) so this works whatever type branches.id is.

-- ---------------------------------------------------------------
-- 1. Roles: 4 roles + driver flag
-- ---------------------------------------------------------------
alter table public.employees add column if not exists is_driver boolean not null default false;

-- Signup trigger: role now comes from app_metadata only (users can set user_metadata themselves,
-- so the old trigger let anyone sign up as super_admin). Public signups get role NULL = no access;
-- /api/create-user sets the real role right after signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employees (id, full_name, username, role, branch, contact_number,
                                recovery_email, oman_civil_id, date_of_birth)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'username',
    new.raw_app_meta_data->>'role',
    new.raw_user_meta_data->>'branch',
    new.raw_user_meta_data->>'contact_number',
    new.raw_user_meta_data->>'recovery_email',
    new.raw_user_meta_data->>'oman_civil_id',
    nullif(new.raw_user_meta_data->>'date_of_birth', '')::date
  );
  return new;
end;
$$;

-- One-time backfill: accounts created before the trigger existed have no employees row.
-- Trusts their current metadata role once (only pre-existing accounts), and copies it to app_metadata.
insert into public.employees (id, full_name, username, role, branch, contact_number,
                              recovery_email, oman_civil_id, date_of_birth)
select u.id,
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'username',
       coalesce(u.raw_app_meta_data->>'role', u.raw_user_meta_data->>'role'),
       u.raw_user_meta_data->>'branch',
       u.raw_user_meta_data->>'contact_number',
       coalesce(u.raw_user_meta_data->>'recovery_email', u.email),
       u.raw_user_meta_data->>'oman_civil_id',
       nullif(u.raw_user_meta_data->>'date_of_birth', '')::date
  from auth.users u
 where not exists (select 1 from public.employees e where e.id = u.id)
on conflict (id) do nothing;

update public.employees set is_driver = true where lower(role) = 'driver';
update public.employees set role = case lower(role)
        when 'super admin'  then 'super_admin'
        when 'admin'        then 'head_office'
        when 'head office'  then 'head_office'
        when 'branch_admin' then 'branch_manager'
        when 'employee'     then 'staff'
        when 'driver'       then 'staff'
        else lower(role) end
 where lower(role) not in ('super_admin', 'head_office', 'branch_manager', 'staff');

update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', e.role, 'branch', e.branch, 'is_driver', e.is_driver)
  from public.employees e
 where e.id = u.id and e.role is not null;

-- ---------------------------------------------------------------
-- 2. Branch finance settings (Phase 4b uses them)
-- ---------------------------------------------------------------
alter table public.branches add column if not exists currency  text    not null default 'OMR';
alter table public.branches add column if not exists tax_name  text    not null default 'VAT';
alter table public.branches add column if not exists tax_rate  numeric not null default 5;
alter table public.branches add column if not exists is_hub    boolean not null default false;

-- ---------------------------------------------------------------
-- 3. Status master (admin-customizable inside fixed stages)
--    stage 1 Booking · 2 Pickup · 3 Origin · 4 Export · 5 Transit
--          6 Destination · 7 Last mile · 8 Delivered · 9 Review
--    exceptions have stage NULL
-- ---------------------------------------------------------------
create table if not exists public.statuses (
    code            text primary key,
    label           text not null,
    customer_label  text,
    stage           smallint check (stage between 1 and 9),
    sort            integer not null default 0,
    is_exception    boolean not null default false,
    notify_customer boolean not null default false,
    requires        text[]  not null default '{}',   -- any of: remark, agent_docket, mawb, pod, driver, to_branch
    is_system       boolean not null default false,  -- code relies on it: may rename, may not deactivate
    active          boolean not null default true,
    created_at      timestamptz not null default now(),
    constraint statuses_stage_ck check ((is_exception and stage is null) or (not is_exception and stage is not null)),
    constraint statuses_system_active_ck check (not is_system or active)
);

-- sort = stage*100 + step*10, so new statuses fit in between (e.g. 315)
insert into public.statuses (code, label, customer_label, stage, sort, is_exception, notify_customer, requires, is_system) values
 ('BOOKED',               'Shipment Booked',                     'Booked',                      1, 110, false, true,  '{}',                true),
 ('PICKUP_ASSIGNED',      'Pickup Assigned',                     'Pickup Scheduled',            2, 210, false, false, '{driver}',          false),
 ('PICKED_UP',            'Picked Up',                           'Picked Up',                   2, 220, false, true,  '{}',                false),
 ('RECEIVED_BRANCH',      'Received at Branch',                  'Received at Branch',          2, 230, false, false, '{}',                true),
 ('OUTBOUND_HUB',         'In Transit to Hub',                   'In Transit',                  3, 310, false, false, '{to_branch}',       false),
 ('ARRIVED_ORIGIN_HUB',   'Arrived at Origin Hub',               'At Origin Hub',               3, 320, false, false, '{}',                false),
 ('SORTING',              'Sorting in Progress',                 'Processing',                  3, 330, false, false, '{}',                false),
 ('CONSOLIDATED',         'Consolidated (MAWB)',                 'Processing',                  3, 340, false, false, '{mawb}',            true),
 ('EXPORT_CUSTOMS',       'Awaiting Export Customs',             'Export Customs',              4, 410, false, false, '{}',                false),
 ('EXPORT_CLEARED',       'Export Customs Cleared',              'Export Cleared',              4, 420, false, false, '{}',                false),
 ('HANDED_TO_AGENT',      'Handed to Forwarding Agent',          'Handed to Carrier',           4, 430, false, false, '{agent_docket}',    true),
 ('DEPARTED_ORIGIN',      'Departed Origin',                     'Departed Origin',             4, 440, false, true,  '{}',                false),
 ('IN_TRANSIT',           'In Transit',                          'In Transit',                  5, 510, false, false, '{}',                false),
 ('ARRIVED_TRANSIT_HUB',  'Arrived at Transit Hub',              'In Transit',                  5, 520, false, false, '{}',                false),
 ('ARRIVED_DEST_PORT',    'Arrived at Destination Port',         'Arrived in Destination Country', 6, 610, false, false, '{}',             false),
 ('IMPORT_CUSTOMS',       'Awaiting Import Customs',             'Import Customs',              6, 620, false, false, '{}',                false),
 ('IMPORT_CLEARED',       'Import Customs Cleared',              'Import Cleared',              6, 630, false, false, '{}',                false),
 ('ARRIVED_DEST_HUB',     'Arrived at Destination Hub',          'At Destination Hub',          6, 640, false, true,  '{}',                false),
 ('OUT_FOR_DELIVERY',     'Out for Delivery',                    'Out for Delivery',            7, 710, false, true,  '{}',                false),
 ('READY_FOR_COLLECTION', 'Available for Pickup at Destination', 'Ready for Collection',        7, 720, false, true,  '{}',                false),
 ('DELIVERED',            'Delivered',                           'Delivered',                   8, 810, false, true,  '{}',                true),
 ('REVIEW_REQUESTED',     'Review Requested',                    'Delivered',                   9, 910, false, true,  '{}',                true),
 ('REVIEWED',             'Customer Reviewed',                   'Delivered',                   9, 920, false, false, '{}',                true),
 ('ON_HOLD',              'On Hold',                             'On Hold',                  null,   0, true,  true,  '{remark}',          false),
 ('CUSTOMS_HOLD',         'Customs Hold',                        'Held at Customs',          null,   0, true,  true,  '{remark}',          false),
 ('DELIVERY_FAILED',      'Delivery Attempt Failed',             'Delivery Attempted',       null,   0, true,  true,  '{remark}',          false),
 ('RETURNED_TO_FACILITY', 'Returned to Facility',                'Returned to Facility',     null,   0, true,  true,  '{remark}',          false),
 ('RETURNED_TO_SHIPPER',  'Returned to Shipper',                 'Returned to Sender',       null,   0, true,  true,  '{remark}',          false),
 ('CANCELLED',            'Cancelled',                           'Cancelled',                null,   0, true,  true,  '{remark}',          true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------
-- 4. Operations tables
-- ---------------------------------------------------------------
create table if not exists public.bookings (
    id                  uuid primary key default gen_random_uuid(),
    awb                 text not null unique,           -- text keeps leading zeros
    external_ref        text unique,                    -- alfarhaonline order_no
    source              text not null default 'manual' check (source in ('alfarhaonline', 'manual', 'sheet_import')),
    intake_mode         text not null default 'drop_off' check (intake_mode in ('pickup', 'drop_off')),
    booked_at           timestamptz not null default now(),
    branch_code         text,                           -- current holding branch
    shipper             text,
    shipper_phone       text,
    consignee           text,
    consignee_phone     text,                           -- optional, if API sends it
    consignee_address   text,                           -- optional
    origin_city         text,
    origin_country      text,
    dest_city           text,
    dest_country        text,
    package_type        text,
    weight              numeric,
    pieces              integer,
    declared_value      numeric,                        -- optional
    amount              numeric,                        -- optional, from API
    current_status_code text references public.statuses(code),
    current_status      text,                           -- label at time of update (fast list display)
    current_stage       smallint not null default 1,    -- last normal (non-exception) stage
    current_sort        integer  not null default 0,
    fwd_agent           text,
    fwd_docket          text,
    archived            boolean not null default false,
    raw                 jsonb,                          -- full alfarhaonline response
    fetched_at          timestamptz,
    created_by          uuid,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index if not exists bookings_branch_idx on public.bookings (branch_code) where not archived;
create index if not exists bookings_status_idx on public.bookings (current_status_code) where not archived;

create table if not exists public.tracking_events (
    id          bigserial primary key,
    booking_id  uuid not null references public.bookings(id) on delete cascade,
    status_code text references public.statuses(code),
    status      text not null,                          -- label as shown at the time (also holds legacy text)
    location    text,
    remark      text,
    event_at    timestamptz not null default now(),
    created_by  uuid,
    created_by_name text,
    branch_code text,
    source      text not null default 'manual' check (source in ('manual', 'scan', 'carrier_api', 'csv', 'system', 'sheet_import'))
);
create index if not exists tracking_events_booking_idx on public.tracking_events (booking_id, event_at);

create table if not exists public.transfers (
    id          bigserial primary key,
    booking_id  uuid not null references public.bookings(id) on delete cascade,
    from_branch text not null,
    to_branch   text not null,
    outbound_at timestamptz not null default now(),
    inbound_at  timestamptz,
    sent_by     uuid,
    received_by uuid,
    status      text not null default 'pending' check (status in ('pending', 'received', 'cancelled'))
);
create index if not exists transfers_pending_idx on public.transfers (to_branch) where status = 'pending';

create table if not exists public.consolidations (
    id          bigserial primary key,
    mawb        text not null unique,
    dest_branch text,
    status_code text references public.statuses(code),
    status      text,
    created_at  timestamptz not null default now(),
    created_by  uuid
);

create table if not exists public.consolidation_items (
    consolidation_id bigint not null references public.consolidations(id) on delete cascade,
    booking_id       uuid   not null references public.bookings(id) on delete cascade,
    primary key (consolidation_id, booking_id)
);

create table if not exists public.subscriptions (
    id         bigserial primary key,
    awb        text not null,
    email      text not null,
    created_at timestamptz not null default now(),
    unique (awb, email)
);

create table if not exists public.notifications_read (
    employee_id uuid not null,
    booking_id  uuid not null references public.bookings(id) on delete cascade,
    read_at     timestamptz not null default now(),
    primary key (employee_id, booking_id)
);

alter table public.statuses            enable row level security;
alter table public.bookings            enable row level security;
alter table public.tracking_events     enable row level security;
alter table public.transfers           enable row level security;
alter table public.consolidations      enable row level security;
alter table public.consolidation_items enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.notifications_read  enable row level security;

-- ---------------------------------------------------------------
-- 5. set_status — the ONLY way a status changes.
--    All AWBs succeed or none do. Forward-only unless p_allow_back
--    (the API passes true only for branch_manager and above).
-- ---------------------------------------------------------------
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

        -- carrier sync never moves backwards, even for managers
        if p_source = 'carrier_api' and not st.is_exception
           and (st.stage, st.sort) <= (b.current_stage, b.current_sort) then
            continue;
        end if;
        -- forward-only check, compared against the last normal step (exceptions don't move it)
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

        n := n + 1;
    end loop;
    return n;
end;
$$;

revoke all on function public.set_status(text[], text, uuid, text, text, text, text, timestamptz, boolean, text) from public, anon, authenticated;
