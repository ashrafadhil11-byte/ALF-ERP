-- 020 — Start break / End break buttons. The real break (when taken) replaces the scheduled one in worked time;
-- minutes beyond the scheduled break length are recorded as break_over_min.

alter table public.attendance
    add column if not exists break_started_at timestamptz,
    add column if not exists break_ended_at   timestamptz,
    add column if not exists break_over_min   integer not null default 0;

create or replace function public.attendance_recalc(p_id bigint) returns void
language plpgsql set search_path = public as $$
declare a public.attendance%rowtype; e public.employees%rowtype; tz text; s_start timestamptz; s_end timestamptz;
        b_start timestamptz; b_end timestamptz; v_break integer := 0; v_sched integer := 0; v_over integer := 0;
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
        v_sched := floor(extract(epoch from b_end - b_start) / 60);
    end if;
    if a.break_started_at is not null and a.break_ended_at is not null then
        -- break actually taken with the buttons
        v_break := greatest(floor(extract(epoch from a.break_ended_at - a.break_started_at) / 60), 0);
        v_over := case when v_sched > 0 then greatest(v_break - v_sched, 0) else 0 end;
    elsif b_start is not null and a.check_in is not null and a.check_out is not null then
        -- no buttons used: the scheduled break inside the working time
        v_break := greatest(floor(extract(epoch from least(a.check_out, b_end) - greatest(a.check_in, b_start)) / 60), 0);
    end if;
    update public.attendance set
        late_min       = case when a.check_in is not null and a.check_in > s_start + make_interval(mins => coalesce(e.grace_min, 0))
                              then floor(extract(epoch from a.check_in - s_start) / 60) else 0 end,
        early_min      = case when a.check_out is not null and a.check_out < s_end then floor(extract(epoch from s_end - a.check_out) / 60) else 0 end,
        overtime_min   = case when a.check_out is not null and a.check_out > s_end then floor(extract(epoch from a.check_out - s_end) / 60) else 0 end,
        break_min      = v_break,
        break_over_min = v_over,
        worked_min     = case when a.check_in is not null and a.check_out is not null then greatest(floor(extract(epoch from a.check_out - a.check_in) / 60) - v_break, 0) else 0 end,
        updated_at     = now()
    where id = p_id;
end;
$$;

-- in / out as before, plus 'break' (start) and 'resume' (end). Checking out during a break ends the break.
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
        if a.check_out is not null then raise exception 'You already checked out today.'; end if;
        update public.attendance set check_out = now(), out_lat = p_lat, out_lng = p_lng, out_distance_m = p_distance,
               break_ended_at = case when break_started_at is not null and break_ended_at is null then now() else break_ended_at end
        where id = a.id returning * into a;
    elsif p_kind = 'break' then
        if not found or a.check_in is null then raise exception 'Check in first.'; end if;
        if a.check_out is not null then raise exception 'You already checked out today.'; end if;
        if a.break_started_at is not null then raise exception 'You already took your break today.'; end if;
        update public.attendance set break_started_at = now() where id = a.id returning * into a;
    elsif p_kind = 'resume' then
        if not found or a.break_started_at is null then raise exception 'Start your break first.'; end if;
        if a.break_ended_at is not null then raise exception 'Your break already ended.'; end if;
        update public.attendance set break_ended_at = now() where id = a.id returning * into a;
    else
        raise exception 'Unknown punch.';
    end if;
    perform public.attendance_recalc(a.id);
    select * into a from public.attendance where id = a.id;
    return to_jsonb(a);
end;
$$;

revoke all on function public.attendance_recalc(bigint) from public, anon, authenticated;
revoke all on function public.attendance_punch(uuid, text, text, numeric, numeric, integer) from public, anon, authenticated;

-- 3. City for suppliers / agents (picked from a list like everywhere else)
alter table public.suppliers add column if not exists city text;
