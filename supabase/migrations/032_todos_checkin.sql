-- 032 — Farah as a personal assistant.
--   * todos: each user's own to-do list (To-do page; Farah can add, list and tick them off).
--   * chat_threads.ai_checkin_on: the day Farah last sent her "what's waiting for you" check-in in this chat.
-- Read / written only by the API (service key).

create table if not exists public.todos (
    id           bigint generated always as identity primary key,
    employee_id  uuid not null references public.employees (id) on delete cascade,
    title        text not null check (length(trim(title)) between 1 and 300),
    notes        text,
    due_date     date,
    link         text,                                   -- an ERP page it is about, e.g. shipments.html?awb=…
    source       text not null default 'me' check (source in ('me', 'farah')),
    done_at      timestamptz,
    created_at   timestamptz not null default now()
);
create index if not exists todos_open on public.todos (employee_id, due_date) where done_at is null;
alter table public.todos enable row level security;    -- no policies: the API only

alter table public.chat_threads add column if not exists ai_checkin_on date;
