-- 023 — Messages between users: one-to-one chats and group chats.
--  • chat_threads: a direct chat (direct_key = the two user ids, sorted) or a named group
--  • chat_members: who is in it and up to when they have read it
--  • chat_messages: text, optional reply to another message; deleting leaves a "message deleted" line
-- The app reads and writes through /api/chat (service role); nothing is open to the browser directly.

create table if not exists public.chat_threads (
    id              bigserial primary key,
    kind            text not null check (kind in ('direct', 'group')),
    title           text,
    direct_key      text unique,
    created_by      uuid references public.employees (id) on delete set null,
    created_at      timestamptz not null default now(),
    last_message_at timestamptz,
    last_message    text,
    last_sender     text,
    check (kind = 'group' or direct_key is not null)
);
alter table public.chat_threads enable row level security;

create table if not exists public.chat_members (
    thread_id    bigint not null references public.chat_threads (id) on delete cascade,
    employee_id  uuid not null references public.employees (id) on delete cascade,
    joined_at    timestamptz not null default now(),
    last_read_at timestamptz not null default now(),
    primary key (thread_id, employee_id)
);
create index if not exists chat_members_emp_idx on public.chat_members (employee_id);
alter table public.chat_members enable row level security;

create table if not exists public.chat_messages (
    id          bigserial primary key,
    thread_id   bigint not null references public.chat_threads (id) on delete cascade,
    sender_id   uuid references public.employees (id) on delete set null,
    sender_name text,
    body        text not null check (char_length(body) between 1 and 4000),
    reply_to    bigint references public.chat_messages (id) on delete set null,
    system      boolean not null default false,          -- "X created the group", "X left" …
    created_at  timestamptz not null default now(),
    edited_at   timestamptz,
    deleted_at  timestamptz
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, id desc);
alter table public.chat_messages enable row level security;

-- a new message: the thread shows it in the list, and the sender has read up to it
create or replace function public.chat_after_message() returns trigger
language plpgsql set search_path to 'public' as $$
begin
    update public.chat_threads set last_message_at = new.created_at, last_message = left(new.body, 200), last_sender = new.sender_name
    where id = new.thread_id;
    update public.chat_members set last_read_at = new.created_at where thread_id = new.thread_id and employee_id = new.sender_id;
    return new;
end $$;
drop trigger if exists chat_after_message on public.chat_messages;
create trigger chat_after_message after insert on public.chat_messages for each row execute function public.chat_after_message();

-- open (or find) the one-to-one chat between two users
create or replace function public.chat_direct(p_me uuid, p_other uuid) returns bigint
language plpgsql set search_path to 'public' as $$
declare v_key text; v_id bigint;
begin
    if p_me = p_other then raise exception 'Choose someone else to chat with.'; end if;
    if not exists (select 1 from public.employees where id = p_other and coalesce(active, true)) then raise exception 'That user is not active.'; end if;
    v_key := least(p_me::text, p_other::text) || ':' || greatest(p_me::text, p_other::text);
    select id into v_id from public.chat_threads where direct_key = v_key;
    if v_id is null then
        insert into public.chat_threads (kind, direct_key, created_by) values ('direct', v_key, p_me)
        on conflict (direct_key) do update set direct_key = excluded.direct_key
        returning id into v_id;
    end if;
    insert into public.chat_members (thread_id, employee_id) values (v_id, p_me), (v_id, p_other) on conflict do nothing;
    return v_id;
end $$;

-- my chats, newest first, with unread counts and the other members' names
create or replace function public.chat_inbox(p_me uuid)
returns table (id bigint, kind text, title text, last_message_at timestamptz, last_message text, last_sender text,
               unread integer, members jsonb)
language sql stable set search_path to 'public' as $$
    select t.id, t.kind, t.title, coalesce(t.last_message_at, t.created_at), t.last_message, t.last_sender,
           (select count(*)::int from public.chat_messages m
             where m.thread_id = t.id and m.created_at > me.last_read_at and m.sender_id is distinct from p_me and m.deleted_at is null),
           (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name, 'role', e.role, 'branch', e.branch) order by e.full_name), '[]'::jsonb)
              from public.chat_members cm join public.employees e on e.id = cm.employee_id
             where cm.thread_id = t.id and cm.employee_id <> p_me)
    from public.chat_members me
    join public.chat_threads t on t.id = me.thread_id
    where me.employee_id = p_me
      and (t.kind = 'group' or t.last_message_at is not null)          -- an empty direct chat stays out of the list
    order by coalesce(t.last_message_at, t.created_at) desc
    limit 200;
$$;

create or replace function public.chat_unread(p_me uuid) returns integer
language sql stable set search_path to 'public' as $$
    select count(*)::int from public.chat_members me
    join public.chat_messages m on m.thread_id = me.thread_id
    where me.employee_id = p_me and m.created_at > me.last_read_at and m.sender_id is distinct from p_me and m.deleted_at is null;
$$;

revoke all on function public.chat_direct(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_inbox(uuid) from public, anon, authenticated;
revoke all on function public.chat_unread(uuid) from public, anon, authenticated;
