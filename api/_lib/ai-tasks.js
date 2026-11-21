// File: api/_lib/ai-tasks.js — what the AI assistant may DO, and the reports it sends.
//
// Jobs (status updates, pickups, chat messages, scheduled reports) work in two steps:
//   1. propose(kind, args, session) — the AI only PREPARES the job: it is checked and described
//      ({ kind, title, lines, payload }) and shown to the user as a card. Nothing changes yet.
//   2. runProposal({ kind, payload }, session, auth) — the user tapped Confirm: the job is done through the same
//      API the pages use (same permissions, same checks, written to the Activity Log as that user).
// Reports: runReports('morning' | 'evening') — the scheduled jobs post each user's reports to their
// Farah chat (a chat thread of kind 'assistant'), so they get the chime and the phone notification.
import { serviceHeaders, ADMIN_ROLES } from './auth.js';
import { withAudit } from './audit.js';
import { totalOf } from './summary-total.js';
import statusRoute from '../_routes/status.js';
import pickupsRoute from '../_routes/pickups.js';
import chatRoute from '../_routes/chat.js';
import accountsRoute from '../_routes/accounts.js';
import attendanceRoute from '../_routes/attendance.js';
import notificationsRoute from '../_routes/notifications.js';
import { todoRows } from '../_routes/todos.js';

