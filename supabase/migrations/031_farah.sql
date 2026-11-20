-- 031 — Farah: the AI assistant becomes a chat in Messages.
--   * chat_messages.ai_actions: jobs Farah prepared in that message, with their state
--     [{ id, kind, title, lines, payload, state: 'ready' | 'done' | 'cancelled' | 'error', result }]
--     Kept on the server, so a Confirm runs exactly what was shown (the browser cannot change it).
--   * the per-user assistant chats (kind 'assistant', migration 030) are now called Farah.

alter table public.chat_messages add column if not exists ai_actions jsonb;

update public.chat_threads set title = 'Farah' where kind = 'assistant';
update public.chat_messages set sender_name = 'Farah' where sender_id is null and sender_name = 'AI Assistant';
