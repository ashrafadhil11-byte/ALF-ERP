-- ALF-ERP — staff active flag + 15-minute carrier sync from Supabase
-- Safe to re-run.

-- 1. Deactivate staff without deleting them (history keeps their name).
alter table public.employees add column if not exists active boolean not null default true;

-- 2. Every 15 minutes: pg_cron → pg_net → https://<your-erp>/api/carrier-sync
--    Needs two secrets in Supabase Dashboard → Project Settings → Vault:
--      erp_base_url  e.g. https://alf-erp.vercel.app
--      cron_secret   the same value as CRON_SECRET in Vercel
--    Until both exist the job runs but does nothing.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_carrier_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_url    text;
    v_secret text;
begin
    select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'erp_base_url' limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret'  limit 1;
    if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
        return;
    end if;
    perform net.http_get(
        url := rtrim(v_url, '/') || '/api/carrier-sync',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
        timeout_milliseconds := 60000
    );
end;
$$;

revoke all on function public.trigger_carrier_sync() from public, anon, authenticated;

-- cron.schedule with an existing name replaces that job.
select cron.schedule('carrier-sync-every-15-min', '*/15 * * * *', 'select public.trigger_carrier_sync()');
