// File: api/_lib/farah.js — Farah, the AI assistant, as a chat in Messages.
// Every user has one Farah chat (chat_threads kind 'assistant', direct_key 'ai:<employee id>'), pinned at the top of
// Messages. She greets them when the chat is made; the scheduled reports arrive there too.
//   reply(session, auth, threadId)        answers the user's latest message (from the chat's recent history)
//   act(session, auth, messageId, actionId, 'run' | 'cancel')   Confirm / Cancel on a job card in her message
// The jobs live in chat_messages.ai_actions on the server, so Confirm runs exactly what the card showed.
import { serviceHeaders } from './auth.js';
import { ask } from './assistant.js';
import { runProposal, whatsWaiting } from './ai-tasks.js';

export const FARAH = 'Farah';
const enc = encodeURIComponent;
const rest = () => `${process.env.SUPABASE_URL}/rest/v1`;
const get = async (path) => { const r = await fetch(`${rest()}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
const omanHour = () => new Date(Date.now() + 4 * 36e5).getUTCHours();
const omanDay = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
class FarahError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }

/** the jobs as the browser sees them (without what will be sent) */
export const publicActions = (list) => Array.isArray(list) ? list.map(({ payload, ...a }) => a) : null;

export function greeting(name) {
    const h = omanHour();
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return `${hello}, ${firstName(name)}! 👋 I'm ${FARAH}, your assistant here at Al-Farha Cargo.\n`
        + 'Ask me anything — shipments, consolidations, money, stock, pickups, attendance — or tell me what to do '
        + '(like "mark 311000045 out for delivery" or "send me the daily summary every morning"). '
        + 'I\'ll get it ready and you just tap Confirm. 😊';
}

const cache = new Set();          // employees whose Farah chat is known to exist (warm function)
/** the user's Farah chat; made (with a greeting) the first time */
export async function ensureFarah(employeeId, name) {
    if (cache.has(employeeId)) return;
    const key = `ai:${employeeId}`;
    let t = (await get(`chat_threads?direct_key=eq.${enc(key)}&select=id`))[0];
    if (!t) {
        const r = await fetch(`${rest()}/chat_threads?on_conflict=direct_key`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ kind: 'assistant', direct_key: key, title: FARAH }) });
        t = (r.ok ? await r.json() : [])[0];
        if (!t) return;                // made at the same moment by another request
        await fetch(`${rest()}/chat_members`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ thread_id: t.id, employee_id: employeeId, last_read_at: '2000-01-01T00:00:00Z' }) });
        await fetch(`${rest()}/chat_messages`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ thread_id: t.id, sender_id: null, sender_name: FARAH, body: greeting(name) }) });
    }
    cache.add(employeeId);
}

// ---------------------------------------------------------------- the daily check-in
const fmtDay = (d) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

/** Farah's "here is what is waiting" message, or null when nothing is waiting */
export function checkInText(name, w) {
    const h = omanHour();
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const lines = [], asks = [];
    if (w.leave.length) {
        lines.push(`• ${w.leave.length} leave request${w.leave.length > 1 ? 's' : ''} — ${w.leave.slice(0, 3).map(l => `${firstName(l.employee)} (${fmtDay(l.from)}${l.to && l.to !== l.from ? `–${fmtDay(l.to)}` : ''})`).join(', ')}${w.leave.length > 3 ? '…' : ''}`);
        asks.push(w.leave.length > 1 ? 'Shall I approve the leave requests, or would you like to look at them first?' : `Shall I approve ${firstName(w.leave[0].employee)}'s leave, or would you like to look at it first?`);
    }
    const reqs = w.items.filter(i => i.kind === 'request' || i.kind === 'cash' || i.kind === 'inbound');
    for (const i of reqs.slice(0, 4)) lines.push(`• ${i.title}${i.detail ? ` — ${String(i.detail).slice(0, 80)}` : ''}${i.link ? `  ${i.link}` : ''}`);
    if (reqs.length > 4) lines.push(`• …and ${reqs.length - 4} more in the bell 🔔`);
    if (reqs.some(i => i.needs_pin)) asks.push('The Main Office / warehouse ones need your PIN — tap the link and I can tell you more about any of them.');
    const ex = w.items.filter(i => i.kind === 'exception').length;
    if (ex) lines.push(`• ${ex} shipment${ex > 1 ? 's' : ''} with a problem (hold, failed delivery…)`);
    const due = w.todos.filter(t => !t.due || t.overdue || t.due <= omanDay());
    if (due.length) lines.push(`• ${due.length} to-do${due.length > 1 ? 's' : ''}: ${due.slice(0, 3).map(t => t.title).join(' · ')}${due.length > 3 ? '…' : ''}${due.some(t => t.overdue) ? ' (some overdue)' : ''}`);
    if (!lines.length) return null;
    return `${hello}, ${firstName(name)}! ${h < 12 ? '☀️' : h < 17 ? '👋' : '🌙'} A few things are waiting for you:\n${lines.join('\n')}\n\n${asks[0] || 'Want me to go through them with you, one by one?'}${asks[1] ? '\n' + asks[1] : ''}`;
}

