// File: api/_lib/assistant.js — "Ask the ERP": an AI answers questions from live data.
// Provider: the active AI integration (Admin → Integrations → Claude or OpenAI-compatible). No key → not ready.
// The AI can only READ, through the tools below, and every tool is limited to what the user may see
// (staff / managers: their branch; head office: everything). It never writes anything.
import { serviceHeaders, ADMIN_ROLES } from './auth.js';
import { callApi } from './integrations/http.js';
import { propose, myReports, profitReport, callRoute, REPORTS, whatsWaiting } from './ai-tasks.js';
import { todoRows, addTodo, setTodo } from '../_routes/todos.js';
import accountsRoute from '../_routes/accounts.js';
import customersRoute from '../_routes/customers.js';
import transfersRoute from '../_routes/transfers.js';
import consolidationRoute from '../_routes/consolidation.js';
import attendanceRoute from '../_routes/attendance.js';
import deliveryRoute from '../_routes/delivery.js';
import pickupsRoute from '../_routes/pickups.js';
import bookingsRoute from '../_routes/bookings.js';
import usersRoute from '../_routes/users.js';
import summaryRoute from '../_routes/summary.js';

const AI = ['claude', 'openai_compat'];
const MAX_ROUNDS = 6;
const MAX_RESULT = 12000;                 // characters of one tool result sent back to the AI
const enc = encodeURIComponent;
const omanDay = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);

