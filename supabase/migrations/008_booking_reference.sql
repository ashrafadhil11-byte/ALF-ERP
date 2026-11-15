-- ALF-ERP Phase A — booking reference  D B C NNNNNN
--   D = destination: numeric code for frequent countries (destination_codes), otherwise ISO alpha-2
--   B = branches.booking_code (the branch "AWB digit")
--   C = cargo_types.code
--   NNNNNN = 6 digits from 000001, per branch + per destination, never resets.
--            All alpha-2 countries share ONE series per branch ('ALPHA').
-- Safe to re-run. Existing bookings / imports are untouched.

create table if not exists public.destination_codes (
    country_code text primary key check (country_code ~ '^[A-Z]{2}$'),   -- ISO alpha-2
    country_name text not null,
    code         text not null unique check (code ~ '^[0-9]{1,2}$'),     -- numeric code used in the reference
    active       boolean not null default true,
    created_at   timestamptz not null default now()
);

create table if not exists public.cargo_types (
    code        text primary key check (code ~ '^[0-9A-Z]{1,2}$'),
    name        text not null,
    description text,
    sort        integer not null default 0,
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

create table if not exists public.booking_counters (
    branch_code text not null,
    series      text not null,           -- numeric destination code, or 'ALPHA'
    last_no     integer not null default 0,
    updated_at  timestamptz not null default now(),
    primary key (branch_code, series)
);

alter table public.destination_codes enable row level security;
alter table public.cargo_types       enable row level security;
alter table public.booking_counters  enable row level security;

-- Seed (editable from Branch Network → Destination codes / Cargo types)
insert into public.destination_codes (country_code, country_name, code) values
 ('AE', 'United Arab Emirates', '2'),
 ('IN', 'India',                '3'),
 ('SA', 'Saudi Arabia',         '4'),
 ('PK', 'Pakistan',             '5'),
 ('BD', 'Bangladesh',           '6'),
 ('LK', 'Sri Lanka',            '7'),
 ('PH', 'Philippines',          '8'),
 ('EG', 'Egypt',                '9')
on conflict do nothing;

insert into public.cargo_types (code, name, sort) values
 ('1', 'Air', 10), ('2', 'Sea', 20), ('3', 'Road', 30)
on conflict do nothing;

-- Shipment columns used by the full booking form (all optional; old rows unaffected)
alter table public.bookings add column if not exists dest_country_code text;
alter table public.bookings add column if not exists cargo_type_code   text;
alter table public.bookings add column if not exists receiver_whatsapp text;
alter table public.bookings add column if not exists shipper_id_no     text;   -- civil ID / passport
alter table public.bookings add column if not exists contents          text;
alter table public.bookings add column if not exists boxes             jsonb;  -- [{weight,l,w,h,vol}]
alter table public.bookings add column if not exists chargeable_weight numeric;
alter table public.bookings add column if not exists payment_method    text;
alter table public.bookings add column if not exists notes             text;

-- Builds the next reference atomically (counter row is locked by the upsert).
create or replace function public.next_booking_ref(p_branch_code text, p_country_code text, p_cargo_code text)
returns text
language plpgsql
set search_path = public
as $$
declare
    v_branch_digit text;
    v_country      text := upper(trim(p_country_code));
    v_dest         text;
    v_series       text;
    v_no           integer;
    v_ref          text;
begin
    select booking_code into v_branch_digit from branches where branch_code = p_branch_code;
    if coalesce(trim(v_branch_digit), '') = '' then
        raise exception 'Branch % has no booking code (AWB digit). Set it in Branch Network.', p_branch_code;
    end if;
    if v_country !~ '^[A-Z]{2}$' then
        raise exception 'Destination country code must be 2 letters (got %)', p_country_code;
    end if;
    if not exists (select 1 from cargo_types where code = p_cargo_code and active) then
        raise exception 'Unknown or inactive cargo type %', p_cargo_code;
    end if;

    select code into v_dest from destination_codes where country_code = v_country and active;
    if v_dest is null then
        v_dest := v_country;      -- alpha-2 code in the reference
        v_series := 'ALPHA';      -- all alpha countries share one series per branch
    else
        v_series := v_dest;
    end if;

    loop
        insert into booking_counters (branch_code, series, last_no) values (p_branch_code, v_series, 1)
        on conflict (branch_code, series) do update set last_no = booking_counters.last_no + 1, updated_at = now()
        returning last_no into v_no;
        if v_no > 999999 then
            raise exception 'Reference series % for branch % is full', v_series, p_branch_code;
        end if;
        v_ref := v_dest || trim(v_branch_digit) || p_cargo_code || lpad(v_no::text, 6, '0');
        exit when not exists (select 1 from bookings where awb = v_ref);   -- skip numbers already used manually
    end loop;
    return v_ref;
end;
$$;

revoke all on function public.next_booking_ref(text, text, text) from public, anon, authenticated;
