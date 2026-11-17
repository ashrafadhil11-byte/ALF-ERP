-- 018 — Activity log, warehouse operator access (PIN), employee attendance + leave.

-- ---------------------------------------------------------------
-- 1. Activity log: every change made through the API (written by api/router.js)
-- ---------------------------------------------------------------
create table if not exists public.audit_log (
    id         bigserial primary key,
    at         timestamptz not null default now(),
    user_id    uuid,
    user_name  text,
    user_email text,
    role       text,
    branch     text,
    method     text not null,
    route      text not null,
    action     text,
    target     text,                 -- AWB, invoice no., id … when the request names one
    status     integer,
    ok         boolean,
    error      text,
    details    jsonb,                -- the request with passwords / PINs / keys / images removed
    ip         text,
    user_agent text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id, at desc);
create index if not exists audit_log_route_idx on public.audit_log (route, at desc);
create index if not exists audit_log_target_idx on public.audit_log (target);
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------
-- 2. Warehouse operators (any user, own PIN)
-- ---------------------------------------------------------------
alter table public.employees
    add column if not exists is_warehouse        boolean not null default false,
    add column if not exists warehouse_code      text,
    add column if not exists wh_pin_hash         text,
    add column if not exists wh_pin_failed       integer not null default 0,
    add column if not exists wh_pin_locked_until timestamptz;

-- ---------------------------------------------------------------
-- 3. Attendance
-- ---------------------------------------------------------------
alter table public.branches
    add column if not exists lat        numeric,
    add column if not exists lng        numeric,
    add column if not exists geofence_m integer not null default 200,
    add column if not exists timezone   text not null default 'Asia/Muscat';

alter table public.employees
    add column if not exists shift_start time not null default '09:00',
    add column if not exists shift_end   time not null default '18:00',
    add column if not exists grace_min   integer not null default 10,
    add column if not exists weekly_off  integer[] not null default '{5}';   -- ISO weekday: 1 Mon … 7 Sun (5 = Friday)

create table if not exists public.attendance (
    id              bigserial primary key,
    employee_id     uuid not null,
    work_date       date not null,
    branch_code     text,
    check_in        timestamptz,
    check_out       timestamptz,
    in_lat          numeric,
    in_lng          numeric,
    in_distance_m   integer,
    out_lat         numeric,
    out_lng         numeric,
    out_distance_m  integer,
    late_min        integer not null default 0,
    early_min       integer not null default 0,
    overtime_min    integer not null default 0,
    worked_min      integer not null default 0,
    note            text,
    edited_by       text,
    edit_reason     text,
    updated_at      timestamptz not null default now(),
    unique (employee_id, work_date)
);
create index if not exists attendance_date_idx on public.attendance (work_date, branch_code);
alter table public.attendance enable row level security;

create table if not exists public.leave_requests (
    id            bigserial primary key,
    employee_id   uuid not null,
    branch_code   text,
    leave_type    text not null check (leave_type in ('annual', 'sick', 'unpaid', 'emergency', 'other')),
    from_date     date not null,
    to_date       date not null,
    days          integer not null,
    reason        text,
    status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at  timestamptz not null default now(),
    decided_by    text,
    decided_at    timestamptz,
    decision_note text,
    check (to_date >= from_date)
);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, from_date);
create index if not exists leave_requests_status_idx on public.leave_requests (status, branch_code);
alter table public.leave_requests enable row level security;

-- Late / early / overtime / worked minutes for one record, in the branch's local time
create or replace function public.attendance_recalc(p_id bigint) returns void
language plpgsql set search_path = public as $$
declare a public.attendance%rowtype; e public.employees%rowtype; tz text; s_start timestamptz; s_end timestamptz;
begin
    select * into a from public.attendance where id = p_id;
    if not found then return; end if;
    select * into e from public.employees where id = a.employee_id;
    select coalesce(timezone, 'Asia/Muscat') into tz from public.branches where branch_code = a.branch_code;
    tz := coalesce(tz, 'Asia/Muscat');
    s_start := (a.work_date + coalesce(e.shift_start, '09:00')) at time zone tz;
    s_end   := (a.work_date + coalesce(e.shift_end, '18:00') + case when coalesce(e.shift_end, '18:00') <= coalesce(e.shift_start, '09:00') then interval '1 day' else interval '0' end) at time zone tz;
    update public.attendance set
        late_min     = case when a.check_in is not null and a.check_in > s_start + make_interval(mins => coalesce(e.grace_min, 0))
                            then floor(extract(epoch from a.check_in - s_start) / 60) else 0 end,
        early_min    = case when a.check_out is not null and a.check_out < s_end then floor(extract(epoch from s_end - a.check_out) / 60) else 0 end,
        overtime_min = case when a.check_out is not null and a.check_out > s_end then floor(extract(epoch from a.check_out - s_end) / 60) else 0 end,
        worked_min   = case when a.check_in is not null and a.check_out is not null then greatest(floor(extract(epoch from a.check_out - a.check_in) / 60), 0) else 0 end,
        updated_at   = now()
    where id = p_id;