const checked = new Map();            // employee → Oman day already handled (warm function)
/** once a day, on the first visit (from 5 am Oman): Farah says what is waiting — only when something is */
export async function checkIn(session, auth) {
    const me = session.user.id, today = omanDay();
    if (checked.get(me) === today || omanHour() < 5) return;
    checked.set(me, today);
    const t = (await get(`chat_threads?direct_key=eq.${enc('ai:' + me)}&select=id,ai_checkin_on`))[0];
    if (!t || t.ai_checkin_on === today) return;
    // claim the day first, so two tabs opening at once send it only once
    const r = await fetch(`${rest()}/chat_threads?id=eq.${t.id}&or=(ai_checkin_on.is.null,ai_checkin_on.lt.${today})`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ ai_checkin_on: today }) });
    if (!r.ok || !(await r.json()).length) return;
    const text = checkInText(session.employee?.full_name, await whatsWaiting(session, auth));
    if (text) await say(t.id, text);
}

/** this user's own Farah chat, or an error */
async function myFarah(session, threadId) {
    const t = (await get(`chat_threads?id=eq.${enc(threadId)}&kind=eq.assistant&direct_key=eq.${enc('ai:' + session.user.id)}&select=id`))[0];
    if (!t) throw new FarahError('Chat not found.', 404);
    return t.id;
}

async function say(threadId, body, actions) {
    const r = await fetch(`${rest()}/chat_messages`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ thread_id: threadId, sender_id: null, sender_name: FARAH, body: String(body).slice(0, 4000), ai_actions: actions?.length ? actions : null }) });
    const m = (r.ok ? await r.json() : [])[0];
    if (!m) throw new FarahError('Could not save the answer.', 500);
    return { id: m.id, sender_id: null, sender_name: FARAH, body: m.body, created_at: m.created_at, ai_actions: publicActions(m.ai_actions) };
}

/** answers the user's latest message in their Farah chat → the new message */
export async function reply(session, auth, threadId) {
    const id = await myFarah(session, threadId);
    const rows = await get(`chat_messages?thread_id=eq.${id}&deleted_at=is.null&system=not.is.true&select=id,sender_id,body,created_at&order=id.desc&limit=10`);
    const last = rows[0];
    if (!last || last.sender_id !== session.user.id || !String(last.body || '').trim()) return { message: null };   // already answered
    const past = rows.slice(1).reverse();
    const history = past.map(m => ({ role: m.sender_id === session.user.id ? 'user' : 'assistant', content: String(m.body || '').slice(0, 700) }));
    const firstToday = !past.some(m => m.sender_id === session.user.id && String(m.created_at).slice(0, 10) === omanDay());
    let out;
    try {
        out = await ask(String(last.body).slice(0, 1000), history, session, auth, { firstToday });
    } catch (e) {
        const text = e.setup ? `I'm not switched on yet 🙈 — a super admin needs to add an AI key in Integrations.`
            : e.status === 429 || e.status === 503 ? 'Sorry, I\'m a bit swamped right now 😅 — could you ask me again in a minute?'
                : `Sorry, something went wrong on my side: ${e.message}`;
        return { message: await say(id, text) };
    }
    const actions = (out.actions || []).map(a => ({ ...a, state: 'ready' }));
    return { message: await say(id, out.answer || (actions.length ? 'Here you go — please check and tap Confirm:' : 'Hmm, I have no answer for that.'), actions) };
}

/** Confirm or Cancel a job card in one of Farah's messages → the updated message */
export async function act(session, auth, messageId, actionId, what) {
    const m = (await get(`chat_messages?id=eq.${enc(messageId)}&sender_id=is.null&select=id,thread_id,body,created_at,ai_actions,chat_threads!inner(kind,direct_key)&chat_threads.direct_key=eq.${enc('ai:' + session.user.id)}`))[0];
    if (!m) throw new FarahError('Message not found.', 404);
    const list = Array.isArray(m.ai_actions) ? m.ai_actions : [];
    const a = list.find(x => x.id === actionId);
    if (!a) throw new FarahError('That job is not in this message.', 404);
    if (a.state === 'done' || a.state === 'cancelled') throw new FarahError(a.state === 'done' ? 'This was already done.' : 'This was cancelled.', 409);
    if (what === 'cancel') { a.state = 'cancelled'; a.result = 'Cancelled — nothing was changed.'; }
    else {
        try { const r = await runProposal({ kind: a.kind, payload: a.payload }, session, auth); a.state = 'done'; a.result = r.message; }
        catch (e) { a.state = 'error'; a.result = e.message; }
    }
    a.at = new Date().toISOString();
    await fetch(`${rest()}/chat_messages?id=eq.${m.id}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ ai_actions: list }) });
    return { message: { id: m.id, ai_actions: publicActions(list) }, ok: a.state !== 'error', result: a.result };
}
