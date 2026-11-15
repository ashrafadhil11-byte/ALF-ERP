// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import bookings from '../api/bookings.js';
import users from '../api/users.js';
import { getSession } from '../api/_lib/auth.js';
import { cleanFields } from '../api/_lib/booking-map.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
        const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
        if (url.includes('/auth/v1/user')) return json({ id: ME, email: 'me@x.com' });
        if (url.includes(`/rest/v1/employees?id=eq.${ME}&select=*`)) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts); return out?.__fail ? json(out.__fail, false, 400) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });

test('cleanFields validates and proper-cases', () => {
    const { fields, errors } = cleanFields({ shipper: 'ali KHAN', weight: '12.5', pieces: '0', intake_mode: 'x', dest_country: ' india ' });
    assert.deepEqual([fields.shipper, fields.weight, fields.intake_mode, fields.dest_country], ['Ali Khan', 12.5, 'drop_off', 'India']);
    assert.equal(errors.length, 1); // pieces 0
});

test('deactivated employees have no session', async () => {
    fake({ role: 'super_admin', active: false });
    assert.equal(await getSession(req('GET')), null);
});

const BRANCH = { '/rest/v1/branches?branch_code': () => [{ branch_code: 'MCT', branch_name: 'Muscat', location: 'Muscat' }] };

test('create: manual shipment saved via import_booking, duplicates refused', async () => {
    let calls = fake({ role: 'staff', branch: 'MCT', full_name: 'Ali' }, { ...BRANCH, 'rpc/import_booking': () => ({ result: 'imported', awb: 'M1' }) });
    let r = res();
    await bookings(req('POST', { body: { action: 'create', awb: ' m1 ', fields: { shipper: 'a', consignee: 'b', weight: '3', pieces: '2' }, branch: 'SLL' } }), r);
    assert.equal(r.body.result, 'imported');
    const p = calls.find(c => c.url.includes('import_booking')).body.p_row;
    assert.deepEqual([p.awb, p.branch_code, p.source, p.origin_city, p.raw], ['M1', 'MCT', 'manual', 'Muscat', null]);

    fake({ role: 'staff', branch: 'MCT' }, { ...BRANCH, '/rest/v1/bookings?or=(awb.eq.M1': () => [{ awb: 'M1' }] });
    r = res();
    await bookings(req('POST', { body: { action: 'create', awb: 'M1', fields: { shipper: 'a', consignee: 'b' } } }), r);
    assert.equal(r.code, 409);
    assert.match(r.body.error, /already exists/);
});

test('create: shipper and consignee required', async () => {
    fake({ role: 'staff', branch: 'MCT' }, BRANCH);
    const r = res();
    await bookings(req('POST', { body: { action: 'create', awb: 'X', fields: { shipper: 'a' } } }), r);
    assert.equal(r.code, 400);
});

test('edit: only changed fields saved and logged on the timeline', async () => {
    const calls = fake({ role: 'staff', branch: 'MCT', full_name: 'Ali' }, {
        '/rest/v1/bookings?or=(awb.eq.A1': () => [{ id: 'b1', awb: 'A1', branch_code: 'MCT', weight: 10, consignee: 'Sara' }],
        '/rest/v1/bookings?id=eq.b1': () => [],
        '/rest/v1/tracking_events': () => []
    });
    const r = res();
    await bookings(req('PATCH', { body: { awb: 'a1', fields: { weight: '12', consignee: 'sara' } } }), r);
    assert.deepEqual(r.body.changed, ['weight']);
    assert.deepEqual(Object.keys(calls.find(c => c.url.includes('bookings?id=eq.b1')).body).sort(), ['updated_at', 'weight']);
    const ev = calls.find(c => c.url.endsWith('/rest/v1/tracking_events')).body;
    assert.equal(ev.status, 'Details updated');
    assert.match(ev.remark, /weight: 10 → 12/);
});

test('delete: staff refused, manager allowed on own branch only', async () => {
    fake({ role: 'staff', branch: 'MCT' });
    let r = res();
    await bookings(req('DELETE', { query: { awb: 'A1' } }), r);
    assert.equal(r.code, 403);

    fake({ role: 'branch_manager', branch: 'MCT' }, { '/rest/v1/bookings?or=(awb.eq.A1': () => [{ id: 'b1', awb: 'A1', branch_code: 'SLL' }] });
    r = res();
    await bookings(req('DELETE', { query: { awb: 'A1' } }), r);
    assert.equal(r.code, 404);

    const calls = fake({ role: 'branch_manager', branch: 'MCT' }, { '/rest/v1/bookings?or=(awb.eq.A1': () => [{ id: 'b1', awb: 'A1', branch_code: 'MCT' }], '/rest/v1/bookings?id=eq.b1': () => [] });
    r = res();
    await bookings(req('DELETE', { query: { awb: 'A1' } }), r);
    assert.equal(r.body.deleted, 'A1');
    assert.equal(calls.find(c => c.url.includes('bookings?id=eq.b1')).opts.method, 'DELETE');
});

test('users: staff cannot list; head office cannot touch a super admin', async () => {
    fake({ role: 'staff', branch: 'MCT' });
    let r = res();
    await users(req('GET'), r);
    assert.equal(r.code, 403);

    fake({ role: 'head_office' }, { [`employees?id=eq.${OTHER}`]: () => [{ id: OTHER, role: 'super_admin' }] });
    r = res();
    await users(req('PATCH', { body: { id: OTHER, active: false } }), r);
    assert.equal(r.code, 403);
});

test('users: deactivate bans login; cannot deactivate yourself', async () => {
    const calls = fake({ id: ME, role: 'super_admin' }, {
        [`employees?id=eq.${OTHER}`]: (u, o) => (o.method === 'PATCH' ? [] : [{ id: OTHER, role: 'staff', branch: 'MCT' }]),
        [`/auth/v1/admin/users/${OTHER}`]: () => ({})
    });
    let r = res();
    await users(req('PATCH', { body: { id: OTHER, active: false } }), r);
    assert.equal(r.body.success, true);
    assert.equal(calls.find(c => c.url.includes(`/auth/v1/admin/users/${OTHER}`)).body.ban_duration, '876000h');

    fake({ id: ME, role: 'super_admin' }, { [`employees?id=eq.${ME}&select=*`]: () => [{ id: ME, role: 'super_admin' }] });
    r = res();
    await users(req('PATCH', { body: { id: ME, active: false } }), r);
    assert.equal(r.code, 400);
});

test('users: staff role needs a branch', async () => {
    fake({ id: ME, role: 'super_admin' }, { [`employees?id=eq.${OTHER}`]: () => [{ id: OTHER, role: 'head_office', branch: null }] });
    const r = res();
    await users(req('PATCH', { body: { id: OTHER, role: 'staff' } }), r);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /need a branch/);
});
