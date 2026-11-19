-- 029 — Backups you keep: a private "backups" bucket and the list of tables to export.
--   The nightly job (api/_lib/backup.js) writes one gzip JSON file of every business table; the last 14 are kept.
--   Super admin downloads them on the Backups page. Secrets are left out (integration keys, PIN hashes);
--   sign-in passwords live in Supabase Auth and are not part of this export.

insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do nothing;

-- every table of the app (public schema), biggest log last
create or replace function public.backup_tables()
returns table (name text, rows bigint)
language sql stable set search_path to 'public' as $$
    select c.relname::text, c.reltuples::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by (c.relname = 'audit_log'), c.relname;
$$;
revoke all on function public.backup_tables() from public, anon, authenticated;
