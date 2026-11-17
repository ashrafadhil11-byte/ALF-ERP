-- 017 — Phase D: customer database.
--  • One customer per sender, matched by phone (digits only) OR civil ID / passport.
--  • Built automatically from every booking (manual and imported); receivers saved as the customer's contacts.
--  • Invoices are linked to the customer too (walk-in sales by phone).
--  • Duplicates can be merged; the merged record keeps pointing to the one kept.

create or replace function public.phone_key(p text) returns text
language sql immutable set search_path = public as $$
    select nullif(regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', ''), '')
$$;
create or replace function public.civil_key(p text) returns text
language sql immutable set search_path = public as $$
    select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create table if not exists public.customers (
    id              bigserial primary key,
    customer_no     text unique,
    name            text not null,
    phone           text,
    phone_key       text,
    civil_id        text,
    civil_key       text,
    email           text,
    whatsapp        text,
    address         text,
    city            text,
    country         text,
    branch_code     text,                 -- branch of the first booking
    notes           text,
    tags            text[] not null default '{}',
    blocked         boolean not null default false,
    merged_into     bigint references public.customers(id),
    first_booking_at timestamptz,
    last_booking_at timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create unique index if not exists customers_phone_key on public.customers (phone_key) where merged_into is null and phone_key is not null;
create unique index if not exists customers_civil_key on public.customers (civil_key) where merged_into is null and civil_key is not null;
create index if not exists customers_name_idx on public.customers (lower(name));
alter table public.customers enable row level security;

create table if not exists public.customer_contacts (
    id           bigserial primary key,
    customer_id  bigint not null references public.customers(id) on delete cascade,
    name         text not null,
    phone        text,
    phone_key    text,
    whatsapp     text,
    address      text,
    parts        jsonb not null default '{}',   -- house, street, landmark, pin, po, state, city (to refill the booking form)
    city         text,
    country      text,
    country_code text,
    times_used   integer not null default 1,
    last_used_at timestamptz not null default now()
);
create unique index if not exists customer_contacts_key on public.customer_contacts (customer_id, coalesce(phone_key, lower(name)));
alter table public.customer_contacts enable row level security;

alter table public.bookings add column if not exists customer_id    bigint references public.customers(id);
alter table public.bookings add column if not exists receiver_parts jsonb;
alter table public.invoices add column if not exists customer_id    bigint references public.customers(id);
create index if not exists bookings_customer_idx on public.bookings (customer_id);
create index if not exists invoices_customer_idx on public.invoices (customer_id);

-- Find or create the customer for a phone / civil ID. Fills empty details; never overwrites a name already set.
create or replace function public.customer_upsert(p_name text, p_phone text, p_civil text, p_branch text, p_at timestamptz default now())
returns bigint
language plpgsql set search_path = public as $$
declare v_pk text := public.phone_key(p_phone); v_ck text := public.civil_key(p_civil); c public.customers%rowtype;
begin
    if v_pk is null and v_ck is null then return null; end if;
    select * into c from public.customers
     where merged_into is null and ((v_pk is not null and phone_key = v_pk) or (v_ck is not null and civil_key = v_ck))
     order by (v_pk is not null and phone_key = v_pk) desc, id limit 1 for update;
    if found then
        update public.customers set
            name        = coalesce(nullif(trim(name), ''), nullif(trim(p_name), ''), name),
            phone       = coalesce(phone, nullif(trim(p_phone), '')),
            phone_key   = coalesce(phone_key, case when not exists (select 1 from public.customers x where x.phone_key = v_pk and x.merged_into is null and x.id <> c.id) then v_pk end),
            civil_id    = coalesce(civil_id, nullif(trim(p_civil), '')),
            civil_key   = coalesce(civil_key, case when not exists (select 1 from public.customers x where x.civil_key = v_ck and x.merged_into is null and x.id <> c.id) then v_ck end),
            last_booking_at = greatest(coalesce(last_booking_at, p_at), p_at),
            first_booking_at = least(coalesce(first_booking_at, p_at), p_at),
            updated_at  = now()
        where id = c.id;
        return c.id;
    end if;
    insert into public.customers (name, phone, phone_key, civil_id, civil_key, branch_code, first_booking_at, last_booking_at)
    values (coalesce(nullif(trim(p_name), ''), 'Customer'), nullif(trim(p_phone), ''), v_pk, nullif(trim(p_civil), ''), v_ck, p_branch, p_at, p_at)
    returning id into c.id;
    update public.customers set customer_no = 'C' || lpad(c.id::text, 6, '0') where id = c.id;
    return c.id;
end;
$$;

create or replace function public.contact_upsert(p_customer bigint, p_name text, p_phone text, p_whatsapp text, p_address text,
                                                 p_city text, p_country text, p_country_code text, p_parts jsonb)
returns void
language plpgsql set search_path = public as $$
declare v_pk text := public.phone_key(p_phone);
begin
    if p_customer is null or coalesce(trim(p_name), '') = '' then return; end if;
    insert into public.customer_contacts (customer_id, name, phone, phone_key, whatsapp, address, parts, city, country, country_code)
    values (p_customer, trim(p_name), nullif(trim(p_phone), ''), v_pk, nullif(trim(p_whatsapp), ''), nullif(trim(p_address), ''),
            coalesce(p_parts, '{}'), nullif(trim(p_city), ''), nullif(trim(p_country), ''), nullif(upper(trim(p_country_code)), ''))
    on conflict (customer_id, coalesce(phone_key, lower(name))) do update set
        name = excluded.name, whatsapp = coalesce(excluded.whatsapp, customer_contacts.whatsapp),
        address = coalesce(excluded.address, customer_contacts.address),
        parts = case when excluded.parts = '{}'::jsonb then customer_contacts.parts else excluded.parts end,
        city = coalesce(excluded.city, customer_contacts.city), country = coalesce(excluded.country, customer_contacts.country),
        country_code = coalesce(excluded.country_code, customer_contacts.country_code),
        times_used = customer_contacts.times_used + 1, last_used_at = now();
end;
$$;

-- Every booking is linked to its sender's customer record; the receiver becomes a contact.
create or replace function public.bookings_link_customer() returns trigger
language plpgsql set search_path = public as $$
begin
    if tg_op = 'INSERT' or new.customer_id is null
       or new.shipper_phone is distinct from old.shipper_phone or new.shipper_id_no is distinct from old.shipper_id_no then
        new.customer_id := coalesce(public.customer_upsert(new.shipper, new.shipper_phone, new.shipper_id_no, new.branch_code, coalesce(new.booked_at, now())),
                                    case when tg_op = 'UPDATE' then old.customer_id end);
    end if;
    if new.customer_id is not null and (tg_op = 'INSERT' or new.consignee is distinct from old.consignee
       or new.consignee_phone is distinct from old.consignee_phone or new.receiver_parts is distinct from old.receiver_parts) then
        perform public.contact_upsert(new.customer_id, new.consignee, new.consignee_phone, new.receiver_whatsapp, new.consignee_address,
                                      new.dest_city, new.dest_country, new.dest_country_code, new.receiver_parts);
    end if;
    return new;
end;
$$;
drop trigger if exists bookings_link_customer on public.bookings;
create trigger bookings_link_customer before insert or update of shipper, shipper_phone, shipper_id_no, consignee, consignee_phone, receiver_parts, customer_id
    on public.bookings for each row execute function public.bookings_link_customer();

-- Invoices: from the booking, else by the phone on the invoice (walk-in material sales)
create or replace function public.invoices_link_customer() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.customer_id is null then
        new.customer_id := coalesce((select customer_id from public.bookings where id = new.booking_id),
                                    public.customer_upsert(new.customer_name, new.customer_phone, null, new.branch_code, now()));
    end if;
    return new;
end;
$$;
drop trigger if exists invoices_link_customer on public.invoices;
create trigger invoices_link_customer before insert on public.invoices for each row execute function public.invoices_link_customer();

-- Merge: everything of p_drop moves to p_keep
create or replace function public.customer_merge(p_keep bigint, p_drop bigint, p_user_name text)
returns void
language plpgsql set search_path = public as $$
declare k public.customers%rowtype; d public.customers%rowtype;
begin
    if p_keep = p_drop then raise exception 'Choose two different customers.'; end if;
    select * into k from public.customers where id = p_keep and merged_into is null for update;
    if not found then raise exception 'Customer to keep not found.'; end if;
    select * into d from public.customers where id = p_drop and merged_into is null for update;
    if not found then raise exception 'Customer to merge not found (or already merged).'; end if;
    update public.customers set merged_into = k.id, phone_key = null, civil_key = null, updated_at = now(),
           notes = concat_ws(E'\n', notes, 'Merged into ' || k.customer_no || ' by ' || coalesce(p_user_name, '') || ' on ' || current_date)
     where id = d.id;
    update public.customers set
        phone = coalesce(k.phone, d.phone), phone_key = coalesce(k.phone_key, public.phone_key(d.phone)),
        civil_id = coalesce(k.civil_id, d.civil_id), civil_key = coalesce(k.civil_key, public.civil_key(d.civil_id)),
        email = coalesce(k.email, d.email), whatsapp = coalesce(k.whatsapp, d.whatsapp), address = coalesce(k.address, d.address),
        city = coalesce(k.city, d.city), country = coalesce(k.country, d.country),
        notes = nullif(concat_ws(E'\n', k.notes, nullif(d.notes, '')), ''),
        tags = coalesce((select array_agg(distinct t) from unnest(k.tags || d.tags) t), '{}'),
        first_booking_at = least(k.first_booking_at, d.first_booking_at), last_booking_at = greatest(k.last_booking_at, d.last_booking_at),
        updated_at = now()
     where id = k.id;
    update public.bookings set customer_id = k.id where customer_id = d.id;
    update public.invoices set customer_id = k.id where customer_id = d.id;
    update public.customer_contacts c set customer_id = k.id
     where c.customer_id = d.id
       and not exists (select 1 from public.customer_contacts x where x.customer_id = k.id and coalesce(x.phone_key, lower(x.name)) = coalesce(c.phone_key, lower(c.name)));
    delete from public.customer_contacts where customer_id = d.id;
end;
$$;

-- Totals for the customer list / profile
create or replace view public.customer_stats with (security_invoker = true) as
select c.id as customer_id,
       count(b.id) as shipments,
       coalesce(sum(coalesce(b.chargeable_weight, b.weight)), 0) as kg,
       max(b.booked_at) as last_shipment_at
from public.customers c left join public.bookings b on b.customer_id = c.id and not b.archived
group by c.id;

-- backfill: link existing bookings and invoices
update public.bookings set customer_id = null where customer_id is null;
select public.contact_upsert(customer_id, consignee, consignee_phone, receiver_whatsapp, consignee_address, dest_city, dest_country, dest_country_code, receiver_parts)
  from public.bookings where customer_id is not null order by booked_at;
update public.invoices i set customer_id = coalesce((select customer_id from public.bookings b where b.id = i.booking_id),
                                                    public.customer_upsert(i.customer_name, i.customer_phone, null, i.branch_code, i.issued_at))
 where customer_id is null;

revoke all on function public.customer_upsert(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.contact_upsert(bigint, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.customer_merge(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.bookings_link_customer() from public, anon, authenticated;
revoke all on function public.invoices_link_customer() from public, anon, authenticated;
revoke all on public.customer_stats from anon, authenticated;