const enc = encodeURIComponent;
const MANAGERS = [...ADMIN_ROLES, 'branch_manager'];
const omanDay = (plusDays = 0) => new Date(Date.now() + 4 * 36e5 + plusDays * 864e5).toISOString().slice(0, 10);
const rest = () => `${process.env.SUPABASE_URL}/rest/v1`;
const get = async (path) => { const r = await fetch(`${rest()}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (m) => Object.entries(m || {}).filter(([, v]) => +v).map(([c, v]) => `${c} ${(+v).toFixed(c === 'OMR' ? 3 : 2)}`).join(' + ') || '0';
class TaskError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }

export const REPORTS = {
    daily_summary: { label: 'Daily summary', managers: true },
    exceptions: { label: 'Shipments with problems (holds, failed deliveries, returns)', managers: false },
    unpaid: { label: 'Unpaid invoices', managers: true }
};
export const SLOTS = { morning: 'every morning around 6 am (yesterday\'s figures)', evening: 'every evening around 8 pm (today\'s figures)' };

/** call one of the API routes as this user; writes go through the Activity Log like a click on the page */
export async function callRoute(name, handler, { method = 'GET', query = {}, body } = {}, auth) {
    const out = { status: 200, body: null };
    const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; out.status = c; return this; },
        json(b) { out.body = b; return this; },
        setHeader() { return this; }, end() { return this; }, send(b) { out.body = b; return this; }
    };
    const req = { method, query: { ...query }, body, headers: { authorization: auth, 'user-agent': 'Farah (AI assistant)' } };
    await withAudit(name, handler, req, res);
    return out;
}

// ---------------------------------------------------------------- 1. prepare a job
async function findEmployee(name, session, extra = '') {
    const t = str(name, 80).replace(/[*,()]/g, '');
    if (t.length < 2) throw new TaskError('Give the person\'s name.');
    const people = await get(`employees?active=not.is.false&id=neq.${enc(session.user.id)}&full_name=ilike.*${enc(t)}*${extra}&select=id,full_name,role,branch&limit=10`);
    const exact = people.filter(p => loose(p.full_name) === loose(t));
    const list = exact.length === 1 ? exact : people;
    if (!list.length) throw new TaskError(`Nobody called "${t}" was found.`);
    if (list.length > 1) throw new TaskError(`More than one person matches "${t}": ${list.map(p => `${p.full_name} (${p.branch || 'head office'})`).join(', ')}. Ask which one.`);
    return list[0];
}

async function findPickup(no, session) {
    const n = str(no, 40).replace(/[^A-Za-z0-9-]/g, '');
    const p = (await get(`pickup_requests?or=(pickup_no.eq.${enc(n)},id.eq.${/^\d+$/.test(n) ? n : 0})&select=id,pickup_no,branch_code,customer_name,address,pickup_date,slot,status,driver_id,driver_name&limit=1`))[0];
    const isAdmin = ADMIN_ROLES.includes(session.role);
    if (!p || !(isAdmin || p.branch_code === session.branch || p.driver_id === session.user.id)) throw new TaskError(`Pickup ${n} not found.`);
    return p;
}

/** checks a job and describes it; returns { kind, title, lines, payload } — does NOT change anything */
export async function propose(kind, a = {}, session) {
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const isManager = MANAGERS.includes(session.role);
    switch (kind) {
        case 'status': {
            const awbs = [...new Set((Array.isArray(a.awbs) ? a.awbs : String(a.awbs || '').split(/[\s,]+/)).map(x => str(x, 40).toUpperCase()).filter(Boolean))];
            if (!awbs.length) throw new TaskError('Which shipments (AWB numbers)?');
            if (awbs.length > 200) throw new TaskError('At most 200 shipments at a time.');
            const statuses = await get('statuses?active=is.true&select=code,label,requires');
            const want = loose(a.status);
            const st = statuses.find(s => loose(s.code) === want || loose(s.label) === want) || statuses.find(s => loose(s.label).includes(want) && want.length > 3);
            if (!st) throw new TaskError(`Unknown status "${str(a.status, 60)}". Choose one of: ${statuses.map(s => s.label).join(', ')}.`);
            if (st.requires.includes('agent_docket') || st.requires.includes('delivery_docket')) throw new TaskError(`"${st.label}" needs the agent and docket numbers — use propose_assign_agent.`);
            const need = { driver: 'the driver', to_branch: 'the branch it goes to', mawb: 'the MAWB number', remark: 'a reason (remark)' };
            const missing = st.requires.filter(f => need[f] && !str(a[f]));
            if (missing.length) throw new TaskError(`"${st.label}" needs ${missing.map(f => need[f]).join(' and ')}. Ask the user.`);
            const list = awbs.map(x => `"${x.replace(/"/g, '')}"`).join(',');
            const found = await get(`bookings?awb=in.(${enc(list)})&select=awb,branch_code,consignee,dest_country,current_status`);
            const notFound = awbs.filter(x => !found.some(f => f.awb === x));
            if (notFound.length) throw new TaskError(`Not found: ${notFound.slice(0, 10).join(', ')}.`);
            if (!isAdmin) {
                const other = found.filter(f => f.branch_code !== session.branch).map(f => f.awb);
                if (other.length) throw new TaskError(`Held by another branch, so this user cannot update: ${other.slice(0, 10).join(', ')}.`);
            }
            const payload = { awbs, code: st.code };
            for (const f of ['location', 'remark', 'driver', 'to_branch', 'mawb']) if (str(a[f])) payload[f] = str(a[f], 200);
            return {
                kind, payload,
                title: `Change ${awbs.length} shipment${awbs.length > 1 ? 's' : ''} to "${st.label}"`,
                lines: [
                    ...found.slice(0, 8).map(f => `${f.awb} — ${f.consignee || ''}${f.dest_country ? `, ${f.dest_country}` : ''} (now: ${f.current_status || '—'})`),
                    ...(found.length > 8 ? [`…and ${found.length - 8} more`] : []),
                    ...['location', 'remark', 'driver', 'to_branch', 'mawb'].filter(f => payload[f]).map(f => `${f.replace('_', ' ')}: ${payload[f]}`)
                ]
            };
        }
        case 'assign_agent': {
            // "Assigned Delivery Agent" / "Assigned Forwarding Agent" for one or many AWBs, each with its docket (or one for all)
            const delivery = !/^forw/i.test(String(a.leg || 'delivery'));
            const code = delivery ? 'ASSIGNED_DELIVERY_AGENT' : 'ASSIGNED_TO_AGENT';
            const agent = str(a.agent, 60);
            if (!agent) throw new TaskError(`Which ${delivery ? 'delivery' : 'forwarding'} agent (e.g. Delhivery)?`);
            const one = str(a.docket, 60);
            const items = (Array.isArray(a.items) ? a.items : []).map(x => ({ awb: str(x?.awb, 40).toUpperCase(), docket: str(x?.docket, 60) })).filter(x => x.awb);
            for (const w of (Array.isArray(a.awbs) ? a.awbs : String(a.awbs || '').split(/[\s,]+/)).map(x => str(x, 40).toUpperCase()).filter(Boolean)) if (!items.some(x => x.awb === w)) items.push({ awb: w, docket: '' });
            if (!items.length) throw new TaskError('Which shipments (AWB numbers)?');
            if (items.length > 200) throw new TaskError('At most 200 shipments at a time.');
            const noDocket = items.filter(x => !x.docket && !one).map(x => x.awb);
            if (noDocket.length) throw new TaskError(`I need the docket / LR number for ${noDocket.slice(0, 10).join(', ')}. Ask the user.`);
            const st = (await get(`statuses?code=eq.${code}&active=is.true&select=code,label`))[0];
            if (!st) throw new TaskError(`The status for this is not set up yet.`);
            const awbs = [...new Set(items.map(x => x.awb))];
            const found = await get(`bookings?awb=in.(${enc(awbs.map(x => `"${x.replace(/"/g, '')}"`).join(','))})&select=awb,branch_code,consignee,dest_country,current_status`);
            const notFound = awbs.filter(x => !found.some(f => f.awb === x));
            if (notFound.length) throw new TaskError(`Not found: ${notFound.slice(0, 10).join(', ')}.`);
            if (!isAdmin) {
                const other = found.filter(f => f.branch_code !== session.branch).map(f => f.awb);
                if (other.length) throw new TaskError(`Held by another branch, so this user cannot update: ${other.slice(0, 10).join(', ')}.`);
            }
            const dockets = Object.fromEntries(items.map(x => [x.awb, x.docket || one]));
            const payload = { awbs, code, [delivery ? 'delivery_agent' : 'fwd_agent']: agent, dockets };
            if (str(a.remark)) payload.remark = str(a.remark, 200);
            return {
                kind: 'status', payload,
                title: `${st.label}: ${agent} for ${awbs.length} shipment${awbs.length > 1 ? 's' : ''}`,
                lines: [...awbs.slice(0, 12).map(w => { const f = found.find(x => x.awb === w) || {}; return `${w} → ${dockets[w]}${f.consignee ? ` · ${f.consignee}` : ''}${f.dest_country ? `, ${f.dest_country}` : ''}`; }),
                    ...(awbs.length > 12 ? [`…and ${awbs.length - 12} more`] : [])]
            };
        }
        case 'pickup_create': {
            const branch = isAdmin ? str(a.branch || session.branch, 20).toUpperCase() : session.branch;
            if (!branch) throw new TaskError('Which branch should do this pickup?');
            for (const [f, label] of [['customer_name', 'the customer name'], ['phone', 'the phone number'], ['address', 'the address']]) if (!str(a[f])) throw new TaskError(`Ask for ${label}.`);
            const day = /^\d{4}-\d{2}-\d{2}$/.test(String(a.pickup_date || '')) ? a.pickup_date : omanDay();
            if (day < omanDay()) throw new TaskError('The pickup day has passed.');
            const slot = ['morning', 'afternoon', 'evening'].includes(a.slot) ? a.slot : 'any';
            const payload = { action: 'create', branch, customer_name: str(a.customer_name, 120), phone: str(a.phone, 30), address: str(a.address, 300), city: str(a.city, 80) || undefined, pickup_date: day, slot, pieces: +a.pieces > 0 ? Math.round(+a.pieces) : undefined, notes: str(a.notes, 300) || undefined };
            return { kind, payload, title: `New pickup for ${payload.customer_name}`, lines: [`${payload.phone} · ${payload.address}${payload.city ? ', ' + payload.city : ''}`, `${day} · ${slot}${payload.pieces ? ` · ${payload.pieces} pieces` : ''} · branch ${branch}`, ...(payload.notes ? [`Notes: ${payload.notes}`] : [])] };
        }
        case 'pickup_assign': {
            if (!isManager) throw new TaskError('Only managers assign drivers.', 403);
            const p = await findPickup(a.pickup_no, session);
            if (['done', 'cancelled', 'failed', 'booked'].includes(p.status)) throw new TaskError(`Pickup ${p.pickup_no} is already ${p.status}.`);
            const d = await findEmployee(a.driver, session, `&is_driver=is.true${p.branch_code ? `&branch=eq.${enc(p.branch_code)}` : ''}`).catch(e => { throw new TaskError(`${e.message} (only drivers of branch ${p.branch_code} can be given this pickup)`); });
            return { kind, payload: { action: 'assign', id: p.id, driver_id: d.id }, title: `Give pickup ${p.pickup_no} to ${d.full_name}`, lines: [`${p.customer_name} · ${p.address || ''}`, `${p.pickup_date} · ${p.slot}${p.driver_name ? ` · now with ${p.driver_name}` : ''}`] };
        }
        case 'pickup_picked': {
            const p = await findPickup(a.pickup_no, session);
            if (!(isManager || p.driver_id === session.user.id)) throw new TaskError('Only the driver or a manager can mark it picked up.', 403);
            return { kind, payload: { action: 'picked', id: p.id, pieces: +a.pieces > 0 ? Math.round(+a.pieces) : undefined }, title: `Mark pickup ${p.pickup_no} picked up`, lines: [`${p.customer_name} · ${p.address || ''}`, ...(+a.pieces > 0 ? [`${Math.round(+a.pieces)} pieces`] : [])] };
        }
        case 'message': {
            const text = str(a.text, 2000);
            if (!text) throw new TaskError('What should the message say?');
            const to = await findEmployee(a.to, session);
            return { kind, payload: { user_id: to.id, text }, title: `Message to ${to.full_name}`, lines: [text, `Sent from you, in Messages.`] };
        }
        case 'leave_decide': {
            if (!isManager) throw new TaskError('Only managers decide leave.', 403);
            const decision = /^rej/i.test(String(a.decision || '')) ? 'rejected' : /^app/i.test(String(a.decision || '')) ? 'approved' : null;
            if (!decision) throw new TaskError('Approve or reject?');
            let rows = await get(`leave_requests?status=eq.pending${isAdmin ? '' : `&branch_code=eq.${enc(session.branch || '-')}`}&select=id,employee_id,leave_type,from_date,to_date,reason,branch_code&order=requested_at.asc&limit=50`);
            rows = rows.filter(r => isAdmin || r.employee_id !== session.user.id);
            const names = rows.length ? await get(`employees?id=in.(${[...new Set(rows.map(r => r.employee_id))].map(enc).join(',')})&select=id,full_name`) : [];
            const nm = (r) => names.find(e => e.id === r.employee_id)?.full_name || '—';
            const want = loose(a.employee || '');
            const hits = a.id ? rows.filter(r => String(r.id) === String(a.id)) : rows.filter(r => !want || loose(nm(r)).includes(want));
            if (!hits.length) throw new TaskError(rows.length ? `No pending leave request${a.employee ? ` from ${str(a.employee, 40)}` : ''}. Pending: ${rows.map(r => `${nm(r)} (#${r.id})`).join(', ')}.` : 'There are no pending leave requests.');
            if (hits.length > 1 && !a.all) throw new TaskError(`${hits.length} requests match: ${hits.map(r => `#${r.id} ${nm(r)} ${r.from_date}–${r.to_date}`).join('; ')}. Which one (or all)?`);
            const r = hits[0];
            if (hits.length > 1) {
                return { kind: 'leave_many', payload: { ids: hits.map(h => h.id), decision, note: str(a.note, 300) || undefined },
                    title: `${decision === 'approved' ? 'Approve' : 'Reject'} ${hits.length} leave requests`, lines: hits.map(h => `${nm(h)} · ${h.leave_type || 'leave'} · ${h.from_date} → ${h.to_date}`) };
            }
            return { kind, payload: { action: 'leave_decide', id: r.id, decision, note: str(a.note, 300) || undefined },
                title: `${decision === 'approved' ? 'Approve' : 'Reject'} ${nm(r)}'s leave`,
                lines: [`${r.leave_type || 'Leave'} · ${r.from_date} → ${r.to_date}${r.branch_code ? ` · ${r.branch_code}` : ''}`, ...(r.reason ? [`Reason: ${r.reason}`] : []), ...(a.note ? [`Your note: ${str(a.note, 300)}`] : [])] };
        }
        case 'report': {
            const r = REPORTS[a.kind];
            if (!r) throw new TaskError(`Reports I can send: ${Object.entries(REPORTS).map(([k, v]) => `${k} (${v.label})`).join(', ')}.`);
            if (r.managers && !isManager) throw new TaskError(`The ${r.label.toLowerCase()} report is for managers.`, 403);
            const slot = SLOTS[a.slot] ? a.slot : 'morning';
            const branch = isAdmin && str(a.branch) ? str(a.branch, 20).toUpperCase() : null;
            return { kind, payload: { kind: a.kind, slot, branch }, title: `${r.label} — ${SLOTS[slot]}`, lines: [`Sent to you here in our chat${branch ? `, branch ${branch}` : isAdmin ? ', whole company' : `, branch ${session.branch}`}.`] };
        }
        case 'report_stop': {
            const mine = await get(`ai_reports?employee_id=eq.${enc(session.user.id)}&active=is.true&select=id,kind,slot`);
            const r = mine.find(x => x.id === +a.id) || mine.find(x => x.kind === a.kind && (!a.slot || x.slot === a.slot));
            if (!r) throw new TaskError('No such report is switched on.');
            return { kind, payload: { id: r.id }, title: `Stop the ${REPORTS[r.kind]?.label.toLowerCase() || r.kind} report (${r.slot})`, lines: [] };
        }
        default: throw new TaskError('Unknown job.');
    }
}

// ---------------------------------------------------------------- 2. do a confirmed job
/** runs a job the user confirmed; returns { ok, message } */
export async function runProposal(p, session, auth) {
    const kind = p?.kind, payload = p?.payload || {};
    const fail = (r) => { throw new TaskError(r.body?.error || `Could not do it (${r.status}).`, r.status >= 400 && r.status < 500 && r.status !== 401 ? r.status : 400); };
    if (kind === 'status') {
        const r = await callRoute('status', statusRoute, { method: 'POST', body: payload }, auth);
        if (r.status >= 400) fail(r);
        return { ok: true, message: `Done — ${payload.awbs.length} shipment${payload.awbs.length > 1 ? 's' : ''} updated.` };
    }
    if (['pickup_create', 'pickup_assign', 'pickup_picked'].includes(kind)) {
        const r = await callRoute('pickups', pickupsRoute, { method: 'POST', body: payload }, auth);
        if (r.status >= 400) fail(r);
        const no = r.body?.pickup?.pickup_no;
        return { ok: true, message: kind === 'pickup_create' ? `Done — pickup ${no || ''} created.` : kind === 'pickup_assign' ? 'Done — the driver has it.' : 'Done — marked picked up.' };
    }
    if (kind === 'message') {
        const t = await callRoute('chat', chatRoute, { method: 'POST', body: { action: 'direct', user_id: payload.user_id } }, auth);
        if (t.status >= 400) fail(t);
        const s = await callRoute('chat', chatRoute, { method: 'POST', body: { action: 'send', thread: t.body?.thread?.id, body: str(payload.text, 2000) } }, auth);
        if (s.status >= 400) fail(s);
        return { ok: true, message: 'Sent.', thread: t.body?.thread?.id };
    }
    if (kind === 'leave_decide' || kind === 'leave_many') {
        const ids = kind === 'leave_many' ? (Array.isArray(payload.ids) ? payload.ids.slice(0, 50) : []) : [payload.id];
        const errors = [];
        for (const id of ids) {
            const r = await callRoute('attendance', attendanceRoute, { method: 'POST', body: { action: 'leave_decide', id, decision: payload.decision, note: payload.note } }, auth);
            if (r.status >= 400) { if (ids.length === 1) fail(r); errors.push(`#${id}: ${r.body?.error || r.status}`); }
        }
        const done = ids.length - errors.length;
        return { ok: !errors.length, message: `Done — ${done} leave request${done === 1 ? '' : 's'} ${payload.decision}.${errors.length ? ` Not done: ${errors.join('; ')}` : ''}` };
    }
    if (kind === 'report') {
        const again = await propose('report', payload, session);     // permissions may have changed since
        const row = { employee_id: session.user.id, kind: again.payload.kind, slot: again.payload.slot, branch_code: again.payload.branch, active: true };
        const w = await fetch(`${rest()}/ai_reports?on_conflict=employee_id,kind,slot`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
        if (!w.ok) throw new TaskError('Could not save the report.', 500);
        return { ok: true, message: `Done — you will get it ${SLOTS[row.slot]} right here in our chat.` };
    }
    if (kind === 'report_stop') {
        await fetch(`${rest()}/ai_reports?id=eq.${+payload.id}&employee_id=eq.${enc(session.user.id)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ active: false }) });
        return { ok: true, message: 'Stopped.' };
    }
    throw new TaskError('Unknown job.');
}

/** the user's switched-on reports, for the AI */
export async function myReports(session) {
    const rows = await get(`ai_reports?employee_id=eq.${enc(session.user.id)}&active=is.true&select=id,kind,slot,branch_code,last_sent_on&order=id`);
    return rows.map(r => ({ id: r.id, report: REPORTS[r.kind]?.label || r.kind, kind: r.kind, when: SLOTS[r.slot], branch: r.branch_code, last_sent: r.last_sent_on }));
}

// ---------------------------------------------------------------- 3. scheduled reports
/** the user's Farah chat (made on first use — see api/_lib/farah.js) */
async function assistantThread(employeeId) {
    const key = `ai:${employeeId}`;
    let t = (await get(`chat_threads?direct_key=eq.${enc(key)}&select=id`))[0];
    if (!t) {
        const r = await fetch(`${rest()}/chat_threads?on_conflict=direct_key`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ kind: 'assistant', direct_key: key, title: 'Farah' }) });
        t = (r.ok ? await r.json() : [])[0];
        if (!t) throw new Error(`assistant chat for ${employeeId}: ${r.status}`);
        await fetch(`${rest()}/chat_members?on_conflict=thread_id,employee_id`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ thread_id: t.id, employee_id: employeeId, last_read_at: '2000-01-01T00:00:00Z' }) });   // nothing read yet: the first report counts as new
    }
    return t.id;
}

/** posts a message from Farah to one user */
export async function postFromAssistant(employeeId, body) {
    const thread = await assistantThread(employeeId);
    const r = await fetch(`${rest()}/chat_messages`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ thread_id: thread, sender_id: null, sender_name: 'Farah', body: String(body).slice(0, 4000) }) });
    if (!r.ok) throw new Error(`assistant message: ${r.status}`);
}

const summaryOf = async (day, branch) => {
    const r = await fetch(`${rest()}/rpc/daily_summary`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_day: day, p_branch: branch }) });
    if (!r.ok) throw new Error(`daily_summary ${branch}: ${r.status}`);
    return r.json();
};

/** the text of one report for one person */
export async function reportText(kind, slot, scope) {
    const day = slot === 'morning' ? omanDay(-1) : omanDay();
    const where = scope.branch ? `branch ${scope.branch}` : 'the whole company';
    if (kind === 'daily_summary') {
        let s;
        if (scope.branch) s = await summaryOf(day, scope.branch);
        else {
            const branches = await get('branches?branch_type=eq.branch&status=neq.Dismissed&select=branch_code');
            s = totalOf(await Promise.all(branches.map(b => summaryOf(day, b.branch_code))), day);
        }
        const w = s.waiting || {};
        return [
            `📊 Daily summary — ${day}, ${where}`,
            `Bookings: ${s.bookings || 0} (${s.kg || 0} kg)`,
            `Invoiced: ${money(s.invoiced)} · Received: ${money(s.received)} · Expenses: ${money(s.expenses)}`,
            `Delivered: ${s.delivered || 0}${s.delivery_failed ? ` · failed: ${s.delivery_failed}` : ''} · Pickups: ${s.pickups_done || 0}/${s.pickups || 0}`,
            `Exceptions: ${s.exceptions || 0} · Unpaid invoices: ${s.unpaid_count || 0} (${money(s.unpaid)})`,
            scope.branch ? (s.cash_closed ? 'Cash closed ✓' : 'Cash NOT closed') : (s.cash_not_closed?.length ? `Cash not closed: ${s.cash_not_closed.join(', ')}` : 'Cash closed everywhere ✓'),
            (w.cargo_in || w.cash_in || w.payment_requests || w.materials_in) ? `Waiting: ${[w.cargo_in && `${w.cargo_in} cargo in`, w.cash_in && `${w.cash_in} cash in`, w.payment_requests && `${w.payment_requests} payment requests`, w.materials_in && `${w.materials_in} materials`].filter(Boolean).join(', ')}` : null,
            `Open: summary.html?date=${day}`
        ].filter(Boolean).join('\n');
    }
    if (kind === 'exceptions') {
        const codes = (await get('statuses?is_exception=is.true&select=code')).map(s => s.code);
        const rows = codes.length ? await get(`bookings?archived=is.false&current_status_code=in.(${codes.map(enc).join(',')})${scope.branch ? `&branch_code=eq.${enc(scope.branch)}` : ''}&select=awb,consignee,dest_country,current_status,branch_code&order=booked_at.desc&limit=30`) : [];
        if (!rows.length) return `✅ Shipments with problems — ${where}: none right now.`;
        return [`⚠️ Shipments with problems — ${where}: ${rows.length}${rows.length === 30 ? '+' : ''}`, ...rows.map(r => `${r.awb} · ${r.current_status} · ${r.consignee || ''}${r.dest_country ? `, ${r.dest_country}` : ''}${scope.branch ? '' : ` · ${r.branch_code}`}`)].join('\n');
    }
    if (kind === 'unpaid') {
        const rows = await get(`invoices?status=in.(unpaid,partial)${scope.branch ? `&branch_code=eq.${enc(scope.branch)}` : ''}&select=currency,balance,due_date`);
        const total = {}, overdue = {};
        let late = 0;
        for (const r of rows) { total[r.currency] = (total[r.currency] || 0) + +r.balance; if (r.due_date && r.due_date < omanDay()) { overdue[r.currency] = (overdue[r.currency] || 0) + +r.balance; late++; } }
        return `💰 Unpaid invoices — ${where}: ${rows.length} (${money(total)})${late ? `\nOverdue: ${late} (${money(overdue)})` : ''}\nOpen: accounts.html`;
    }
    throw new Error(`unknown report ${kind}`);
}

/** sends every switched-on report of this slot ('morning' | 'evening'); safe to run twice the same day */
export async function runReports(slot) {
    const today = omanDay();
    const rows = await get(`ai_reports?slot=eq.${slot}&active=is.true&or=(last_sent_on.is.null,last_sent_on.lt.${today})&select=id,employee_id,kind,branch_code,employees!inner(role,branch,active)&limit=500`);
    let sent = 0, failed = 0;
    for (const r of rows) {
        const e = r.employees;
        if (e.active === false) continue;
        const isAdmin = ADMIN_ROLES.includes(e.role);
        if (REPORTS[r.kind]?.managers && !MANAGERS.includes(e.role)) continue;           // no longer a manager
        const scope = { branch: isAdmin ? r.branch_code : e.branch };
        if (!isAdmin && !scope.branch) continue;
        try {
            await postFromAssistant(r.employee_id, await reportText(r.kind, slot, scope));
            await fetch(`${rest()}/ai_reports?id=eq.${r.id}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ last_sent_on: today }) });
            sent++;
        } catch (err) { failed++; console.error(`[ai-reports] ${r.id}: ${err.message}`); }
    }
    return { slot, sent, failed };
}

