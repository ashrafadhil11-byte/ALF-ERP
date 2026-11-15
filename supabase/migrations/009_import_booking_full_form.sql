-- ALF-ERP Phase A — import_booking() also stores the full-booking-form fields. Safe to re-run.
-- Behaviour for existing callers (Al-Farha import, CSV, quick add) is unchanged: new keys are optional.
create or replace function public.import_booking(
    p_row        jsonb,
    p_user_id    uuid,
    p_user_name  text,
    p_intake     text default 'drop_off'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_id  uuid;
    v_awb text := upper(trim(p_row->>'awb'));
    v_ref text := nullif(upper(trim(p_row->>'external_ref')), '');
begin
    if coalesce(v_awb, '') = '' then
        raise exception 'Order has no AWB / order number';
    end if;

    select id into v_id from bookings
     where (v_ref is not null and external_ref = v_ref) or awb = v_awb
     limit 1;

    if v_id is not null then
        update bookings set
            shipper           = coalesce(p_row->>'shipper', shipper),
            shipper_phone     = coalesce(p_row->>'shipper_phone', shipper_phone),
            consignee         = coalesce(p_row->>'consignee', consignee),
            consignee_phone   = coalesce(p_row->>'consignee_phone', consignee_phone),
            consignee_address = coalesce(p_row->>'consignee_address', consignee_address),
            dest_city         = coalesce(p_row->>'dest_city', dest_city),
            dest_country      = coalesce(p_row->>'dest_country', dest_country),
            package_type      = coalesce(p_row->>'package_type', package_type),
            weight            = coalesce((p_row->>'weight')::numeric, weight),
            pieces            = coalesce((p_row->>'pieces')::int, pieces),
            declared_value    = coalesce((p_row->>'declared_value')::numeric, declared_value),
            amount            = coalesce((p_row->>'amount')::numeric, amount),
            raw               = coalesce(p_row->'raw', raw),
            fetched_at        = now(),
            updated_at        = now()
         where id = v_id
        returning awb into v_awb;
        return jsonb_build_object('result', 'refreshed', 'id', v_id, 'awb', v_awb);
    end if;

    insert into bookings (awb, external_ref, source, intake_mode, branch_code, shipper, shipper_phone,
                          consignee, consignee_phone, consignee_address, origin_city, origin_country,
                          dest_city, dest_country, package_type, weight, pieces, declared_value, amount,
                          raw, fetched_at, created_by,
                          dest_country_code, cargo_type_code, receiver_whatsapp, shipper_id_no, contents,
                          boxes, chargeable_weight, payment_method, notes)
    values (v_awb, v_ref, coalesce(p_row->>'source', 'manual'),
            case when p_intake = 'pickup' then 'pickup' else 'drop_off' end,
            p_row->>'branch_code', p_row->>'shipper', p_row->>'shipper_phone',
            p_row->>'consignee', p_row->>'consignee_phone', p_row->>'consignee_address',
            p_row->>'origin_city', p_row->>'origin_country', p_row->>'dest_city', p_row->>'dest_country',
            p_row->>'package_type', (p_row->>'weight')::numeric, (p_row->>'pieces')::int,
            (p_row->>'declared_value')::numeric, (p_row->>'amount')::numeric,
            p_row->'raw', coalesce((p_row->>'fetched_at')::timestamptz, now()), p_user_id,
            p_row->>'dest_country_code', p_row->>'cargo_type_code', p_row->>'receiver_whatsapp',
            p_row->>'shipper_id_no', p_row->>'contents',
            case when jsonb_typeof(p_row->'boxes') = 'array' then p_row->'boxes' end,
            (p_row->>'chargeable_weight')::numeric, p_row->>'payment_method', p_row->>'notes')
    returning id into v_id;

    perform set_status(array[v_awb], 'BOOKED', p_user_id, p_user_name, p_row->>'branch_code',
                       null, case when coalesce(p_row->>'source', 'manual') = 'manual' then 'Booked at counter' else 'Imported from ' || (p_row->>'source') end, now(), false, 'system');

    return jsonb_build_object('result', 'imported', 'id', v_id, 'awb', v_awb);
end;
$$;

revoke all on function public.import_booking(jsonb, uuid, text, text) from public, anon, authenticated;
