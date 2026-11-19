// File: api/_routes/chat.js — messages between users (one-to-one and groups).
//   GET                                   my chats { threads:[{ id, kind, title, last_message_at, last_message, last_sender, unread, members }], unread }
//   GET ?view=unread                      { unread }  (the badge in the top bar)
//   GET ?view=people                      active users I can message { people:[{ id, name, role, branch, branch_name }] }
//   GET ?thread=ID[&after=ID|&before=ID]  { thread, members:[{ id, name, role, branch, last_read_at }], messages:[…], more }
//   POST { action:'direct', user_id }                   → { thread }   open / find the one-to-one chat
//   POST { action:'group', title, members:[ids] }       → { thread }
//   POST { action:'send', thread, body, reply_to? }     → { message }
//   POST { action:'read', thread }                      marks the chat read up to now
//   POST { action:'delete', id }                        own message → "message deleted"
//   POST { action:'rename', thread, title } | { action:'add', thread, members:[ids] } | { action:'leave', thread }   (groups)
// Only members can read or write a chat. Messages are private: this route is kept out of the activity log.
import { requireSession, serviceHeaders } from '../_lib/auth.js';

const enc = encodeURIComponent;
const PAGE = 60;
const MAX_BODY = 4000;
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const isId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const me = session.user.id;
    const myName = session.employee?.full_name || session.user.email;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const send = async (method, path, body, prefer = 'return=representation') => {
        const r = await fetch(`${rest}/${path}`, { method, headers: { ...serviceHeaders(), Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
        const out = await r.json().catch(() => null);
        if (!r.ok) throw new UserError(out?.message || 'Could not save.', 500);
        return out;
    };
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    // the chat, if I am in it
    const thread = async (id) => {
        if (!/^\d+$/.test(String(id || ''))) throw new UserError('Chat not found.', 404);
        const t = (await get(`chat_threads?id=eq.${enc(id)}&select=id,kind,title,created_by,created_at,chat_members!inner(employee_id)&chat_members.employee_id=eq.${enc(me)}`))[0];
        if (!t) throw new UserError('Chat not found.', 404);
        delete t.chat_members;
        return t;
    };
    const activeIds = async (ids) => {
        const list = [...new Set((Array.isArray(ids) ? ids : []).filter(isId))].filter(x => x !== me).slice(0, 50);
        if (!list.length) return [];
        return (await get(`employees?id=in.(${list.map(enc).join(',')})&active=not.is.false&select=id`)).map(e => e.id);
    };

    try {
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.view === 'unread') return res.status(200).json({ unread: +(await rpc('chat_unread', { p_me: me })) || 0 });
            if (q.view === 'people') {
                const [people, branches] = await Promise.all([
                    get(`employees?active=not.is.false&id=neq.${enc(me)}&select=id,full_name,role,branch&order=full_name`),
                    get('branches?select=branch_code,branch_name')
                ]);
                const bn = Object.fromEntries(branches.map(b => [b.branch_code, b.branch_name]));
                return res.status(200).json({ people: people.map(p => ({ id: p.id, name: p.full_name || 'Unnamed', role: p.role, branch: p.branch, branch_name: bn[p.branch] || p.branch || '' })) });
            }
            if (q.thread) {
                const t = await thread(q.thread);
                const after = /^\d+$/.test(String(q.after || '')) ? `&id=gt.${q.after}` : '';
                const before = /^\d+$/.test(String(q.before || '')) ? `&id=lt.${q.before}` : '';
                const [members, rows] = await Promise.all([
                    get(`chat_members?thread_id=eq.${t.id}&select=employee_id,last_read_at,employees(full_name,role,branch)`),
                    get(`chat_messages?thread_id=eq.${t.id}${after}${before}&select=id,sender_id,sender_name,body,reply_to,system,created_at,edited_at,deleted_at&order=id.${after ? 'asc' : 'desc'}&limit=${after ? 200 : PAGE + 1}`)
                ]);
                const more = !after && rows.length > PAGE;
                const list = (after ? rows : rows.slice(0, PAGE).reverse()).map(m => m.deleted_at ? { ...m, body: '' } : m);
                // quoted messages that are not on this page
                const need = [...new Set(list.map(m => m.reply_to).filter(id => id && !list.some(x => x.id === id)))];
                const quoted = need.length ? await get(`chat_messages?id=in.(${need.join(',')})&thread_id=eq.${t.id}&select=id,sender_name,body,deleted_at`) : [];
                return res.status(200).json({
                    thread: t, more,
                    members: members.map(m => ({ id: m.employee_id, name: m.employees?.full_name || 'Unnamed', role: m.employees?.role, branch: m.employees?.branch, last_read_at: m.last_read_at })),
                    messages: list,
                    quoted: quoted.map(x => ({ id: x.id, sender_name: x.sender_name, body: x.deleted_at ? '' : String(x.body).slice(0, 200), deleted: !!x.deleted_at }))
                });
            }
            const [threads, unread] = await Promise.all([rpc('chat_inbox', { p_me: me }), rpc('chat_unread', { p_me: me })]);
            return res.status(200).json({ threads, unread: +unread || 0 });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        switch (b.action) {
            case 'direct': {
                if (!isId(b.user_id)) throw new UserError('Choose who to chat with.');
                return res.status(200).json({ success: true, thread: await rpc('chat_direct', { p_me: me, p_other: b.user_id }) });
            }
            case 'group': {
                const title = String(b.title || '').trim().slice(0, 80);
                if (!title) throw new UserError('Give the group a name.');
                const ids = await activeIds(b.members);
                if (ids.length < 1) throw new UserError('Add at least one person.');
                const t = (await send('POST', 'chat_threads', { kind: 'group', title, created_by: me }))[0];
                await send('POST', 'chat_members', [me, ...ids].map(id => ({ thread_id: t.id, employee_id: id })), 'return=minimal');
                await send('POST', 'chat_messages', { thread_id: t.id, sender_id: me, sender_name: myName, system: true, body: `${myName} created the group “${title}”` }, 'return=minimal');
                return res.status(200).json({ success: true, thread: t.id });
            }
            case 'send': {
                const t = await thread(b.thread);
                const body = String(b.body || '').replace(/\r\n/g, '\n').trim();
                if (!body) throw new UserError('Type a message.');
                if (body.length > MAX_BODY) throw new UserError(`Keep it under ${MAX_BODY} characters.`);
                let reply = null;
                if (/^\d+$/.test(String(b.reply_to || ''))) reply = (await get(`chat_messages?id=eq.${b.reply_to}&thread_id=eq.${t.id}&select=id`))[0]?.id || null;
                const m = (await send('POST', 'chat_messages', { thread_id: t.id, sender_id: me, sender_name: myName, body, reply_to: reply }))[0];
                return res.status(200).json({ success: true, message: m });
            }
            case 'read': {
                const t = await thread(b.thread);
                await send('PATCH', `chat_members?thread_id=eq.${t.id}&employee_id=eq.${enc(me)}`, { last_read_at: new Date().toISOString() }, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            case 'delete': {
                if (!/^\d+$/.test(String(b.id || ''))) throw new UserError('Message not found.', 404);
                const m = (await get(`chat_messages?id=eq.${b.id}&sender_id=eq.${enc(me)}&deleted_at=is.null&select=id,thread_id`))[0];
                if (!m) throw new UserError('You can delete only your own messages.', 403);
                await send('PATCH', `chat_messages?id=eq.${m.id}`, { deleted_at: new Date().toISOString(), body: '(deleted)' }, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            case 'rename': {
                const t = await thread(b.thread);
                if (t.kind !== 'group') throw new UserError('Only a group has a name.');
                const title = String(b.title || '').trim().slice(0, 80);
                if (!title) throw new UserError('Give the group a name.');
                await send('PATCH', `chat_threads?id=eq.${t.id}`, { title }, 'return=minimal');
                await send('POST', 'chat_messages', { thread_id: t.id, sender_id: me, sender_name: myName, system: true, body: `${myName} renamed the group to “${title}”` }, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            case 'add': {
                const t = await thread(b.thread);
                if (t.kind !== 'group') throw new UserError('Start a group to chat with more people.');
                const ids = await activeIds(b.members);
                if (!ids.length) throw new UserError('Choose who to add.');
                await send('POST', 'chat_members?on_conflict=thread_id,employee_id', ids.map(id => ({ thread_id: t.id, employee_id: id })), 'resolution=ignore-duplicates,return=minimal');
                const names = (await get(`employees?id=in.(${ids.map(enc).join(',')})&select=full_name`)).map(e => e.full_name).filter(Boolean);
                await send('POST', 'chat_messages', { thread_id: t.id, sender_id: me, sender_name: myName, system: true, body: `${myName} added ${names.join(', ')}` }, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            case 'leave': {
                const t = await thread(b.thread);
                if (t.kind !== 'group') throw new UserError('You can leave a group, not a one-to-one chat.');
                await send('POST', 'chat_messages', { thread_id: t.id, sender_id: me, sender_name: myName, system: true, body: `${myName} left the group` }, 'return=minimal');
                await send('DELETE', `chat_members?thread_id=eq.${t.id}&employee_id=eq.${enc(me)}`, undefined, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            default: throw new UserError('Unknown action.');
        }
    } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: 'Chat failed.', details: e.message });
    }
}