end;
$$;

-- Check in / out. Distance is worked out by the API (GPS vs branch location).
create or replace function public.attendance_punch(p_emp uuid, p_kind text, p_branch text, p_lat numeric, p_lng numeric, p_distance integer)
returns jsonb
language plpgsql set search_path = public as $$
declare tz text; v_day date; a public.attendance%rowtype;
begin
    select coalesce(timezone, 'Asia/Muscat') into tz from public.branches where branch_code = p_branch;
    v_day := (now() at time zone coalesce(tz, 'Asia/Muscat'))::date;
    select * into a from public.attendance where employee_id = p_emp and work_date = v_day for update;
    if p_kind = 'in' then
        if found and a.check_in is not null then raise exception 'You already checked in today at %.', to_char(a.check_in at time zone coalesce(tz, 'Asia/Muscat'), 'HH24:MI'); end if;
        insert into public.attendance (employee_id, work_date, branch_code, check_in, in_lat, in_lng, in_distance_m)
        values (p_emp, v_day, p_branch, now(), p_lat, p_lng, p_distance)
        on conflict (employee_id, work_date) do update set check_in = now(), in_lat = p_lat, in_lng = p_lng, in_distance_m = p_distance, branch_code = p_branch
        returning * into a;
    elsif p_kind = 'out' then
        if not found or a.check_in is null then raise exception 'Check in first.'; end if;
        update public.attendance set check_out = now(), out_lat = p_lat, out_lng = p_lng, out_distance_m = p_distance where id = a.id returning * into a;
    else
        raise exception 'Unknown punch.';
    end if;
    perform public.attendance_recalc(a.id);
    select * into a from public.attendance where id = a.id;
    return to_jsonb(a);
end;
$$;

-- Manager correction (reason required, kept on the record)
create or replace function public.attendance_set(p_emp uuid, p_day date, p_branch text, p_in timestamptz, p_out timestamptz, p_reason text, p_user_name text)
returns jsonb
language plpgsql set search_path = public as $$
declare a public.attendance%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the correction.'; end if;
    if p_in is not null and p_out is not null and p_out <= p_in then raise exception 'Check-out must be after check-in.'; end if;
    insert into public.attendance (employee_id, work_date, branch_code, check_in, check_out, edited_by, edit_reason)
    values (p_emp, p_day, p_branch, p_in, p_out, p_user_name, trim(p_reason))
    on conflict (employee_id, work_date) do update set check_in = p_in, check_out = p_out, edited_by = p_user_name, edit_reason = trim(p_reason)
    returning * into a;
    perform public.attendance_recalc(a.id);
    select * into a from public.attendance where id = a.id;
    return to_jsonb(a);
end;
$$;

-- Day-by-day status for every active employee: present / late / absent / leave / off / upcoming
create or replace function public.attendance_report(p_branch text, p_from date, p_to date)
returns table (employee_id uuid, full_name text, branch text, work_date date, status text, check_in timestamptz, check_out timestamptz,
               late_min integer, early_min integer, overtime_min integer, worked_min integer, leave_type text, edited boolean)
language sql stable set search_path = public as $$
    with emp as (
        select e.* from public.employees e
        where coalesce(e.active, true) and (p_branch is null or e.branch = p_branch)
    ), days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d)
    select e.id, e.full_name, e.branch, d.day,
           case when a.check_in is not null and a.late_min > 0 then 'late'
                when a.check_in is not null then 'present'
                when l.id is not null then 'leave'
                when extract(isodow from d.day)::int = any(e.weekly_off) then 'off'
                when d.day > current_date then 'upcoming'
                else 'absent' end,
           a.check_in, a.check_out, coalesce(a.late_min, 0), coalesce(a.early_min, 0), coalesce(a.overtime_min, 0), coalesce(a.worked_min, 0),
           l.leave_type, a.edited_by is not null
    from emp e cross join days d
    left join public.attendance a on a.employee_id = e.id and a.work_date = d.day
    left join lateral (select lr.id, lr.leave_type from public.leave_requests lr
                       where lr.employee_id = e.id and lr.status = 'approved' and d.day between lr.from_date and lr.to_date limit 1) l on true
    order by e.full_name, d.day;
$$;

revoke all on function public.attendance_recalc(bigint) from public, anon, authenticated;
revoke all on function public.attendance_punch(uuid, text, text, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.attendance_set(uuid, date, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.attendance_report(text, date, date) from public, anon, authenticated;
