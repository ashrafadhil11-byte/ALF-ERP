// Run: node --test tests/   — assigning a forwarding agent at origin, breaks in work hours
import test from 'node:test';
import assert from 'node:assert';
import status from '../api/_routes/status.js';
import users from '../api/_routes/users.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const ADMIN = { id: 'u1', role: 'super_admin', branch: null, full_name: 'Boss' };

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, opts, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1' });
        if (url.includes('/rest/v1/employees?id=eq.u1&')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) return json(fn(url, opts, body));
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, body, query = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });
const ASSIGNED = { code: 'ASSIGNED_TO_AGENT', label: 'Assigned Forwarding Agent', stage: 3, requires: ['agent_docket'] };
const HANDED = { code: 'HANDED_TO_AGENT', label: 'Handed to Forwarding Agent', stage: 4, requires: [] };

test('status: "Assigned Forwarding Agent" needs agent + docket and saves them on the shipment', async () => {
    let calls = fake(ADMIN, { 'statuses?code=eq.ASSIGNED': () => [ASSIGNED], 'bookings?awb=in.': (u, o) => o.method === 'PATCH' ? [] : [{ awb: 'A1', branch_code: 'SLL' }], 'rpc/set_status': () => 1 });
    let r = res();
    await status(req('POST', { awbs: ['A1'], code: 'ASSIGNED_TO_AGENT', fwd_agent: 'SMSA' }), r);
    assert.equal(r.code, 400); assert.match(r.body.error, /fwd docket/);
    r = res();
    await status(req('POST', { awbs: ['A1'], code: 'ASSIGNED_TO_AGENT', fwd_agent: 'SMSA', fwd_docket: '290012345' }), r);
    assert.equal(r.body.success, true);
    assert.deepEqual(calls.find(c => c.opts.method === 'PATCH').body, { fwd_agent: 'SMSA', fwd_docket: '290012345' });
});

test('status: "Handed to Forwarding Agent" uses the assigned agent; refused when none assigned', async () => {
    fake(ADMIN, { 'statuses?code=eq.HANDED': () => [HANDED], 'bookings?awb=in.': () => [{ awb: 'A1', branch_code: 'SLL', fwd_agent: null, fwd_docket: null }, { awb: 'A2', branch_code: 'SLL', fwd_agent: 'DHL', fwd_docket: '1' }] });
    let r = res();
    await status(req('POST', { awbs: ['A1', 'A2'], code: 'HANDED_TO_AGENT' }), r);
    assert.equal(r.code, 400); assert.match(r.body.error, /Assign a forwarding agent first.*A1/);
    assert.doesNotMatch(r.body.error, /A2/);
    fake(ADMIN, { 'statuses?code=eq.HANDED': () => [HANDED], 'bookings?awb=in.': () => [{ awb: 'A2', branch_code: 'SLL', fwd_agent: 'DHL', fwd_docket: '1' }], 'rpc/set_status': () => 1 });
    r = res();
    await status(req('POST', { awbs: ['A2'], code: 'HANDED_TO_AGENT' }), r);
    assert.equal(r.body.success, true);
});

test('status list offers saved agents', async () => {
    fake(ADMIN, { '/rest/v1/statuses?active': () => [ASSIGNED, HANDED], '/rest/v1/suppliers?': () => [{ id: 1, name: 'Gulf Express Agent' }] });
    const r = res();
    await status(req('GET'), r);
    assert.deepEqual(r.body.agents, [{ id: 1, name: 'Gulf Express Agent' }]);
});

test('staff & users: break saved, cleared, and half-filled break refused', async () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const calls = fake(ADMIN, { [`employees?id=eq.${id}`]: () => [{ id, role: 'staff', branch: 'SLL' }] });
    let r = res();
    await users(req('PATCH', { id, break_start: '13:00', break_end: '16:00' }), r);
    assert.equal(r.body.success, true);
    assert.deepEqual((({ break_start, break_end }) => ({ break_start, break_end }))(calls.filter(c => c.opts.method === 'PATCH')[0].body), { break_start: '13:00', break_end: '16:00' });
    r = res();
    await users(req('PATCH', { id, break_start: '', break_end: '' }), r);
    assert.equal(calls.filter(c => c.opts.method === 'PATCH')[1].body.break_start, null);
    r = res();
    await users(req('PATCH', { id, break_start: '13:00', break_end: '' }), r);
    assert.equal(r.code, 400);
});
