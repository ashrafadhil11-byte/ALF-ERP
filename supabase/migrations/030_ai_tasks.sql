-- 030 — AI assistant tasks: scheduled reports, delivered as chat messages from "AI Assistant".
--   * chat_threads gets a third kind, 'assistant': one per user (direct_key 'ai:<employee id>'), only that user
--     is a member; messages have no sender (sender_name 'AI Assistant'), so they count as unread and chime.
--   * ai_reports: a user's recurring reports (set up by asking the assistant, confirmed by the user).
--     morning = ~6 am Oman (yesterday), evening = ~8 pm Oman (today). Read / written only by the API (service key).

alter table public.chat_threads drop constraint if exists chat_threads_kind_check;
alter table public.chat_threads add constraint chat_threads_kind_check check (kind in ('direct', 'group', 'assistant'));

create table if not exists public.ai_reports (
    id            bigint generated always as identity primary key,
    employee_id   uuid not null references public.employees (id) on delete cascade,
    kind          text not null check (kind in ('daily_summary', 'exceptions', 'unpaid')),
    slot          text not null check (slot in ('morning', 'evening')),
    branch_code   text,                                   -- head office may pick one branch; null = theirs / company
    active        boolean not null default true,
    created_at    timestamptz not null default now(),
    last_sent_on  date,
    unique (employee_id, kind, slot)
);
create index if not exists ai_reports_slot on public.ai_reports (slot) where active;

alter table public.ai_reports enable row level security;   -- no policies: the API (service key) only
