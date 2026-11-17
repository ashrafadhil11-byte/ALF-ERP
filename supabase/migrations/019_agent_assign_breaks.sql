-- 019 — "Assigned Forwarding Agent" at origin (agent + docket chosen here), break time in work hours.

-- 1. New origin status. Agent + docket are entered here; "Handed to Forwarding Agent" stays and reuses them.
insert into public.statuses (code, label, customer_label, stage, sort, is_exception, notify_customer, requires, is_system, active)
values ('ASSIGNED_TO_AGENT', 'Assigned Forwarding Agent', 'Processing', 3, 350, false, false, '{agent_docket}', true, true)
on conflict (code) do update set label = excluded.label, stage = excluded.stage, sort = excluded.sort, requires = excluded.requires, active = true;

update public.statuses set requires = '{}' where code = 'HANDED_TO_AGENT';

-- 2. Break inside the work hours (e.g. 13:00–14:00, or a split shift 13:00–16:00). Not counted as worked time.
alter table public.employees
    add column if not exists break_start time,
    add column if not exists break_end   time;

alter table public.attendance add column if not exists break_min integer not null default 0;

create or replace function public.attendance_recalc(p_id bigint) returns void
language plpgsql set search_path = public as $$
declare a public.attendance%rowtype; e public.employees%rowtype; tz text; s_start timestamptz; s_end timestamptz;
        b_start timestamptz; b_end timestamptz; v_break integer := 0;
begin
    select * into a from public.attendance where id = p_id;
    if not found then return; end if;
    select * into e from public.employees where id = a.employee_id;
    select coalesce(timezone, 'Asia/Muscat') into tz from public.branches where branch_code = a.branch_code;
    tz := coalesce(tz, 'Asia/Muscat');
    s_start := (a.work_date + coalesce(e.shift_start, '09:00')) at time zone tz;
    s_end   := (a.work_date + coalesce(e.shift_end, '18:00') + case when coalesce(e.shift_end, '18:00') <= coalesce(e.shift_start, '09:00') then interval '1 day' else interval '0' end) at time zone tz;
    if e.break_start is not null and e.break_end is not null and e.break_end <> e.break_start then
        b_start := (a.work_date + e.break_start + case when e.break_start < coalesce(e.shift_start, '09:00') then interval '1 day' else interval '0' end) at time zone tz;
        b_end   := (a.work_date + e.break_end + case when e.break_end < e.break_start or e.break_end < coalesce(e.shift_start, '09:00') then interval '1 day' else interval '0' end) at time zone tz;
        -- only the part of the break that falls between check-in and check-out
        if a.check_in is not null and a.check_out is not null then
            v_break := greatest(floor(extract(epoch from least(a.check_out, b_end) - greatest(a.check_in, b_start)) / 60), 0);
        end if;
    end if;
    update public.attendance set
        late_min     = case when a.check_in is not null and a.check_in > s_start + make_interval(mins => coalesce(e.grace_min, 0))
                            then floor(extract(epoch from a.check_in - s_start) / 60) else 0 end,
        early_min    = case when a.check_out is not null and a.check_out < s_end then floor(extract(epoch from s_end - a.check_out) / 60) else 0 end,
        overtime_min = case when a.check_out is not null and a.check_out > s_end then floor(extract(epoch from a.check_out - s_end) / 60) else 0 end,
        break_min    = v_break,
        worked_min   = case when a.check_in is not null and a.check_out is not null then greatest(floor(extract(epoch from a.check_out - a.check_in) / 60) - v_break, 0) else 0 end,
        updated_at   = now()
    where id = p_id;
end;
$$;
revoke all on function public.attendance_recalc(bigint) from public, anon, authenticated;
