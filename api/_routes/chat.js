// File: api/_routes/chat.js — messages between users (one-to-one and groups).
//   GET                                   my chats { threads:[{ id, kind, title, last_message_at, last_message, last_sender, unread, members }], unread }
//   GET ?view=unread                      { unread }  (the badge in the top bar)
//   GET ?view=people                      active users I can message { people:[{ id, name, role, branch, branch_name }] }
//   GET ?thread=ID[&after=ID|&before=ID]  { thread, members:[{ id, name, role, branch, last_read_at }], messages:[…], more }
//   POST { action:'direct', user_id }                   → { thread }   open / find the one-to-one chat
//   POST { action:'group', title, members:[ids] }       → { thread }
//   POST { action:'send', thread, body?, reply_to?, file?: { name, data: dataURL }, awb? }  → { message }   (a photo / PDF up to 3 MB, or a shipment card)
//   POST { action:'typing', thread }                    shows "typing…" to the others for a few seconds
//   POST { action:'read', thread }                      marks the chat read up to now
//   POST { action:'delete', id }                        own message → "message deleted"
//   POST { action:'rename', thread, title } | { action:'add', thread, members:[ids] } | { action:'leave', thread }   (groups)
// Only members can read or write a chat. Messages are private: this route is kept out of the activity log.
// Everyone also has a chat with Farah, the AI assistant (kind 'assistant', pinned first; see api/_lib/farah.js):
// text messages only; her answer comes from /api/assistant { action:'reply' }. Her job cards are in ai_actions.
import { requireSession, serviceHeaders } from '../_lib/auth.js';

