// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import assistant from '../api/_routes/assistant.js';
import { propose, runReports, reportText } from '../api/_lib/ai-tasks.js';
import { runTool } from '../api/_lib/assistant.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali' };
const MANAGER = { id: 'u2', role: 'branch_manager', branch: 'ALFSNY', full_name: 'Mona' };
const session = (e) => ({ user: { id: e.id }, role: e.role, branch: e.branch, employee: e });
const STATUSES = [{ code: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', requires: [] }, { code: 'ON_HOLD', label: 'On Hold', requires: ['remark'] }, { code: 'ASSIGNED_TO_AGENT', label: 'Assigned Forwarding Agent', requires: ['agent_docket'] }];

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
        const method = opts.method || 'GET';
        calls.push({ url, method, body, auth: opts.headers?.Authorization || opts.headers?.authorization });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: employee.id, email: 'a@b.c' });
        if (url.includes(`/rest/v1/employees?id=eq.${employee.id}&select`)) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const r = fn(url, opts, body, method); if (r !== undefined) return json(r); }
        return json([]);
    };
    return calls;
}
const writes = (calls) => calls.filter(c => c.method !== 'GET' && c.url.includes('/rest/v1/') && !c.url.includes('audit_log') && !c.url.includes('/rpc/'));

test('propose status: checks the status, its required details and the branch — and changes nothing', async () => {
    const found = [{ awb: '311000001', branch_code: 'ALFSNY', consignee: 'Ravi', dest_country: 'IN', current_status: 'Arrived at Destination Hub' }, { awb: '311000002', branch_code: 'ALFSLL', consignee: 'Sam' }];
    const calls = fake(STAFF, { 'statuses?active': () => STATUSES, 'bookings?awb=in': (u) => found.filter(f => u.includes(f.awb)) });
    await assert.rejects(propose('status', { awbs: ['311000001'], status: 'flying' }, session(STAFF)), /Unknown status/);
    await assert.rejects(propose('status', { awbs: ['311000001'], status: 'on hold' }, session(STAFF)), /needs a reason/);
    await assert.rejects(propose('status', { awbs: ['311000001'], status: 'Assigned Forwarding Agent' }, session(STAFF)), /Status Update page/);
    await assert.rejects(propose('status', { awbs: ['311000002'], status: 'Out for delivery' }, session(STAFF)), /another branch/);
    await assert.rejects(propose('status', { awbs: ['311000009'], status: 'Out for delivery' }, session(STAFF)), /Not found/);
    const p = await propose('status', { awbs: '311000001', status: 'out for delivery', location: 'Sohar' }, session(STAFF));
    assert.deepEqual(p.payload, { awbs: ['311000001'], code: 'OUT_FOR_DELIVERY', location: 'Sohar' });
    assert.match(p.title, /Out for Delivery/);
    assert.equal(writes(calls).length, 0);
});

