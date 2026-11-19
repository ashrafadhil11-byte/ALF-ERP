// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import pickups from '../api/_routes/pickups.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, method: opts.method || 'GET', body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: employee.id, email: 'a@b.c' });
        if (url.includes(`/rest/v1/employees?id=eq.${employee.id}&select`)) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) return json(fn(url, opts, body));
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const post = (body) => ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } });
const get = (query) => ({ method: 'GET', query, headers: { authorization: 'Bearer t' } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali' };
const DRIVER = { id: 'd1', role: 'staff', branch: 'ALFSNY', full_name: 'Rafi', is_driver: true };
const MANAGER = { id: 'm1', role: 'branch_manager', branch: 'ALFSNY', full_name: 'Sara' };
const PK = (x = {}) => ({ id: 4, pickup_no: 'PKP-ALFSNY-000004', branch_code: 'ALFSNY', status: 'requested', driver_id: null, ...x });

test('pickups: create needs name, phone, address and a branch (never the warehouse)', async () => {
    fake(STAFF, { 'branches?branch_code=eq.ALFSNY': () => [{ branch_code: 'ALFSNY', branch_type: 'branch' }] });
    let r = res(); await pickups(post({ action: 'create', customer_name: 'Ali', phone: '12', address: 'x' }), r);
    assert.match(r.body.error, /phone/);
    const calls = fake(STAFF, { 'branches?branch_code=eq.ALFSNY': () => [{ branch_code: 'ALFSNY', branch_type: 'branch' }], '/rest/v1/pickup_requests': (u, o, b) => ({ ...b, id: 1, pickup_no: 'PKP-ALFSNY-000001' }) });
    r = res(); await pickups(post({ action: 'create', branch: 'ALFSLL', customer_name: ' Ali ', phone: '+968 9123 4567', address: 'Al Khuwair', slot: 'nonsense' }), r);
    assert.equal(r.code, 200);
    const w = calls.find(c => c.method === 'POST').body;
    assert.equal(w.branch_code, 'ALFSNY');            // staff always use their own branch
    assert.equal(w.slot, 'any');
    assert.equal(w.customer_name, 'Ali');
});

test('pickups: only managers assign; only the assigned driver (or a manager) marks picked up', async () => {
    fake(STAFF, { 'pickup_requests?id=eq.4': () => [PK()] });
    let r = res(); await pickups(post({ action: 'assign', id: 4, driver_id: 'd1' }), r);
    assert.equal(r.code, 403);
    const calls = fake(MANAGER, { 'pickup_requests?id=eq.4': () => [PK()], 'employees?id=eq.d1&is_driver': () => [{ id: 'd1', full_name: 'Rafi' }] });
    r = res(); await pickups(post({ action: 'assign', id: 4, driver_id: 'd1' }), r);
    assert.equal(r.code, 200);
    assert.deepEqual([calls.at(-1).body.status, calls.at(-1).body.driver_name], ['assigned', 'Rafi']);
    fake({ ...DRIVER, id: 'd2' }, { 'pickup_requests?id=eq.4': () => [PK({ status: 'assigned', driver_id: 'd1' })] });
    r = res(); await pickups(post({ action: 'picked', id: 4 }), r);
    assert.equal(r.code, 403);
    fake(DRIVER, { 'pickup_requests?id=eq.4': () => [PK({ status: 'assigned', driver_id: 'd1' })] });
    r = res(); await pickups(post({ action: 'picked', id: 4 }), r);
    assert.equal(r.code, 200);
});

test('pickups: another branch is invisible; a driver sees one assigned to them', async () => {
    fake(STAFF, { 'pickup_requests?id=eq.4': () => [PK({ branch_code: 'ALFSLL' })] });
    let r = res(); await pickups(get({ id: '4' }), r);
    assert.equal(r.code, 404);
    fake({ ...DRIVER, branch: 'ALFTMT' }, { 'pickup_requests?id=eq.4': () => [PK({ branch_code: 'ALFSLL', driver_id: 'd1' })] });
    r = res(); await pickups(get({ id: '4' }), r);
    assert.equal(r.code, 200);
});

test('pickups: cancel needs a reason; booked links an existing shipment', async () => {
    fake(STAFF, { 'pickup_requests?id=eq.4': () => [PK()] });
    let r = res(); await pickups(post({ action: 'cancel', id: 4, reason: '' }), r);
    assert.match(r.body.error, /reason/);
    fake(STAFF, { 'pickup_requests?id=eq.4': () => [PK({ status: 'picked_up' })], 'bookings?awb=eq.': () => [] });
    r = res(); await pickups(post({ action: 'booked', id: 4, awb: '311000099' }), r);
    assert.match(r.body.error, /not found/);
    const calls = fake(STAFF, { 'pickup_requests?id=eq.4': () => [PK({ status: 'picked_up' })], 'bookings?awb=eq.311000099': () => [{ awb: '311000099' }] });
    r = res(); await pickups(post({ action: 'booked', id: 4, awb: '311000099' }), r);
    assert.equal(r.code, 200);
    assert.equal(calls.at(-1).body.booking_awb, '311000099');
});
