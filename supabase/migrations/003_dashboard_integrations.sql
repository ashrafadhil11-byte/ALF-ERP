-- ALF-ERP — dashboard summary + 3rd-party API registry
-- Safe to re-run.

-- ---------------------------------------------------------------
-- 1. Integrations registry (3rd-party APIs: carriers, order sources, notifications)
--    Add / update an API from Admin → Integrations. `secret` is write-only from the UI
--    and only readable by the service role (RLS on, no policies).
-- ---------------------------------------------------------------
create table if not exists public.integrations (
    id           uuid primary key default gen_random_uuid(),
    name         text not null unique,                 -- shown in UI, e.g. 'SMSA Express'
    kind         text not null check (kind in ('order_source', 'carrier', 'notification', 'other')),
    adapter      text not null,                        -- code adapter in api/_lib/integrations/
    base_url     text,
    config       jsonb not null default '{}',          -- non-secret settings (account no., country…)
    secret       jsonb not null default '{}',          -- API keys / passwords — never sent to browser
    active       boolean not null default false,
    last_sync_at timestamptz,
    last_status  text,                                 -- 'ok' | 'error'
    last_error   text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
alter table public.integrations enable row level security;

insert into public.integrations (name, kind, adapter, base_url, active) values
 ('Al-Farha Online Orders', 'order_source', 'alfarhaonline', 'https://api-direct.alfarhaonline.com', false),
 ('SMSA Express',           'carrier',      'smsa',          null, false),
 ('Aramex',                 'carrier',      'aramex',        null, false),
 ('DHL Express',            'carrier',      'dhl',           'https://api-eu.dhl.com', false),
 ('17Track',                'carrier',      '17track',       'https://api.17track.net', false)
on conflict (name) do nothing;

-- ---------------------------------------------------------------
-- 2. dashboard_summary(branch) — one call feeds every widget.
--    p_branch NULL = all branches (super_admin / head_office).
--    Dates use Oman time for "today" / "this month".
-- ---------------------------------------------------------------
create or replace function public.dashboard_summary(p_branch text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with
t as (
    select (now() at time zone 'Asia/Muscat')::date as today,
           date_trunc('month', now() at time zone 'Asia/Muscat')::date as month_start,
           (date_trunc('month', now() at time zone 'Asia/Muscat') - interval '1 month')::date as last_month_start
),
b as (
    select bk.*, (bk.booked_at at time zone 'Asia/Muscat')::date as day
      from bookings bk
     where not bk.archived and (p_branch is null or bk.branch_code = p_branch)
),
st as (select code, is_exception, stage from statuses),
closed as (select code from statuses where code in ('DELIVERED', 'REVIEW_REQUESTED', 'REVIEWED', 'CANCELLED', 'RETURNED_TO_SHIPPER')),
active_b as (select b.* from b where coalesce(b.current_status_code, '') not in (select code from closed)),
delivered as (
    select b.id, b.booked_at, min(e.event_at) as delivered_at
      from b join tracking_events e on e.booking_id = b.id and e.status_code = 'DELIVERED'
     group by b.id, b.booked_at
)
select jsonb_build_object(
  'generated_at', now(),
  'scope', coalesce(p_branch, 'ALL'),
  'kpis', (
    select jsonb_build_object(
      'active',           (select count(*) from active_b),
      'today_count',      count(*) filter (where day = t.today),
      'today_kg',         coalesce(sum(weight) filter (where day = t.today), 0),
      'yesterday_count',  count(*) filter (where day = t.today - 1),
      'month_count',      count(*) filter (where day >= t.month_start),
      'month_kg',         coalesce(sum(weight) filter (where day >= t.month_start), 0),
      'last_month_count', count(*) filter (where day >= t.last_month_start and day < t.month_start),
      'exceptions',       (select count(*) from active_b a join st on st.code = a.current_status_code where st.is_exception),
      'pending_inbound',  (select count(*) from transfers tr where tr.status = 'pending' and (p_branch is null or tr.to_branch = p_branch)),
      'active_consolidations', (select count(*) from consolidations c
                                 where coalesce(c.status_code, '') not in (select code from closed)
                                   and (p_branch is null or c.dest_branch = p_branch
                                        or exists (select 1 from consolidation_items ci join b on b.id = ci.booking_id where ci.consolidation_id = c.id)))
    ) from t left join b on true group by t.today, t.month_start, t.last_month_start
  ),
  'revenue', coalesce((
    select jsonb_agg(jsonb_build_object('currency', cur, 'today', today_amt, 'month', month_amt))
      from (select coalesce(br.currency, 'OMR') cur,
                   coalesce(sum(b.amount) filter (where b.day = t.today), 0) today_amt,
                   coalesce(sum(b.amount) filter (where b.day >= t.month_start), 0) month_amt
              from b cross join t left join branches br on br.branch_code = b.branch_code
             where b.amount is not null
             group by 1) x
  ), '[]'::jsonb),
  'pipeline', coalesce((
    select jsonb_agg(jsonb_build_object('stage', s, 'count', n) order by s)
      from (select a.current_stage s, count(*) n from active_b a join st on st.code = a.current_status_code
             where not st.is_exception group by 1) x
  ), '[]'::jsonb),
  'exceptions', coalesce((
    select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'count', n) order by n desc)
      from (select s.code, s.label, count(*) n from active_b a join statuses s on s.code = a.current_status_code
             where s.is_exception group by 1, 2) x
  ), '[]'::jsonb),
  'branches', coalesce((
    select jsonb_agg(row_to_json(x) order by x.month desc)
      from (select br.branch_code, br.branch_name, br.status as branch_status,
                   count(b.id) filter (where b.day = t.today) as today,
                   count(b.id) filter (where b.day >= t.month_start) as month,
                   coalesce(sum(b.weight) filter (where b.day >= t.month_start), 0) as month_kg,
                   count(b.id) filter (where coalesce(b.current_status_code, '') not in (select code from closed)) as active,
                   (select count(*) from tracking_events e where e.branch_code = br.branch_code
                       and (e.event_at at time zone 'Asia/Muscat')::date = t.today) as events_today
              from branches br cross join t
              left join b on b.branch_code = br.branch_code
             where p_branch is null or br.branch_code = p_branch
             group by br.branch_code, br.branch_name, br.status, t.today) x
  ), '[]'::jsonb),
  'daily', (
    select jsonb_agg(jsonb_build_object('day', d, 'count',
             (select count(*) from b where b.day = d)) order by d)
      from t, generate_series(t.today - 13, t.today, interval '1 day') g(dd), lateral (select dd::date d) z
  ),
  'latest', coalesce((
    select jsonb_agg(row_to_json(x))
      from (select awb, branch_code, booked_at, consignee, dest_country, dest_city, weight, pieces,
                   current_status, current_status_code
              from b order by booked_at desc limit 12) x
  ), '[]'::jsonb),
  'staff_today', coalesce((
    select jsonb_agg(jsonb_build_object('name', who, 'updates', n) order by n desc)
      from (select coalesce(e.created_by_name, 'System') who, count(*) n
              from tracking_events e, t
             where (e.event_at at time zone 'Asia/Muscat')::date = t.today
               and (p_branch is null or e.branch_code = p_branch)
             group by 1 order by 2 desc limit 8) x
  ), '[]'::jsonb),
  'sla', (
    select jsonb_build_object(
      'delivered_month', count(*) filter (where (d.delivered_at at time zone 'Asia/Muscat')::date >= t.month_start),
      'avg_days_to_deliver', round(avg(extract(epoch from d.delivered_at - d.booked_at) / 86400)
                                   filter (where (d.delivered_at at time zone 'Asia/Muscat')::date >= t.month_start)::numeric, 1),
      'overdue_10d', (select count(*) from active_b a where a.booked_at < now() - interval '10 days')
    ) from t left join delivered d on true group by t.month_start
  )
);
$$;

revoke all on function public.dashboard_summary(text) from public, anon, authenticated;