/** the active AI integration row, or null */
export async function aiProvider() {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/integrations?kind=eq.ai&active=is.true&adapter=in.(${AI.join(',')})&select=id,name,adapter,base_url,config,secret&order=updated_at.desc.nullslast&limit=1`, { headers: serviceHeaders() });
    const row = (r.ok ? await r.json() : [])[0];
    const key = row?.secret?.api_key || (row?.adapter === 'claude' ? process.env.ANTHROPIC_API_KEY : row ? process.env.OPENAI_API_KEY : null);
    return row && key ? row : null;
}

export const TOOLS = [
    { name: 'find_shipments', description: 'List shipments (newest first). Filters are optional. Dates are YYYY-MM-DD (Oman time).',
      schema: { type: 'object', properties: { text: { type: 'string', description: 'AWB, sender, receiver or phone to search' }, status: { type: 'string', description: 'status code, e.g. IMPORT_CUSTOMS, DELIVERED' },
          dest_country: { type: 'string' }, branch: { type: 'string', description: 'branch code (head office only)' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer', description: 'how many to list, at most 50' } } } },
    { name: 'count_shipments', description: 'Count shipments grouped by status, destination country or branch, with the same optional filters.',
      schema: { type: 'object', properties: { group_by: { type: 'string', enum: ['status', 'dest_country', 'branch'] }, status: { type: 'string' }, dest_country: { type: 'string' }, branch: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['group_by'] } },
    { name: 'shipment_details', description: 'One shipment with its last tracking events.', schema: { type: 'object', properties: { awb: { type: 'string' } }, required: ['awb'] } },
    { name: 'daily_summary', description: 'A branch day: bookings, money received/invoiced, expenses, deliveries, pickups, exceptions, waiting items, unpaid. Managers and head office only.',
      schema: { type: 'object', properties: { date: { type: 'string' }, branch: { type: 'string' } } } },
    { name: 'customer_lookup', description: 'Find customers by name, phone or customer number, with shipment count.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'erp_read', description: 'Read any ERP page the user may open, exactly as that page shows it (head office: every branch; others: their own branch). '
        + 'pages and views: accounts (view = overview | invoices | payments | expenses | balances | cash (params.date) | ledger | inventory (packing-material stock per branch / warehouse) | materials | purchases | profit (profit per shipment) | requests | internal | rates | parties | costs; params from, to, branch, status, q); '
        + 'customers (params q to search, or id for a full profile); transfers (manifests between branches, cargo on hand; params branch, id); consolidation (no params = the list; params id or mawb = one with its shipments, costs and branch shares); '
        + 'attendance (view = me | day | report | leave | shifts; params date, from, to, branch, month); delivery (delivery board; params awb); pickups (params date, branch); '
        + 'bookings (params q, status, branch, limit, awb); users (staff list); summary (daily summary; params date, branch). '
        + 'The Main Office (cash, approvals) and Warehouse operator pages need their PIN, so they cannot be read here; send the user to those pages.',
      schema: { type: 'object', properties: { page: { type: 'string', enum: ['accounts', 'customers', 'transfers', 'consolidation', 'attendance', 'delivery', 'pickups', 'bookings', 'users', 'summary'] }, view: { type: 'string' },
          params: { type: 'object', description: 'other query values as text, e.g. { "from": "2026-11-01", "to": "2026-11-30" }', additionalProperties: { type: 'string' } } }, required: ['page'] } },
    { name: 'profit_report', description: 'Money for a period: invoiced, collected, expenses, receivable, income, costs and PROFIT per currency (use it for "profit this month", "income last month"). Dates YYYY-MM-DD; default this month. Managers: their branch; head office: all or one branch.',
      schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch: { type: 'string' } } } },
    { name: 'my_reports', description: 'The scheduled reports this user has switched on.', schema: { type: 'object', properties: {} } },
    { name: 'whats_waiting', description: 'What is waiting for this user now: requests / cash / incoming cargo for their locations, shipment problems, leave requests to decide (managers), their open to-dos. Use it when they greet you, ask "anything for me?", or before suggesting what to do next.',
      schema: { type: 'object', properties: {} } },
    { name: 'my_todos', description: 'The user\'s own to-do list (open, and done in the last 7 days).', schema: { type: 'object', properties: {} } },
    { name: 'add_todo', description: 'Add a to-do to the user\'s OWN list (done at once — it is their personal list). Use it when they ask you to remember / remind / note something, or to break a job into steps. link = an ERP page it is about, e.g. "shipments.html?awb=311000045".',
      schema: { type: 'object', properties: { title: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' }, link: { type: 'string' } }, required: ['title'] } },
    { name: 'complete_todo', description: 'Tick off (or reopen with undo=true) one of the user\'s to-dos by id.', schema: { type: 'object', properties: { id: { type: 'integer' }, undo: { type: 'boolean' } }, required: ['id'] } },
    { name: 'propose_leave_decision', description: 'Prepare approving or rejecting a pending leave request (managers). Give the employee name or the request id; all=true for every match.',
      schema: { type: 'object', properties: { employee: { type: 'string' }, id: { type: 'integer' }, decision: { type: 'string', enum: ['approved', 'rejected'] }, note: { type: 'string' }, all: { type: 'boolean' } }, required: ['decision'] } },
    // ---- jobs: these only PREPARE the change; the user confirms it on a card ----
    { name: 'propose_status_update', description: 'Prepare a status change for one or more shipments (e.g. Out for Delivery, Delivered, Received at Branch). Some statuses need extra details: driver (Pickup Assigned), to_branch (In Transit to Hub), mawb (Consolidated), remark (holds, failed delivery, returns, cancelled).',
      schema: { type: 'object', properties: { awbs: { type: 'array', items: { type: 'string' } }, status: { type: 'string', description: 'status name or code' }, location: { type: 'string' }, remark: { type: 'string' }, driver: { type: 'string' }, to_branch: { type: 'string' }, mawb: { type: 'string' } }, required: ['awbs', 'status'] } },
    { name: 'propose_pickup', description: 'Prepare a new pickup request (collect cargo at a customer door).',
      schema: { type: 'object', properties: { customer_name: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, pickup_date: { type: 'string', description: 'YYYY-MM-DD, default today' }, slot: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'] }, pieces: { type: 'integer' }, notes: { type: 'string' }, branch: { type: 'string', description: 'head office only' } }, required: ['customer_name', 'phone', 'address'] } },
    { name: 'propose_pickup_assign', description: 'Prepare giving a pickup to a driver (managers).', schema: { type: 'object', properties: { pickup_no: { type: 'string' }, driver: { type: 'string', description: 'driver name' } }, required: ['pickup_no', 'driver'] } },
    { name: 'propose_pickup_done', description: 'Prepare marking a pickup as picked up.', schema: { type: 'object', properties: { pickup_no: { type: 'string' }, pieces: { type: 'integer' } }, required: ['pickup_no'] } },
    { name: 'propose_message', description: 'Prepare a chat message from this user to a colleague (sent in Messages).', schema: { type: 'object', properties: { to: { type: 'string', description: 'colleague name' }, text: { type: 'string' } }, required: ['to', 'text'] } },
    { name: 'propose_report', description: `Prepare a recurring report sent to the user's "AI Assistant" chat: report = ${Object.keys(REPORTS).join(' | ')}; slot = morning (about 6 am, yesterday) | evening (about 8 pm, today).`,
      schema: { type: 'object', properties: { report: { type: 'string', enum: Object.keys(REPORTS) }, slot: { type: 'string', enum: ['morning', 'evening'] }, branch: { type: 'string', description: 'head office only; empty = whole company' } }, required: ['report'] } },
    { name: 'propose_report_stop', description: 'Prepare switching off one of the scheduled reports of this user.', schema: { type: 'object', properties: { report: { type: 'string' }, slot: { type: 'string' } }, required: ['report'] } }
];

