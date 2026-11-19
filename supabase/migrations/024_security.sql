-- 024 — Safety fixes from the November review.
--  • employees / branches: remove the "any signed-in user can read" rules. The app reads these tables only from
--    the server (service key), never from the browser, so nothing in the app uses them. With them gone, a login
--    token alone cannot read staff records (PIN hashes, civil IDs, dates of birth).
--  • employees: count wrong passwords and lock the account for 15 minutes after 5 (see api/_routes/login.js).

drop policy if exists "Allow authenticated read access" on public.employees;
drop policy if exists "Allow authenticated read access on branches" on public.branches;

alter table public.employees add column if not exists login_failed integer not null default 0;
alter table public.employees add column if not exists login_locked_until timestamptz;
