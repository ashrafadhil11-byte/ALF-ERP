// File: api/_routes/todos.js — my to-do list (each user sees only their own; Farah can use it too).
//   GET                                   { todos:[{ id, title, notes, due_date, link, source, done_at, created_at }] }  open + done in the last 7 days
//   POST { action:'add', title, notes?, due_date?, link? }      → { todo }
//   POST { action:'edit', id, title?, notes?, due_date?, link? } → { todo }
//   POST { action:'done' | 'undo' | 'delete', id }
import { requireSession, serviceHeaders } from '../_lib/auth.js';

const enc = encodeURIComponent;
const SEL = 'id,title,notes,due_date,link,source,done_at,created_at';
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
// a link stays inside the ERP: a page name with an optional ?query (no other sites)
const link = (v) => { const s = str(v, 300); return /^[a-z-]+\.html(\?[^\s<>"']*)?$/.test(s) ? s : null; };

export async function todoRows(employeeId) {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/todos?employee_id=eq.${enc(employeeId)}&or=(done_at.is.null,done_at.gte.${enc(since)})&select=${SEL}&order=done_at.desc.nullsfirst,due_date.asc.nullslast,id.desc&limit=200`, { headers: serviceHeaders() });
    return r.ok ? r.json() : [];
}

/** add one to-do for this user (also used by Farah) */
export async function addTodo(employeeId, b, source = 'me') {
    const title = str(b.title, 300);
    if (!title) throw new UserError('Write what needs doing.');
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/todos`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ employee_id: employeeId, title, notes: str(b.notes, 1000) || null, due_date: day(b.due_date), link: link(b.link), source }) });
    if (!r.ok) throw new UserError('Could not save the to-do.', 500);
    const [row] = await r.json();
    const { employee_id, ...todo } = row;
    return todo;
}

/** change one of this user's to-dos */
export async function setTodo(employeeId, id, patch) {
    if (!/^\d+$/.test(String(id || ''))) throw new UserError('To-do not found.', 404);
    const url = `${process.env.SUPABASE_URL}/rest/v1/todos?id=eq.${id}&employee_id=eq.${enc(employeeId)}`;
    const r = patch === null
        ? await fetch(url, { method: 'DELETE', headers: { ...serviceHeaders(), Prefer: 'return=representation' } })
        : await fetch(`${url}&select=${SEL}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) throw new UserError('To-do not found.', 404);
    return rows[0];
}

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const me = session.user.id;
    try {
        if (req.method === 'GET') return res.status(200).json({ todos: await todoRows(me) });
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        switch (b.action) {
            case 'add': return res.status(200).json({ todo: await addTodo(me, b) });
            case 'edit': {
                const patch = {};
                if ('title' in b) { patch.title = str(b.title, 300); if (!patch.title) throw new UserError('Write what needs doing.'); }
                if ('notes' in b) patch.notes = str(b.notes, 1000) || null;
                if ('due_date' in b) patch.due_date = day(b.due_date);
                if ('link' in b) patch.link = link(b.link);
                return res.status(200).json({ todo: await setTodo(me, b.id, patch) });
            }
            case 'done': return res.status(200).json({ todo: await setTodo(me, b.id, { done_at: new Date().toISOString() }) });
            case 'undo': return res.status(200).json({ todo: await setTodo(me, b.id, { done_at: null }) });
            case 'delete': await setTodo(me, b.id, null); return res.status(200).json({ success: true });
            default: throw new UserError('Unknown action.');
        }
    } catch (e) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not update your to-dos.' });
    }
}
