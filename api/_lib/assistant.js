// File: api/_lib/assistant.js — "Ask the ERP": an AI answers questions from live data.
// Provider: the active AI integration (Admin → Integrations → Claude or OpenAI-compatible). No key → not ready.
// The AI can only READ, through the tools below, and every tool is limited to what the user may see
// (staff / managers: their branch; head office: everything). It never writes anything.
import { serviceHeaders, ADMIN_ROLES } from './auth.js';
import { callApi } from './integrations/http.js';

const AI = ['claude', 'openai_compat'];
const MAX_ROUNDS = 5;
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
    { name: 'customer_lookup', description: 'Find customers by name, phone or customer number, with shipment count.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
];

/** runs one tool for this user; returns plain JSON for the AI */
export async function runTool(name, args = {}, session) {
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
            const awb = String(args.awb || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
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
        default: return { error: `Unknown tool ${name}.` };
    }
}

const system = (session) => [
    'You are the assistant inside Al-Farha Cargo ERP (a cargo / courier company in Oman). Answer in short, plain sentences.',
    'Use the tools to read live data; never invent numbers, shipment numbers or names. If the tools cannot answer, say so.',
    `Today is ${omanDay()} (Oman). The user is ${session.employee?.full_name || 'a staff member'}, role ${session.role}${session.branch ? `, branch ${session.branch}` : ', head office (all branches)'}.`,
    'Amounts: OMR has 3 decimals. Keep answers under 150 words unless a list is asked for.'
].join('\n');

// OpenAI-style tools. Optional fields also allow null: some models (gpt-oss on Groq) send null for
// "not given", and Groq rejects the call when the schema does not allow it. The tools treat null as not given.
const OPENAI_TOOLS = TOOLS.map(t => {
    const req = new Set(t.schema.required || []);
    const properties = Object.fromEntries(Object.entries(t.schema.properties || {}).map(([k, p]) =>
        [k, req.has(k) ? p : { ...p, type: [p.type, 'null'], ...(p.enum ? { enum: [...p.enum, null] } : {}) }]));
    return { type: 'function', function: { name: t.name, description: t.description, parameters: { ...t.schema, properties } } };
});

/** one question (with a short history) → { answer, tools } */
export async function ask(question, history, session) {
    const row = await aiProvider();
    if (!row) throw Object.assign(new Error('The AI assistant is not switched on yet — add an AI provider (Claude or OpenAI-compatible) with its key in Admin → Integrations.'), { status: 503, setup: true });
    const used = [];
    const past = (Array.isArray(history) ? history : []).slice(-8).filter(m => ['user', 'assistant'].includes(m.role) && m.content).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    if (row.adapter === 'claude') {
        const messages = [...past, { role: 'user', content: question }];
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const d = await callApi('claude', 'messages', { system: system(session), messages, tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema })) }, row);
            const calls = (d.content || []).filter(c => c.type === 'tool_use');
            if (!calls.length) return { answer: (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), tools: used };
            messages.push({ role: 'assistant', content: d.content });
            const results = [];
            for (const c of calls) { used.push(c.name); results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(await runTool(c.name, c.input, session)).slice(0, 20000) }); }
            messages.push({ role: 'user', content: results });
        }
    } else {
        const messages = [{ role: 'system', content: system(session) }, ...past, { role: 'user', content: question }];
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const d = await callApi('openai_compat', 'chat', { messages, tools: OPENAI_TOOLS }, row);
            const msg = d?.choices?.[0]?.message || {};
            if (!msg.tool_calls?.length) return { answer: String(msg.content || '').trim(), tools: used };
            messages.push(msg);
            for (const c of msg.tool_calls) {
                used.push(c.function?.name);
                let args = {}; try { args = JSON.parse(c.function?.arguments || '{}') || {}; } catch { /* empty */ }
                messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(await runTool(c.function?.name, args, session)).slice(0, 20000) });
            }
        }
    }
    return { answer: 'That needed too many steps — try a narrower question.', tools: used };
}
