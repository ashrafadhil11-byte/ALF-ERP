-- 026 — Pickup requests: collect cargo from the customer's door.
--   requested → assigned (driver) → picked_up → booked (linked to the booking made from it)
--   or cancelled / failed (with a reason). Source 'staff' now; 'portal' later (customer site).

create table if not exists public.pickup_requests (
    id             bigserial primary key,
    pickup_no      text not null unique,
    branch_code    text not null references public.branches (branch_code),
    customer_id    bigint references public.customers (id),
    customer_name  text not null,
    phone          text not null,
    address        text not null,
    city           text,
    lat            numeric(9,6),
    lng            numeric(9,6),
    pickup_date    date not null,
    slot           text not null default 'any' check (slot in ('morning', 'afternoon', 'evening', 'any')),
    pieces         integer,
    weight_kg      numeric(10,2),
    dest_country   text,
    notes          text,
    status         text not null default 'requested' check (status in ('requested', 'assigned', 'picked_up', 'booked', 'cancelled', 'failed')),
    driver_id      uuid references public.employees (id) on delete set null,
    driver_name    text,
    assigned_at    timestamptz,
    picked_up_at   timestamptz,
    picked_pieces  integer,
    booking_awb    text,
    reason         text,
    source         text not null default 'staff' check (source in ('staff', 'portal')),
    created_at     timestamptz not null default now(),
    created_by_name text,
    updated_at     timestamptz not null default now()
);
create index if not exists pickup_requests_day_idx on public.pickup_requests (branch_code, pickup_date, status);
create index if not exists pickup_requests_driver_idx on public.pickup_requests (driver_id, status);
create index if not exists pickup_requests_customer_idx on public.pickup_requests (customer_id);
alter table public.pickup_requests enable row level security;

-- number + customer link on insert (same matching as bookings: phone)
create or replace function public.pickup_before_insert() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    if new.pickup_no is null then new.pickup_no := public.next_doc_no(new.branch_code, 'PKP'); end if;
    if new.customer_id is null then new.customer_id := public.customer_upsert(new.customer_name, new.phone, null, new.branch_code, now()); end if;
    return new;
end $$;
drop trigger if exists pickup_before_insert on public.pickup_requests;
create trigger pickup_before_insert before insert on public.pickup_requests for each row execute function public.pickup_before_insert();