test('Farah: answers the latest message; a job is saved on the server as a card — nothing changes', async () => {
    let round = 0;
    const calls = fake(STAFF, {
        'chat_threads?id=eq.9&kind=eq.assistant&direct_key=eq.ai:u1': () => [{ id: 9 }],
        'chat_messages?thread_id=eq.9&deleted_at': () => [{ id: 5, sender_id: 'u1', body: 'mark 311000001 out for delivery', created_at: '2026-11-20T08:00:00Z' }, { id: 4, sender_id: null, body: 'Hi Ali!', created_at: '2026-11-20T07:00:00Z' }],
        'integrations?kind=eq.ai': () => [{ id: 1, name: 'Groq', adapter: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', config: { model: 'm' }, secret: { api_key: 'k' } }],
        'api.groq.com': (u, o, b) => { if (++round === 1) { assert.equal(b.messages.at(-2).role, 'assistant'); return { choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_status_update', arguments: '{"awbs":["311000001"],"status":"Out for Delivery","remark":null}' } }] } }] }; }
            return { choices: [{ message: { role: 'assistant', content: 'Ready, Ali — tap **Confirm** 👍' } }] }; },
        'statuses?active': () => STATUSES,
        'bookings?awb=in': () => [{ awb: '311000001', branch_code: 'ALFSNY' }],
        '/rest/v1/chat_messages': (u, o, b) => o.method === 'POST' ? [{ id: 6, ...b, created_at: '2026-11-20T08:00:05Z' }] : []
    });
    const r = res(); await assistant({ method: 'POST', query: {}, body: { action: 'reply', thread: 9 }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.message.sender_name, 'Farah');
    assert.match(r.body.message.body, /Confirm/);
    const job = r.body.message.ai_actions[0];
    assert.equal(job.kind, 'status'); assert.equal(job.state, 'ready'); assert.equal(job.payload, undefined);   // the browser never gets the payload
    const saved = calls.find(c => c.url.endsWith('/chat_messages') && c.method === 'POST').body;
    assert.deepEqual(saved.ai_actions[0].payload, { awbs: ['311000001'], code: 'OUT_FOR_DELIVERY' });
    assert.equal(writes(calls).filter(c => !c.url.endsWith('/chat_messages')).length, 0);
    // someone else's chat: not found
    fake(STAFF);
    const r2 = res(); await assistant({ method: 'POST', query: {}, body: { action: 'reply', thread: 77 }, headers: { authorization: 'Bearer t' } }, r2);
    assert.equal(r2.code, 404);
});

test('Farah: Confirm runs the saved job through the normal API as this user; it cannot run twice', async () => {
    const msg = (state, payload) => [{ id: 6, thread_id: 9, ai_actions: [{ id: 'p1', kind: 'status', title: 't', lines: [], payload, state }] }];
    let calls = fake(STAFF, {
        'chat_messages?id=eq.6&sender_id=is.null': () => msg('ready', { awbs: ['311000001'], code: 'OUT_FOR_DELIVERY' }),
        'statuses?code=eq.OUT_FOR_DELIVERY': () => [{ ...STATUSES[0], stage: 7 }], 'bookings?awb=in': () => [{ awb: '311000001', branch_code: 'ALFSNY' }]
    });
    let r = res(); await assistant({ method: 'POST', query: {}, body: { action: 'run', message: 6, id: 'p1' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.message.ai_actions[0].state, 'done');
    assert.ok(calls.some(c => c.url.includes('audit_log') && c.body?.route === 'status' && c.body?.user_agent === 'Farah (AI assistant)'));
    assert.ok(calls.some(c => c.url.includes('chat_messages?id=eq.6') && c.method === 'PATCH' && c.body.ai_actions[0].state === 'done'));
    // already done → refused
    fake(STAFF, { 'chat_messages?id=eq.6&sender_id=is.null': () => msg('done', {}) });
    r = res(); await assistant({ method: 'POST', query: {}, body: { action: 'run', message: 6, id: 'p1' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 409);
    // the permission check still happens when it runs (a shipment moved to another branch meanwhile)
    calls = fake(STAFF, {
        'chat_messages?id=eq.6&sender_id=is.null': () => msg('ready', { awbs: ['311000002'], code: 'OUT_FOR_DELIVERY' }),
        'statuses?code=eq.OUT_FOR_DELIVERY': () => [{ ...STATUSES[0], stage: 7 }], 'bookings?awb=in': () => [{ awb: '311000002', branch_code: 'ALFSLL' }]
    });
    r = res(); await assistant({ method: 'POST', query: {}, body: { action: 'run', message: 6, id: 'p1' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.message.ai_actions[0].state, 'error');
    assert.match(r.body.result, /another branch/);
    assert.ok(!calls.some(c => c.url.includes('tracking_events') && c.method === 'POST'));
});

test('Farah: her chat is made once, with a greeting by first name', async () => {
    const { ensureFarah } = await import('../api/_lib/farah.js');
    const calls = fake(STAFF, { '/rest/v1/chat_threads?on_conflict': () => [{ id: 31 }] });
    await ensureFarah('u9', 'Muhammed Adhil');
    await ensureFarah('u9', 'Muhammed Adhil');
    assert.equal(calls.filter(c => c.url.includes('chat_threads?on_conflict')).length, 1);
    const hello = calls.find(c => c.url.endsWith('/chat_messages') && c.method === 'POST').body;
    assert.equal(hello.sender_name, 'Farah');
    assert.match(hello.body, /Muhammed! 👋 I'm Farah/);
});

test('consolidation: open by MAWB (typographic dash too), only within the branch', async () => {
    const { default: consolidation } = await import('../api/_routes/consolidation.js');
    const calls = fake(STAFF, { 'consolidations?mawb=ilike.EAG-01': () => [{ id: 3 }], 'consolidations?id=eq.3': () => [{ id: 3, mawb: 'EAG-01', origin_branch: 'ALFSNY' }] });
    const r = res(); await consolidation({ method: 'GET', query: { mawb: 'EAG‑01' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.consolidation.mawb, 'EAG-01');
    assert.ok(calls.find(c => c.url.includes('consolidations?mawb=')).url.includes('origin_branch=eq.ALFSNY'));
});

test('reports: managers only for the daily summary; switching one on saves it for this user', async () => {
    fake(STAFF);
    await assert.rejects(propose('report', { kind: 'daily_summary', slot: 'morning' }, session(STAFF)), /for managers/);
    const ok = await propose('report', { kind: 'exceptions', slot: 'evening' }, session(STAFF));
    assert.equal(ok.payload.slot, 'evening');
    const calls = fake(MANAGER);
    const { runProposal } = await import('../api/_lib/ai-tasks.js');
    const out = await runProposal({ kind: 'report', payload: { kind: 'daily_summary', slot: 'morning' } }, session(MANAGER), 'Bearer t');
    assert.match(out.message, /our chat/);
    const save = calls.find(c => c.url.includes('ai_reports?on_conflict') && c.method === 'POST');
    assert.deepEqual(save.body, { employee_id: 'u2', kind: 'daily_summary', slot: 'morning', branch_code: null, active: true });
});

test('runReports: posts to each user\'s Farah chat once a day; skips people no longer allowed', async () => {
    const calls = fake(MANAGER, {
        'ai_reports?slot=eq.morning': () => [
            { id: 1, employee_id: 'u2', kind: 'exceptions', branch_code: null, employees: { role: 'branch_manager', branch: 'ALFSNY', active: true } },
            { id: 2, employee_id: 'u1', kind: 'daily_summary', branch_code: null, employees: { role: 'staff', branch: 'ALFSNY', active: true } }
        ],
        'statuses?is_exception': () => [{ code: 'ON_HOLD' }],
        'bookings?archived': (u) => { assert.ok(u.includes('branch_code=eq.ALFSNY')); return [{ awb: '311000003', current_status: 'On Hold', consignee: 'Ravi' }]; },
        'chat_threads?direct_key=eq.ai:u2': () => [{ id: 77 }]
    });
    const out = await runReports('morning');
    assert.deepEqual(out, { slot: 'morning', sent: 1, failed: 0 });
    const msg = calls.find(c => c.url.endsWith('/chat_messages') && c.method === 'POST');
    assert.equal(msg.body.thread_id, 77);
    assert.equal(msg.body.sender_id, null);
    assert.match(msg.body.body, /311000003/);
    assert.ok(calls.some(c => c.url.includes('ai_reports?id=eq.1') && c.method === 'PATCH' && c.body.last_sent_on));
    assert.ok(!calls.some(c => c.url.includes('ai_reports?id=eq.2') && c.method === 'PATCH'));
});

test('daily summary report text adds up the company for head office', async () => {
    fake(MANAGER, {
        'branches?branch_type': () => [{ branch_code: 'A' }, { branch_code: 'B' }],
        'rpc/daily_summary': (u, o, b) => ({ branch: b.p_branch, bookings: b.p_branch === 'A' ? 3 : 2, kg: 10, invoiced: { OMR: 5 }, cash_closed: b.p_branch === 'A', waiting: {} })
    });
    const text = await reportText('daily_summary', 'morning', { branch: null });
    assert.match(text, /whole company/);
    assert.match(text, /Bookings: 5 \(20 kg\)/);
    assert.match(text, /OMR 10\.000/);
    assert.match(text, /Cash not closed: B/);
});

test('erp_read: reads a page as this user — staff are refused what their page refuses', async () => {
    const calls = fake(STAFF);
    const out = await runTool('erp_read', { page: 'accounts', view: 'inventory' }, { role: 'staff', branch: 'ALFSNY', user: { id: 'u1' } }, { auth: 'Bearer t' });
    assert.ok(out.error);
    assert.ok(!calls.some(c => c.url.includes('branch_products')));
});

test('chat: Farah takes text, not files or shipment cards', async () => {
    const { default: chat } = await import('../api/_routes/chat.js');
    fake(STAFF, { 'chat_threads?id=eq.5': () => [{ id: 5, kind: 'assistant', title: 'Farah', chat_members: [{ employee_id: 'u1' }] }] });
    const r = res(); await chat({ method: 'POST', query: {}, body: { action: 'send', thread: 5, body: 'hi', awb: '311000001' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /text only/);
});
