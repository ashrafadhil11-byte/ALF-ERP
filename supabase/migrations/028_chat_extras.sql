-- 028 — Chat extras: photos / PDFs, shared shipment cards, "typing…".
--  • Files go to the private "chat-files" bucket (5 MB, images + PDF); the app shows them through 10-minute signed links.
--  • A message can carry a shipment (awb): the chat shows a live card (status, destination, boxes).
--  • chat_members.typing_at: set while someone types; "typing…" shows for a few seconds.

alter table public.chat_messages add column if not exists file_path text;
alter table public.chat_messages add column if not exists file_name text;
alter table public.chat_messages add column if not exists file_type text;
alter table public.chat_messages add column if not exists file_size integer;
alter table public.chat_messages add column if not exists awb text;
alter table public.chat_members add column if not exists typing_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do nothing;