const READ_PAGES = { accounts: accountsRoute, customers: customersRoute, transfers: transfersRoute, consolidation: consolidationRoute, attendance: attendanceRoute, delivery: deliveryRoute, pickups: pickupsRoute, bookings: bookingsRoute, users: usersRoute, summary: summaryRoute };
const PROPOSALS = { propose_status_update: ['status', a => a], propose_pickup: ['pickup_create', a => a], propose_pickup_assign: ['pickup_assign', a => a], propose_pickup_done: ['pickup_picked', a => a],
    propose_message: ['message', a => a], propose_leave_decision: ['leave_decide', a => a], propose_report: ['report', a => ({ kind: a.report, slot: a.slot, branch: a.branch })], propose_report_stop: ['report_stop', a => ({ kind: a.report, slot: a.slot })] };

/** long lists are cut so one answer fits the AI's limits */
function shrink(v, depth = 0) {
    if (Array.isArray(v)) { const out = v.slice(0, 40).map(x => shrink(x, depth + 1)); if (v.length > 40) out.push(`…${v.length - 40} more not shown — narrow the question`); return out; }
    if (v && typeof v === 'object' && depth < 6) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== '').map(([k, x]) => [k, shrink(x, depth + 1)]));
    return v;
}

/** runs one tool for this user; returns plain JSON for the AI */
export async function runTool(name, args = {}, session, ctx = {}) {
    args = args || {};
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const branch = isAdmin ? (args.branch ? String(args.branch).toUpperCase().replace(/[^A-Z0-9]/g, '') : null) : session.branch;
    if (!isAdmin && !branch) return { error: 'This user has no branch.' };
    const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
    const filters = () => {
        const f = ['archived=is.false'];
        if (branch) f.push(`branch_code=eq.${enc(branch)}`);
        if (args.status) f.push(`current_status_code=eq.${enc(String(args.status).toUpperCase())}`);
        if (args.dest_country) f.push(`dest_country=ilike.${enc('*' + String(args.dest_country).replace(/[*,()]/g, '') + '*')}`);
        if (date(args.from)) f.push(`booked_at=gte.${args.from}T00:00:00%2B04:00`);
        if (date(args.to)) f.push(`booked_at=lt.${args.to}T23:59:59%2B04:00`);
        return f.join('&');
    };
    switch (name) {
        case 'find_shipments': {
            let f = filters();
            const t = String(args.text || '').replace(/[*,()]/g, '').trim();
            if (t) f += `&or=(awb.ilike.*${enc(t)}*,shipper.ilike.*${enc(t)}*,consignee.ilike.*${enc(t)}*,shipper_phone.ilike.*${enc(t)}*)`;
            const rows = await get(`bookings?${f}&select=awb,booked_at,branch_code,shipper,consignee,dest_city,dest_country,pieces,weight,current_status&order=booked_at.desc&limit=${Math.min(50, +args.limit || 20)}`);
            return { count: rows.length, shipments: rows };
        }
        case 'count_shipments': {
            const col = { status: 'current_status', dest_country: 'dest_country', branch: 'branch_code' }[args.group_by] || 'current_status';
            const rows = await get(`bookings?${filters()}&select=${col}&limit=5000`);
            const counts = {};
            for (const r of rows) { const k = r[col] || '(none)'; counts[k] = (counts[k] || 0) + 1; }
            return { total: rows.length, by: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])), capped: rows.length >= 5000 };
        }
        case 'shipment_details': {
            const awb = String(args.awb || '').replace(/[‐-―−]/g, '-').toUpperCase().replace(/[^A-Z0-9-]/g, '');
            const b = (await get(`bookings?awb=eq.${enc(awb)}${branch && !isAdmin ? `&branch_code=eq.${enc(branch)}` : ''}&select=id,awb,booked_at,branch_code,shipper,consignee,dest_city,dest_country,pieces,weight,chargeable_weight,current_status,fwd_agent,carrier`))[0];
            if (!b) return { error: `Shipment ${awb} not found${!isAdmin ? ' in your branch' : ''}.` };
            const events = await get(`tracking_events?booking_id=eq.${b.id}&select=status,location,remark,event_at&order=event_at.desc&limit=10`);
            const { id, ...shipment } = b;
            return { shipment, events };
        }
        case 'daily_summary': {
            if (!isAdmin && session.role !== 'branch_manager') return { error: 'The daily summary is for managers.' };
            const r = await fetch(`${rest}/rpc/daily_summary`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_day: date(args.date) || omanDay(), p_branch: branch || session.branch || 'ALFSLL' }) });
            return r.ok ? r.json() : { error: 'No summary.' };
        }
        case 'customer_lookup': {
            const t = String(args.query || '').replace(/[*,()]/g, '').trim();
            if (t.length < 2) return { error: 'Give at least 2 letters or digits.' };
            const rows = await get(`customers?merged_into=is.null&or=(name.ilike.*${enc(t)}*,phone.ilike.*${enc(t)}*,customer_no.ilike.*${enc(t)}*)&select=customer_no,name,phone,branch_code,last_booking_at,customer_stats(shipments,kg)&limit=10`);
            return { customers: rows.map(c => ({ ...c, customer_stats: undefined, shipments: (Array.isArray(c.customer_stats) ? c.customer_stats[0] : c.customer_stats)?.shipments || 0 })) };
        }
        case 'erp_read': {
            const handler = READ_PAGES[args.page];
            if (!handler) return { error: `Unknown page ${args.page}.` };
            const query = Object.fromEntries(Object.entries(args.params && typeof args.params === 'object' ? args.params : {}).filter(([k, v]) => v != null && v !== '' && k !== 'format').map(([k, v]) => [k, String(v).replace(/[\u2010-\u2015\u2212]/g, '-').slice(0, 100)]));
            if (args.view) query.view = String(args.view);
            const r = await callRoute(args.page, handler, { method: 'GET', query }, ctx.auth);
            return r.status >= 400 ? { error: r.body?.error || `Not allowed (${r.status}).` } : shrink(r.body);
        }
        case 'profit_report': return profitReport(args, ctx.auth);
        case 'my_reports': return { reports: await myReports(session) };
        case 'whats_waiting': return whatsWaiting(session, ctx.auth);
        case 'my_todos': return { todos: await todoRows(session.user.id) };
        case 'add_todo': try { return { added: await addTodo(session.user.id, args, 'farah') }; } catch (e) { return { error: e.message }; }
        case 'complete_todo': try { return { todo: await setTodo(session.user.id, args.id, { done_at: args.undo ? null : new Date().toISOString() }) }; } catch (e) { return { error: e.message }; }
        default: {
            const job = PROPOSALS[name];
            if (!job) return { error: `Unknown tool ${name}.` };
            try {
                const p = await propose(job[0], job[1](args), session);
                const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                (ctx.proposals ||= []).push({ id, ...p });
                return { prepared: p.title, details: p.lines, note: 'NOT done yet: the user sees this with a Confirm button. Tell them to check it and tap Confirm.' };
            } catch (e) { return { error: e.message }; }
        }
    }
}

