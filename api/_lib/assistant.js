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
const MAX_RESULT = 8000;                  // characters of one tool result sent back to the AI (it is resent on every later step)
const enc = encodeURIComponent;
const omanDay = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);

/** the active AI integration row, or null */
export async function aiProvider() {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/integrations?kind=eq.ai&active=is.true&adapter=in.(${AI.join(',')})&select=id,name,adapter,base_url,config,secret&order=updated_at.desc.nullslast&limit=1`, { headers: serviceHeaders() });
    const row = (r.ok ? await r.json() : [])[0];
    const key = row?.secret?.api_key || (row?.adapter === 'claude' ? process.env.ANTHROPIC_API_KEY : row ? process.env.OPENAI_API_KEY : null);
    return row && key ? row : null;
}

// Each step sends this list to the AI, so it is kept short. `jobs` tools are sent only when the message asks to DO
// something (see wantsJobs) or after Farah calls more_tools — that roughly halves what a plain question costs.
export const TOOLS = [
    { name: 'find_shipments', description: 'List shipments, newest first. Dates YYYY-MM-DD.',
      schema: { type: 'object', properties: { text: { type: 'string', description: 'AWB, name or phone' }, status: { type: 'string', description: 'code, e.g. IMPORT_CUSTOMS' },
          dest_country: { type: 'string' }, branch: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer' } } } },
    { name: 'count_shipments', description: 'Count shipments by status, country or branch (same filters).',
      schema: { type: 'object', properties: { group_by: { type: 'string', enum: ['status', 'dest_country', 'branch'] }, status: { type: 'string' }, dest_country: { type: 'string' }, branch: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['group_by'] } },
    { name: 'shipment_details', description: 'One shipment and its tracking.', schema: { type: 'object', properties: { awb: { type: 'string' } }, required: ['awb'] } },
    { name: 'daily_summary', description: 'A branch day: bookings, money, expenses, deliveries, pickups, waiting (managers).', schema: { type: 'object', properties: { date: { type: 'string' }, branch: { type: 'string' } } } },
    { name: 'customer_lookup', description: 'Find customers by name, phone or number.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'erp_read', description: 'Read an ERP page as this user. accounts: view overview|invoices|payments|expenses|balances|cash|ledger|inventory (packing stock)|purchases|profit|requests|rates|costs. '
        + 'customers (q / id), transfers, consolidation (list; id or mawb = one), attendance (view me|day|report|leave|shifts), delivery, pickups, bookings, users, summary. '
        + 'Params: from, to, branch, date, q… Main Office / Warehouse need a PIN: not here.',
      schema: { type: 'object', properties: { page: { type: 'string', enum: ['accounts', 'customers', 'transfers', 'consolidation', 'attendance', 'delivery', 'pickups', 'bookings', 'users', 'summary'] }, view: { type: 'string' },
          params: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['page'] } },
    { name: 'profit_report', description: 'Income, costs, profit, invoiced, collected for a period (default this month).', schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch: { type: 'string' } } } },
    { name: 'whats_waiting', description: 'What waits for this user: requests, cash, cargo, problems, leave to decide, to-dos.', schema: { type: 'object', properties: {} } },
    { name: 'more_tools', description: 'Call first when the user wants you to DO something (change status, pickup, message, leave, to-do, reports).', schema: { type: 'object', properties: {} } },
    // ---- jobs (propose_* only prepare a card; the user taps Confirm) ----
    { jobs: true, name: 'my_todos', description: 'The user\'s to-dos.', schema: { type: 'object', properties: {} } },
    { jobs: true, name: 'add_todo', description: 'Add to the user\'s own to-do list (done at once). link e.g. shipments.html?awb=…', schema: { type: 'object', properties: { title: { type: 'string' }, due_date: { type: 'string' }, notes: { type: 'string' }, link: { type: 'string' } }, required: ['title'] } },
    { jobs: true, name: 'complete_todo', description: 'Tick off a to-do (undo=true reopens).', schema: { type: 'object', properties: { id: { type: 'integer' }, undo: { type: 'boolean' } }, required: ['id'] } },
    { jobs: true, name: 'my_reports', description: 'The user\'s scheduled reports.', schema: { type: 'object', properties: {} } },
    { jobs: true, name: 'propose_status_update', description: 'Status change for shipments. Needs: driver (Pickup Assigned), to_branch (In Transit to Hub), mawb (Consolidated), remark (holds, failed, returns, cancel).',
      schema: { type: 'object', properties: { awbs: { type: 'array', items: { type: 'string' } }, status: { type: 'string' }, location: { type: 'string' }, remark: { type: 'string' }, driver: { type: 'string' }, to_branch: { type: 'string' }, mawb: { type: 'string' } }, required: ['awbs', 'status'] } },
    { jobs: true, name: 'propose_pickup', description: 'New pickup request.', schema: { type: 'object', properties: { customer_name: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, pickup_date: { type: 'string' }, slot: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'] }, pieces: { type: 'integer' }, notes: { type: 'string' }, branch: { type: 'string' } }, required: ['customer_name', 'phone', 'address'] } },
    { jobs: true, name: 'propose_pickup_assign', description: 'Give a pickup to a driver.', schema: { type: 'object', properties: { pickup_no: { type: 'string' }, driver: { type: 'string' } }, required: ['pickup_no', 'driver'] } },
    { jobs: true, name: 'propose_pickup_done', description: 'Mark a pickup picked up.', schema: { type: 'object', properties: { pickup_no: { type: 'string' }, pieces: { type: 'integer' } }, required: ['pickup_no'] } },
    { jobs: true, name: 'propose_message', description: 'Chat message to a colleague.', schema: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] } },
    { jobs: true, name: 'propose_leave_decision', description: 'Approve / reject pending leave (employee name or id; all=true for every match).', schema: { type: 'object', properties: { employee: { type: 'string' }, id: { type: 'integer' }, decision: { type: 'string', enum: ['approved', 'rejected'] }, note: { type: 'string' }, all: { type: 'boolean' } }, required: ['decision'] } },
    { jobs: true, name: 'propose_report', description: `Recurring report in this chat: ${Object.keys(REPORTS).join('|')}; morning ~6am (yesterday) | evening ~8pm.`, schema: { type: 'object', properties: { report: { type: 'string', enum: Object.keys(REPORTS) }, slot: { type: 'string', enum: ['morning', 'evening'] }, branch: { type: 'string' } }, required: ['report'] } },
    { jobs: true, name: 'propose_report_stop', description: 'Stop a scheduled report.', schema: { type: 'object', properties: { report: { type: 'string' }, slot: { type: 'string' } }, required: ['report'] } }
];

/** does this message ask Farah to DO something? (then the job tools go with the first step) */
export const wantsJobs = (text) => /\b(mark|update|change the|approve|reject|create|add|assign|send|message|tell|remind|note down|to-?do|task|tick|schedule|stop|cancel|arrange|put)\b|\bpick ?up\b(?! ?(list|board|requests?\b))/i.test(String(text || ''));

const READ_PAGES = { accounts: accountsRoute, customers: customersRoute, transfers: transfersRoute, consolidation: consolidationRoute, attendance: attendanceRoute, delivery: deliveryRoute, pickups: pickupsRoute, bookings: bookingsRoute, users: usersRoute, summary: summaryRoute };
const PROPOSALS = { propose_status_update: ['status', a => a], propose_pickup: ['pickup_create', a => a], propose_pickup_assign: ['pickup_assign', a => a], propose_pickup_done: ['pickup_picked', a => a],
    propose_message: ['message', a => a], propose_leave_decision: ['leave_decide', a => a], propose_report: ['report', a => ({ kind: a.report, slot: a.slot, branch: a.branch })], propose_report_stop: ['report_stop', a => ({ kind: a.report, slot: a.slot })] };

/** long lists are cut so one answer fits the AI's limits */
function shrink(v, depth = 0) {
    if (Array.isArray(v)) { const out = v.slice(0, 25).map(x => shrink(x, depth + 1)); if (v.length > 25) out.push(`…${v.length - 25} more not shown — narrow the question`); return out; }
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
        case 'more_tools': ctx.jobs = true; return { ok: 'Job tools are now available.' };
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
        `You are Farah, a friendly AI colleague in Al-Farha Cargo ERP (cargo company, Oman), chatting with ${session.employee?.full_name || 'a staff member'} (${session.role}${session.branch ? `, branch ${session.branch}` : ', head office'}). Today ${omanDay()}.`,
        `Short, warm chat messages; call them ${first || 'by first name'}; emoji now and then; reply in their language; no tables or headings; **bold** key numbers; OMR has 3 decimals; under 120 words unless a list is asked.`,
        opts.firstToday ? 'First message today: begin with a short greeting for the time of day.' : 'Do not greet again.',
        'Use tools for live data; never invent numbers or names. Write references exactly as in the data, with plain "-". Page links as /app/<page>?… (tappable).',
        'Be a personal assistant: mention pending things briefly and ask what they want ("Leave from Ali — look first, or shall I approve?"). Ask one short question when unclear; offer the next step. Help with their to-dos.',
        'Jobs only via propose_* tools (call more_tools first if you do not have them): they prepare a card the user Confirms — never say it is done. Ask for missing details first. Payment / cash / warehouse approvals need their PIN: give the link instead.'
    ].join('\n');
};

// OpenAI-style tools. Optional fields also allow null: some models (gpt-oss on Groq) send null for
// "not given", and Groq rejects the call when the schema does not allow it. The tools treat null as not given.
const toOpenAI = (t) => {
    const req = new Set(t.schema.required || []);
    const properties = Object.fromEntries(Object.entries(t.schema.properties || {}).map(([k, p]) =>
        [k, req.has(k) ? p : { ...p, type: [p.type, 'null'], ...(p.enum ? { enum: [...p.enum, null] } : {}) }]));
    return { type: 'function', function: { name: t.name, description: t.description, parameters: { ...t.schema, properties } } };
};
const OPENAI = { all: TOOLS.map(toOpenAI), read: TOOLS.filter(t => !t.jobs).map(toOpenAI) };
const CLAUDE = (list) => list.map(t => ({ name: t.name, description: t.description, input_schema: t.schema }));
const CLAUDE_TOOLS = { all: CLAUDE(TOOLS), read: CLAUDE(TOOLS.filter(t => !t.jobs)) };

/** one question (with a short history) → { answer, tools } */
export async function ask(question, history, session, auth, opts = {}) {
    const ctx = { auth, proposals: [], jobs: wantsJobs(question) };
    const row = await aiProvider();
    if (!row) throw Object.assign(new Error('The AI assistant is not switched on yet — add an AI provider (Claude or OpenAI-compatible) with its key in Admin → Integrations.'), { status: 503, setup: true });
    const used = [];
    const past = (Array.isArray(history) ? history : []).slice(-8).filter(m => ['user', 'assistant'].includes(m.role) && m.content).map(m => ({ role: m.role, content: String(m.content).slice(0, 700) }));
    if (row.adapter === 'claude') {
        const messages = [...past, { role: 'user', content: question }];
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const d = await callApi('claude', 'messages', { system: system(session, opts), messages, tools: ctx.jobs ? CLAUDE_TOOLS.all : CLAUDE_TOOLS.read }, row);
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
            const d = await callApi('openai_compat', 'chat', { messages, tools: ctx.jobs ? OPENAI.all : OPENAI.read }, row);
            const msg = d?.choices?.[0]?.message || {};
            if (!msg.tool_calls?.length) return { answer: String(msg.content || '').trim(), tools: used, actions: ctx.proposals };
            // send back only what the next step needs (not the model's own reasoning text — it only costs tokens)
            messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
            for (const c of msg.tool_calls) {
                used.push(c.function?.name);
                let args = {}; try { args = JSON.parse(c.function?.arguments || '{}') || {}; } catch { /* empty */ }
                messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(await runTool(c.function?.name, args, session, ctx)).slice(0, MAX_RESULT) });
            }
        }
    }
    return { answer: 'That needed too many steps — try a narrower question.', tools: used, actions: ctx.proposals };
}
