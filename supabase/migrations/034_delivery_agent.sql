-- 034 — "Assigned Delivery Agent": the last-mile partner at destination (e.g. Delhivery in India) and its docket / LR.
--   * bookings.delivery_agent / delivery_docket — kept apart from the forwarding agent (fwd_agent / fwd_docket).
--   * status ASSIGNED_DELIVERY_AGENT (Last mile, before Out for Delivery), needs the agent + docket ('delivery_docket').
--   * carrier sync follows the delivery docket once it is set; apply_carrier_events: when the carrier changes, the
--     new carrier's events are not skipped because of the old carrier's last time (duplicates are still skipped).

alter table public.bookings add column if not exists delivery_agent text;
alter table public.bookings add column if not exists delivery_docket text;

insert into public.statuses (code, label, customer_label, stage, sort, is_exception, notify_customer, requires, is_system, active)
select 'ASSIGNED_DELIVERY_AGENT', 'Assigned Delivery Agent', 'With Delivery Partner', 7, 705, false, s.notify_customer, array['delivery_docket'], false, true
from public.statuses s where s.code = 'ARRIVED_DEST_HUB'
on conflict (code) do update set label = excluded.label, customer_label = excluded.customer_label, stage = excluded.stage, sort = excluded.sort,
    requires = excluded.requires, active = true;

create or replace function public.apply_carrier_events(p_booking_id uuid, p_carrier text, p_events jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    b      bookings%rowtype;
    st     statuses%rowtype;
    ev     jsonb;
    v_at   timestamptz;
    v_base timestamptz;
    v_last timestamptz;
    added  int := 0;
    moved  int := 0;
begin
    select * into b from bookings where id = p_booking_id for update;
    if not found then raise exception 'Booking % not found', p_booking_id; end if;
    -- a new carrier (forwarding agent → delivery agent) starts fresh; its own repeats are caught below
    v_base := case when b.carrier is distinct from p_carrier then null else b.carrier_last_event_at end;
    v_last := v_base;

    for ev in
        select e from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
         where nullif(e->>'at', '') is not null
         order by (e->>'at')::timestamptz
    loop
        v_at := (ev->>'at')::timestamptz;
        continue when v_base is not null and v_at <= v_base;
        continue when exists (select 1 from tracking_events t where t.booking_id = b.id and t.source = 'carrier_api' and t.event_at = v_at
                                and t.remark like '%' || upper(p_carrier) || '%');

        st := null;
        if nullif(ev->>'code', '') is not null then
            select * into st from statuses where code = ev->>'code' and active;
        end if;

        if st.code is not null and (st.is_exception or (st.stage, st.sort) > (b.current_stage, b.current_sort)) then
            insert into tracking_events (booking_id, status_code, status, location, remark, event_at, created_by_name, branch_code, source)
            values (b.id, st.code, st.label, ev->>'location',
                    concat_ws(' • ', nullif(ev->>'description', ''), nullif(ev->>'remark', ''), upper(p_carrier)),
                    v_at, 'Carrier sync', b.branch_code, 'carrier_api');
            update bookings set
                current_status_code = st.code,
                current_status      = st.label,
                current_stage       = case when st.is_exception then current_stage else st.stage end,
                current_sort        = case when st.is_exception then current_sort  else st.sort  end
             where id = b.id
            returning * into b;
            moved := moved + 1;
        else
            insert into tracking_events (booking_id, status_code, status, location, remark, event_at, created_by_name, branch_code, source)
            values (b.id, null, coalesce(nullif(ev->>'description', ''), 'Carrier update'), ev->>'location',
                    concat_ws(' • ', nullif(ev->>'remark', ''), upper(p_carrier)),
                    v_at, 'Carrier sync', b.branch_code, 'carrier_api');
        end if;
        added := added + 1;
        v_last := greatest(coalesce(v_last, v_at), v_at);
    end loop;

    update bookings set
        carrier = p_carrier,
        carrier_synced_at = now(),
        carrier_last_event_at = v_last,
        carrier_error = null,
        updated_at = case when added > 0 then now() else updated_at end
     where id = b.id;

    return jsonb_build_object('added', added, 'moved', moved, 'status', b.current_status);
end;
$function$;
