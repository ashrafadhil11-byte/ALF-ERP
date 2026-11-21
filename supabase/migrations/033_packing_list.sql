-- 033 — Packing list per box (optional; mostly personal effects, items mixed in each box).
-- One row per item line in a box. Box numbers are the shipment's box numbers (booking_pieces.piece_no / 1…pieces).
-- Read / written only by the API (service key) — same branch rules as the shipment.

create table if not exists public.packing_items (
    id               bigint generated always as identity primary key,
    booking_id       uuid not null references public.bookings (id) on delete cascade,
    piece_no         integer not null check (piece_no between 1 and 999),
    item             text not null check (length(trim(item)) between 1 and 120),
    qty              numeric not null default 1 check (qty > 0 and qty <= 100000),
    value            numeric check (value is null or value >= 0),     -- optional, for customs
    created_by_name  text,
    created_at       timestamptz not null default now()
);
create index if not exists packing_items_booking on public.packing_items (booking_id, piece_no, id);
alter table public.packing_items enable row level security;   -- no policies: the API only

-- the items this branch (or company) writes most, for the quick-add chips
create or replace function public.packing_top_items(p_branch text, p_limit int default 24)
returns table (item text, uses bigint)
language sql stable security definer set search_path = public as $$
    select initcap(lower(trim(p.item))) as item, count(*) as uses
    from public.packing_items p join public.bookings b on b.id = p.booking_id
    where p_branch is null or b.branch_code = p_branch
    group by 1 order by 2 desc, 1 limit greatest(1, least(p_limit, 60));
$$;
revoke all on function public.packing_top_items(text, int) from public, anon, authenticated;
