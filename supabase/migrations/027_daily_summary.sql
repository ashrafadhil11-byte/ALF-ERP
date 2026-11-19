-- 027 — Daily manager summary.
--   daily_summary(day, branch) builds one branch's day in one call (Oman day, +04:00):
--   bookings & kg, invoiced, received (by method), expenses, cash closing done, deliveries, pickups, exceptions,
--   still waiting (incoming cargo / cash, payment requests), unpaid invoices.
--   Every evening the server saves each branch's summary (and a company one, branch_code null) in daily_summaries;
--   the bell then tells managers it is ready.

create table if not exists public.daily_summaries (
    id          bigserial primary key,
    day         date not null,
    branch_code text,                                   -- null = whole company
    data        jsonb not null,
    created_at  timestamptz not null default now()
);
create unique index if not exists daily_summaries_day_branch on public.daily_summaries (day, coalesce(branch_code, '*'));
alter table public.daily_summaries enable row level security;

create or replace function public.daily_summary(p_day date, p_branch text)
returns jsonb language sql stable set search_path to 'public' as $$
    with b as (select p_day::timestamp at time zone 'Asia/Muscat' as t0, (p_day + 1)::timestamp at time zone 'Asia/Muscat' as t1),
    bk as (select count(*) n, coalesce(sum(coalesce(k.chargeable_weight, k.weight, 0)), 0) kg
           from public.bookings k, b where k.booked_at >= b.t0 and k.booked_at < b.t1 and coalesce(k.booked_branch, k.branch_code) = p_branch),
    inv as (select coalesce(jsonb_object_agg(currency, amt), '{}') j from (
           select i.currency, sum(i.total) amt from public.invoices i, b where i.issued_at >= b.t0 and i.issued_at < b.t1 and i.branch_code = p_branch and i.status <> 'void' group by i.currency) x),
    rec as (select coalesce(jsonb_object_agg(currency || ' ' || method, amt), '{}') j, coalesce(sum(amt), 0) total from (
           select p.currency, p.method, sum(p.amount) amt from public.payments p, b where p.received_at >= b.t0 and p.received_at < b.t1 and p.branch_code = p_branch and not p.void group by p.currency, p.method) x),
    exp as (select coalesce(jsonb_object_agg(currency, amt), '{}') j from (
           select e.currency, sum(e.amount) amt from public.expenses e where e.expense_date = p_day and e.branch_code = p_branch and not e.void group by e.currency) x),
    unpaid as (select coalesce(jsonb_object_agg(currency, amt), '{}') j, coalesce(sum(n), 0) n from (
           select i.currency, sum(i.total - i.paid) amt, count(*) n from public.invoices i where i.branch_code = p_branch and i.status in ('unpaid', 'partial') group by i.currency) x),
    dl as (select count(*) filter (where d.status = 'delivered') ok, count(*) filter (where d.status = 'failed') failed
           from public.deliveries d, b where d.completed_at >= b.t0 and d.completed_at < b.t1 and d.branch_code = p_branch),
    pk as (select count(*) n, count(*) filter (where p.status in ('picked_up', 'booked')) done, count(*) filter (where p.status in ('requested', 'assigned')) open
           from public.pickup_requests p where p.pickup_date = p_day and p.branch_code = p_branch),
    ex as (select count(*) n from public.tracking_events t join public.statuses s on s.code = t.status_code join public.bookings k on k.id = t.booking_id, b
           where s.is_exception and t.status_code <> 'CANCELLED' and t.event_at >= b.t0 and t.event_at < b.t1 and k.branch_code = p_branch),
    wait as (select
           (select count(*) from public.transfer_manifests m where m.to_branch = p_branch and m.status in ('in_transit', 'partial')) cargo_in,
           (select count(*) from public.cash_transfers c where c.to_branch = p_branch and c.status = 'sent') cash_in,
           (select count(*) from public.payment_requests r where r.branch_code = p_branch and r.status = 'requested') requests,
           (select count(*) from public.stock_requests r where r.branch_code = p_branch and r.status = 'dispatched') materials_in)
    select jsonb_build_object(
        'day', p_day, 'branch', p_branch,
        'bookings', bk.n, 'kg', round(bk.kg, 1),
        'invoiced', inv.j, 'received', rec.j, 'expenses', exp.j,
        'cash_closed', exists (select 1 from public.cash_closings c where c.branch_code = p_branch and c.close_date = p_day),
        'delivered', dl.ok, 'delivery_failed', dl.failed,
        'pickups', pk.n, 'pickups_done', pk.done, 'pickups_open', pk.open,
        'exceptions', ex.n,
        'waiting', jsonb_build_object('cargo_in', wait.cargo_in, 'cash_in', wait.cash_in, 'payment_requests', wait.requests, 'materials_in', wait.materials_in),
        'unpaid', unpaid.j, 'unpaid_count', unpaid.n)
    from bk, inv, rec, exp, unpaid, dl, pk, ex, wait;
$$;

revoke all on function public.daily_summary(date, text) from public, anon, authenticated;