const system = (session, opts = {}) => {
    const first = String(session.employee?.full_name || '').trim().split(/\s+/)[0] || '';
    return [
        'You are Farah, the AI colleague inside Al-Farha Cargo ERP (a cargo / courier company in Oman), chatting in the team messenger.',
        `Talk like a friendly, helpful colleague: warm, natural, short chat messages; call the user ${first || 'by their first name'}; an emoji now and then is fine (not in every message). `
        + 'Reply in the language the user writes in (English, Arabic, Malayalam, Hindi…). No headings or tables: plain text, short lines, **bold** for key numbers.',
        opts.firstToday ? `This is ${first || 'the user'}'s first message to you today: start with a short, friendly greeting that fits the time of day in Oman.` : 'Do not greet again — you are already chatting today.',
        'Use the tools to read live data; never invent numbers, shipment numbers or names. If the tools cannot answer, say so honestly.',
        `Today is ${omanDay()} (Oman). The user is ${session.employee?.full_name || 'a staff member'}, role ${session.role}${session.branch ? `, branch ${session.branch}` : ', head office (all branches)'}.`,
        'Amounts: OMR has 3 decimals. Keep answers under 150 words unless a list is asked for. Write references (AWB, MAWB, invoice numbers) exactly as the data has them, with plain "-".',
        'Money for a period (month profit, income, expenses): profit_report. Packing-material stock: erp_read page accounts, view inventory. '
        + 'A consolidation by its MAWB: erp_read page consolidation, params mawb. Other pages: erp_read.',
        'Be a real personal assistant: notice what is pending (whats_waiting), mention it briefly and ask what they would like — e.g. "There is a leave request from Ali — want to look at it, or shall I approve it?". '
        + 'Ask a short question whenever something is unclear instead of guessing; after answering, offer the useful next step. One or two questions at a time, not a list of options. '
        + 'Help with their to-do list: add things they want to remember, break a bigger job into steps, and help finish each one (look things up, prepare the change). '
        + 'Payment requests, cash confirmations and warehouse requests need the user\'s own PIN: you cannot approve those — give the link (e.g. /app/main-office?tab=approvals) and offer to explain what is waiting. '
        + 'When you point to a page, write its link as /app/<page>?… so it can be tapped.',
        'You can also do jobs: status updates, pickups, chat messages, leave decisions, scheduled reports, only through the propose_* tools. They do NOT change anything: '
        + 'the user gets a card with a Confirm button under your message. Never say a job is done; say what you prepared and ask them to tap Confirm. '
        + 'If details are missing (which shipments, which status, a reason), ask first. Only do what the user asked.'
    ].join('\n');
};

