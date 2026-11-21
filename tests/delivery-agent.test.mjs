// Run: node --test tests/
// "Assigned Delivery Agent": status with agent + docket (one for all, or each shipment its own), carrier sync on the
// delivery docket, and Farah preparing it for one or many AWBs.
import test from 'node:test';
import assert from 'node:assert';
import status from '../api/_routes/status.js';
import { propose } from '../api/_lib/ai-tasks.js';
import { runCarrierSync } from '../api/_lib/carrier-sync.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali Hassan' };
const session = { user: { id: 'u1' }, role: 'staff', branch: 'ALFSNY', employee: STAFF };
const ADA = { code: 'ASSIGNED_DELIVERY_AGENT', label: 'Assigned Delivery Agent', stage: 7, sort: 705, is_exception: false, requires: ['delivery_docket'] };

function fake(routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
        const method = opts.method || 'GET';
        calls.push({ url, method, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u1&select')) return json([STAFF]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const r = fn(url, opts, body, method); if (r !== undefined) return json(r); }
        return json([]);
    };
    return calls;
}
const post = async (body) => { const r = res(); await status({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } }, r); return r; };
const BOOKED = (list) => () => list.map(a => ({ awb: a, branch_code: 'ALFSNY' }));

test('status: Assigned Delivery Agent needs the agent and a docket for every shipment', async () => {
    fake({ 'statuses?code=eq.ASSIGNED_DELIVERY_AGENT': () => [ADA], 'bookings?awb=in': BOOKED(['3131908', '3136227']) });
    let r = await post({ awbs: ['3131908'], code: 'ASSIGNED_DELIVERY_AGENT', delivery_docket: '322976564' });
    assert.equal(r.code, 400); assert.match(r.body.error, /delivery agent/);
    r = await post({ awbs: ['3131908', '3136227'], code: 'ASSIGNED_DELIVERY_AGENT', delivery_agent: 'Delhivery', dockets: { '3131908': '322976564' } });
    assert.equal(r.code, 400); assert.match(r.body.error, /docket number for 3136227/);
});