const enc = encodeURIComponent;
const PAGE = 60;
const MAX_BODY = 4000;
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const isId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const MAX_FILE = 3 * 1024 * 1024;             // the request limit of the host is ~4.5 MB of base64
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const storage = () => `${process.env.SUPABASE_URL}/storage/v1`;
/** a dataURL → the private chat-files bucket; returns { path, type, size } */
async function putFile(threadId, name, dataUrl) {
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
    const type = m && m[1].toLowerCase();
    if (!m || !FILE_TYPES[type]) throw new UserError('Send a photo (JPEG, PNG, WebP, GIF) or a PDF.');
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > MAX_FILE) throw new UserError('The file is too large (max 3 MB).');
    const path = `${threadId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${FILE_TYPES[type]}`;
    const h = serviceHeaders();
    const r = await fetch(`${storage()}/object/chat-files/${path}`, { method: 'POST', headers: { apikey: h.apikey, Authorization: h.Authorization, 'Content-Type': type }, body: bytes });
    if (!r.ok) throw new UserError(`Could not save the file (${r.status}).`, 500);
    return { path, type, size: bytes.length };
}
/** 10-minute links for the files on a page of messages */
async function signFiles(paths) {
    if (!paths.length) return {};
    const r = await fetch(`${storage()}/object/sign/chat-files`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ expiresIn: 600, paths }) });
    const list = r.ok ? await r.json() : [];
    return Object.fromEntries((Array.isArray(list) ? list : []).filter(x => x.signedURL).map(x => [x.path, `${storage()}${x.signedURL}`]));
}

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
                    get(`chat_members?thread_id=eq.${t.id}&select=employee_id,last_read_at,typing_at,employees(full_name,role,branch)`),
                    get(`chat_messages?thread_id=eq.${t.id}${after}${before}&select=id,sender_id,sender_name,body,reply_to,system,created_at,edited_at,deleted_at,file_path,file_name,file_type,file_size,awb,ai_actions&order=id.${after ? 'asc' : 'desc'}&limit=${after ? 200 : PAGE + 1}`)
                ]);
                const more = !after && rows.length > PAGE;
                const raw = after ? rows : rows.slice(0, PAGE).reverse();
                // files: short-lived links; shipments: a live card
                const urls = await signFiles(raw.filter(m => m.file_path && !m.deleted_at).map(m => m.file_path));
                const awbs = [...new Set(raw.filter(m => m.awb && !m.deleted_at).map(m => m.awb))];
                const cards = awbs.length ? await get(`bookings?awb=in.(${awbs.map(a => `"${a}"`).join(',')})&select=awb,consignee,dest_city,dest_country,current_status,current_status_code,pieces,weight,chargeable_weight,branch_code`) : [];
                // Farah's job cards go out without what they will send (that stays on the server)
                const jobs = (a) => Array.isArray(a) ? a.map(({ payload, ...x }) => x) : null;
                const list = raw.map(({ file_path, ai_actions, ...m }) => m.deleted_at ? { ...m, body: '', file_name: null, file_type: null, awb: null }
                    : { ...m, ai_actions: jobs(ai_actions), file_url: file_path ? urls[file_path] || null : null, card: m.awb ? cards.find(c => c.awb === m.awb) || null : null });
                // quoted messages that are not on this page
                const need = [...new Set(list.map(m => m.reply_to).filter(id => id && !list.some(x => x.id === id)))];
                const quoted = need.length ? await get(`chat_messages?id=in.(${need.join(',')})&thread_id=eq.${t.id}&select=id,sender_name,body,deleted_at`) : [];
                return res.status(200).json({
                    thread: t, more,
                    members: members.map(m => ({ id: m.employee_id, name: m.employees?.full_name || 'Unnamed', role: m.employees?.role, branch: m.employees?.branch, last_read_at: m.last_read_at,
                        typing: m.employee_id !== me && m.typing_at && Date.now() - new Date(m.typing_at).getTime() < 6000 })),
                    messages: list,
                    quoted: quoted.map(x => ({ id: x.id, sender_name: x.sender_name, body: x.deleted_at ? '' : String(x.body).slice(0, 200), deleted: !!x.deleted_at }))
                });
            }
            // Farah's chat is made (with her greeting) the first time the list is opened
            try { const { ensureFarah, checkIn } = await import('../_lib/farah.js'); await ensureFarah(me, session.employee?.full_name); await checkIn(session, req.headers?.authorization); } catch (e) { console.error('[farah] chat:', e.message); }
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
                if (t.kind === 'assistant' && (b.file || b.awb)) throw new UserError('Farah reads text only for now — type your question.');
                let body = String(b.body || '').replace(/\r\n/g, '\n').trim();
                // Farah's chat takes longer messages: a shared list of shipments
                const max = t.kind === 'assistant' ? 8000 : MAX_BODY;
                if (body.length > max) throw new UserError(`Keep it under ${max} characters.`);
                const extra = {};
                if (b.awb) {
                    const awb = String(b.awb).trim().toUpperCase().slice(0, 30);
                    if (!(await get(`bookings?awb=eq.${enc(awb)}&select=awb`)).length) throw new UserError(`Shipment ${awb} not found.`);
                    extra.awb = awb;
                    body = body || `📦 Shipment ${awb}`;
                }
                if (b.file) {
                    const fname = String(b.file.name || 'file').replace(/[\\/\r\n]/g, ' ').trim().slice(0, 120) || 'file';
                    const f = await putFile(t.id, fname, b.file.data);
                    Object.assign(extra, { file_path: f.path, file_name: fname, file_type: f.type, file_size: f.size });
                    body = body || `${f.type.startsWith('image/') ? '📷' : '📎'} ${fname}`;
                }
                if (!body) throw new UserError('Type a message.');
                let reply = null;
                if (/^\d+$/.test(String(b.reply_to || ''))) reply = (await get(`chat_messages?id=eq.${b.reply_to}&thread_id=eq.${t.id}&select=id`))[0]?.id || null;
                const m = (await send('POST', 'chat_messages', { thread_id: t.id, sender_id: me, sender_name: myName, body, reply_to: reply, ...extra }))[0];
                await send('PATCH', `chat_members?thread_id=eq.${t.id}&employee_id=eq.${enc(me)}`, { typing_at: null }, 'return=minimal').catch(() => {});
                return res.status(200).json({ success: true, message: m });
            }
            case 'typing': {
                const t = await thread(b.thread);
                await send('PATCH', `chat_members?thread_id=eq.${t.id}&employee_id=eq.${enc(me)}`, { typing_at: new Date().toISOString() }, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            case 'read': {
                const t = await thread(b.thread);
                await send('PATCH', `chat_members?thread_id=eq.${t.id}&employee_id=eq.${enc(me)}`, { last_read_at: new Date().toISOString() }, 'return=minimal');
                return res.status(200).json({ success: true });
            }
            case 'delete': {
                if (!/^\d+$/.test(String(b.id || ''))) throw new UserError('Message not found.', 404);
                const m = (await get(`chat_messages?id=eq.${b.id}&sender_id=eq.${enc(me)}&deleted_at=is.null&select=id,thread_id,file_path`))[0];
                if (!m) throw new UserError('You can delete only your own messages.', 403);
                await send('PATCH', `chat_messages?id=eq.${m.id}`, { deleted_at: new Date().toISOString(), body: '(deleted)', file_path: null, awb: null }, 'return=minimal');
                // a deleted file is removed from storage too
                if (m.file_path) await fetch(`${storage()}/object/chat-files`, { method: 'DELETE', headers: serviceHeaders(), body: JSON.stringify({ prefixes: [m.file_path] }) }).catch(() => {});
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
