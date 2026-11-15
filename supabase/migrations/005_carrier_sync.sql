-- ALF-ERP — carrier tracking sync (SMSA / Aramex / DHL / 17Track)
-- Safe to re-run.

alter table public.bookings add column if not exists carrier               text;        -- connector id last used
alter table public.bookings add column if not exists carrier_synced_at     timestamptz;
alter table public.bookings add column if not exists carrier_last_event_at timestamptz; -- newest carrier event already applied
alter table public.bookings add column if not exists carrier_error         text;

create index if not exists bookings_carrier_sync_idx on public.bookings (carrier_synced_at nulls first)
    where not archived and fwd_docket is not null;

-- Applies carrier events to one booking in one transaction.
-- p_events: [{ at, description, location, remark, code }]
--  • only events newer than carrier_last_event_at are added (re-syncs never duplicate)
--  • every new event goes on the timeline (source = carrier_api)
--  • the shipment status moves only FORWARD, or into an exception; never backwards
create or replace function public.apply_carrier_events(p_booking_id uuid, p_carrier text, p_events jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    b      bookings%rowtype;
    st     statuses%rowtype;
    ev     jsonb;
    v_at   timestamptz;
    v_last timestamptz;
    added  int := 0;
    moved  int := 0;
begin
    select * into b from bookings where id = p_booking_id for update;
    if not found then raise exception 'Booking % not found', p_booking_id; end if;
    v_last := b.carrier_last_event_at;

    for ev in
        select e from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
         where nullif(e->>'at', '') is not null
         order by (e->>'at')::timestamptz
    loop
        v_at := (ev->>'at')::timestamptz;
        continue when b.carrier_last_event_at is not null and v_at <= b.carrier_last_event_at;

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
$$;

revoke all on function public.apply_carrier_events(uuid, text, jsonb) from public, anon, authenticated;
