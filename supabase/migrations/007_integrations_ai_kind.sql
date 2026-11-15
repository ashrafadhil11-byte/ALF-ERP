-- ALF-ERP — allow 'ai' integrations (space reserved for AI providers). Safe to re-run.
alter table public.integrations drop constraint if exists integrations_kind_check;
alter table public.integrations add constraint integrations_kind_check
    check (kind in ('order_source', 'carrier', 'notification', 'ai', 'other'));