// OpenAI-style tools. Optional fields also allow null: some models (gpt-oss on Groq) send null for
// "not given", and Groq rejects the call when the schema does not allow it. The tools treat null as not given.
const OPENAI_TOOLS = TOOLS.map(t => {
    const req = new Set(t.schema.required || []);
    const properties = Object.fromEntries(Object.entries(t.schema.properties || {}).map(([k, p]) =>
        [k, req.has(k) ? p : { ...p, type: [p.type, 'null'], ...(p.enum ? { enum: [...p.enum, null] } : {}) }]));
    return { type: 'function', function: { name: t.name, description: t.description, parameters: { ...t.schema, properties } } };
});

/** one question (with a short history) → { answer, tools } */
export async function ask(question, history, session, auth, opts = {}) {
    const ctx = { auth, proposals: [] };
    const row = await aiProvider();
    if (!row) throw Object.assign(new Error('The AI assistant is not switched on yet — add an AI provider (Claude or OpenAI-compatible) with its key in Admin → Integrations.'), { status: 503, setup: true });
    const used = [];
    const past = (Array.isArray(history) ? history : []).slice(-14).filter(m => ['user', 'assistant'].includes(m.role) && m.content).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    if (row.adapter === 'claude') {
        const messages = [...past, { role: 'user', content: question }];
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const d = await callApi('claude', 'messages', { system: system(session, opts), messages, tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema })) }, row);
            const calls = (d.content || []).filter(c => c.type === 'tool_use');
            if (!calls.length) return { answer: (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), tools: used, actions: ctx.proposals };
            messages.push({ role: 'assistant', content: d.content });
            const results = [];
            for (const c of calls) { used.push(c.name); results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(await runTool(c.name, c.input, session, ctx)).slice(0, MAX_RESULT) }); }
            messages.push({ role: 'user', content: results });
        }
    } else {
        const messages = [{ role: 'system', content: system(session, opts) }, ...past, { role: 'user', content: question }];
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const d = await callApi('openai_compat', 'chat', { messages, tools: OPENAI_TOOLS }, row);
            const msg = d?.choices?.[0]?.message || {};
            if (!msg.tool_calls?.length) return { answer: String(msg.content || '').trim(), tools: used, actions: ctx.proposals };
            messages.push(msg);
            for (const c of msg.tool_calls) {
                used.push(c.function?.name);
                let args = {}; try { args = JSON.parse(c.function?.arguments || '{}') || {}; } catch { /* empty */ }
                messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(await runTool(c.function?.name, args, session, ctx)).slice(0, MAX_RESULT) });
            }
        }
    }
    return { answer: 'That needed too many steps — try a narrower question.', tools: used, actions: ctx.proposals };
}