/** what is waiting for this user: requests and cash for their locations (the bell), leave to decide, to-dos due.
 *  `link` = the ERP page for it (/app/…). PIN pages are marked: Farah cannot act there, the user opens them. */
export async function whatsWaiting(session, auth) {
    const isManager = MANAGERS.includes(session.role);
    const [bell, leave, todos] = await Promise.all([
        callRoute('notifications', notificationsRoute, { method: 'GET' }, auth).then(r => r.status < 400 ? r.body?.items || [] : []).catch(() => []),
        isManager ? callRoute('attendance', attendanceRoute, { method: 'GET', query: { view: 'leave', status: 'pending' } }, auth).then(r => r.status < 400 ? r.body?.rows || [] : []).catch(() => []) : [],
        todoRows(session.user.id).catch(() => [])
    ]);
    const appLink = (href) => href ? '/app/' + String(href).replace(/\.html/, '') : null;
    const items = bell.filter(i => ['request', 'cash', 'inbound', 'exception'].includes(i.kind)).slice(0, 15).map(i => ({
        kind: i.kind, title: i.title, detail: i.body, at: i.at, link: appLink(i.href),
        needs_pin: /^(main-office|warehouse)\.html/.test(String(i.href || ''))
    }));
    return {
        items,
        leave: leave.filter(l => l.employee_id !== session.user.id || ADMIN_ROLES.includes(session.role)).slice(0, 15)
            .map(l => ({ id: l.id, employee: l.full_name, type: l.leave_type, from: l.from_date, to: l.to_date, reason: l.reason || null })),
        todos: todos.filter(t => !t.done_at).slice(0, 20).map(t => ({ id: t.id, title: t.title, due: t.due_date, overdue: Boolean(t.due_date && t.due_date < omanDay()), link: t.link ? appLink(t.link) : null }))
    };
}

/** profit and money for a period, through the Accounts API (same permissions as the Accounts page) */
export async function profitReport(a, auth) {
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
    const from = ok(a.from) ? a.from : omanDay().slice(0, 8) + '01', to = ok(a.to) ? a.to : omanDay();
    const r = await callRoute('accounts', accountsRoute, { method: 'GET', query: { view: 'overview', from, to, ...(a.branch ? { branch: str(a.branch, 20).toUpperCase() } : {}) } }, auth);
    if (r.status >= 400) return { error: r.body?.error || 'Not allowed.' };
    return { from, to, branch: r.body.branch || 'all branches', note: 'profit = income − costs booked in the accounts for the period', currencies: r.body.currencies };
}