test('status: each shipment gets its own docket; the timeline names the agent', async () => {
    const calls = fake({ 'statuses?code=eq.ASSIGNED_DELIVERY_AGENT': () => [ADA], 'bookings?awb=in': BOOKED(['3131908', '3136227']), 'rpc/set_status': () => 2 });
    const r = await post({ awbs: ['3131908', '3136227'], code: 'ASSIGNED_DELIVERY_AGENT', delivery_agent: 'Delhivery', dockets: { '3131908': '322976564', '3136227': '322976562' } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.match(calls.find(c => c.url.includes('rpc/set_status')).body.p_remark, /Delivery agent: Delhivery/);
    const saves = calls.filter(c => c.method === 'PATCH' && c.url.includes('/bookings?awb=in'));
    assert.equal(saves.length, 2);
    const by = Object.fromEntries(saves.map(s => [s.url.match(/"(\d+)"/)[1], s.body]));
    assert.deepEqual(by['3131908'], { delivery_agent: 'Delhivery', delivery_docket: '322976564' });
    assert.deepEqual(by['3136227'], { delivery_agent: 'Delhivery', delivery_docket: '322976562' });
});

test('status: one docket for all still works, and the forwarding agent is untouched', async () => {
    const calls = fake({ 'statuses?code=eq.ASSIGNED_DELIVERY_AGENT': () => [ADA], 'bookings?awb=in': BOOKED(['3131908']), 'rpc/set_status': () => 1 });
    const r = await post({ awbs: ['3131908'], code: 'ASSIGNED_DELIVERY_AGENT', delivery_agent: 'Delhivery', delivery_docket: '322976564' });
    assert.equal(r.code, 200);
    assert.match(calls.find(c => c.url.includes('rpc/set_status')).body.p_remark, /Delivery agent: Delhivery \/ 322976564/);
    const saves = calls.filter(c => c.method === 'PATCH' && c.url.includes('/bookings?awb=in'));
    assert.equal(saves.length, 1);
    assert.ok(!('fwd_agent' in saves[0].body));
});

test('carrier sync: the delivery docket wins once set (Delhivery LR), otherwise the forwarding docket', async () => {
    const asked = [];
    globalThis.fetch = async (u, o = {}) => {
        const url = decodeURIComponent(String(u));
        const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('/rest/v1/bookings?')) {
            assert.ok(url.includes('or=(fwd_docket.not.is.null,delivery_docket.not.is.null)'));
            return json([{ id: 'b1', awb: '3131908', fwd_agent: 'SMSA', fwd_docket: '291747438437', delivery_agent: 'Delhivery', delivery_docket: '322976564' },
                         { id: 'b2', awb: '0620402', fwd_agent: 'SMSA', fwd_docket: '291747438437' }]);
        }
        if (url.includes('/rest/v1/integrations?kind=eq.carrier')) return json([{ id: 's', adapter: 'smsa', active: true, secret: { api_key: 'K' }, config: {} }]);
        if (url.includes('btob.api.delhivery.com')) { asked.push(url); return json({ status: 'IN_TRANSIT', timestamp: '2026-11-20T10:00:00', scan_remark: 'Dispatched' }); }
        if (url.includes('ecomapis.smsaexpress.com')) { asked.push(url); return json({ Scans: [] }); }
        if (url.includes('/rpc/apply_carrier_events')) return json({ added: 1 });
        return json([]);
    };
    const out = await runCarrierSync({ limit: 5 });
    assert.deepEqual(out.errors, []);
    assert.ok(asked.some(u => u.endsWith('/v2/track/322976564')));
    assert.ok(asked.some(u => u.endsWith('/api/track/single/291747438437')));
    assert.equal(asked.length, 2);
});

test('Farah: assigning a delivery agent for several AWBs — each docket on the card; missing ones are asked for', async () => {
    fake({ 'statuses?code=eq.ASSIGNED_DELIVERY_AGENT': () => [{ code: 'ASSIGNED_DELIVERY_AGENT', label: 'Assigned Delivery Agent' }],
        'bookings?awb=in': (u) => ['3131908', '3136227'].filter(a => u.includes(a)).map(a => ({ awb: a, branch_code: 'ALFSNY', consignee: 'Anu', dest_country: 'India' })) });
    await assert.rejects(propose('assign_agent', { agent: 'Delhivery', items: [{ awb: '3131908', docket: '322976564' }, { awb: '3136227' }] }, session), /docket \/ LR number for 3136227/);
    await assert.rejects(propose('assign_agent', { agent: 'Delhivery', items: [{ awb: '3131908', docket: '1' }, { awb: '9999999', docket: '2' }] }, session), /Not found: 9999999/);
    const p = await propose('assign_agent', { leg: 'delivery', agent: 'Delhivery', items: [{ awb: '3131908', docket: '322976564' }, { awb: '3136227', docket: '322976562' }] }, session);
    assert.equal(p.kind, 'status');
    assert.deepEqual(p.payload, { awbs: ['3131908', '3136227'], code: 'ASSIGNED_DELIVERY_AGENT', delivery_agent: 'Delhivery', dockets: { '3131908': '322976564', '3136227': '322976562' } });
    assert.match(p.title, /Assigned Delivery Agent: Delhivery for 2 shipments/);
    assert.match(p.lines[0], /3131908 → 322976564 · Anu, India/);
    // one docket for all
    const one = await propose('assign_agent', { agent: 'Delhivery', awbs: ['3131908'], docket: '322976564' }, session);
    assert.deepEqual(one.payload.dockets, { '3131908': '322976564' });
});

test('Farah: check_awbs looks up a list at once — found, other branch, already assigned', async () => {
    const { runTool } = await import('../api/_lib/assistant.js');
    fake({ 'bookings?awb=in': () => [
        { awb: '3131908', branch_code: 'ALFSNY', consignee: 'Anu', dest_city: 'Mau', dest_country: 'India', current_status: 'Arrived at Destination Hub' },
        { awb: '3136227', branch_code: 'ALFSLL', consignee: 'Sam' },
        { awb: '3141017', branch_code: 'ALFSNY', consignee: 'Ravi', delivery_agent: 'Delhivery', delivery_docket: '322976561' }] });
    const out = await runTool('check_awbs', { awbs: ['3131908', '3136227', '3141017', '3151685', '3131908'] }, { role: 'staff', branch: 'ALFSNY', user: { id: 'u1' } }, {});
    assert.equal(out.checked, 4);
    const by = Object.fromEntries(out.shipments.map(s => [s.awb, s]));
    assert.equal(by['3131908'].dest, 'Mau, India');
    assert.equal(by['3136227'].other_branch, 'ALFSLL'); assert.equal(by['3136227'].consignee, undefined);
    assert.equal(by['3141017'].delivery_agent, 'Delhivery / 322976561');
    assert.equal(by['3151685'].found, false);
});

test('Farah: a shared list goes to her in full and brings the job tools', async () => {
    const { wantsJobs } = await import('../api/_lib/assistant.js');
    assert.equal(wantsJobs('📄 sheet.csv — 2 rows:\n3131908 DELHIVERY 322976564'), true);
    assert.equal(wantsJobs('3131908 1 26.1 MAU DELHIVERY 322976564\n3136227 1 10 MUMBAI DELHIVERY 322976562'), true);
    assert.equal(wantsJobs('how many shipments to India?'), false);
});
