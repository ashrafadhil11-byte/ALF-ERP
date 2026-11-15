// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import codes from '../api/_routes/codes.js';
import bookings from '../api/_routes/bookings.js';
import { cleanFields } from '../api/_lib/booking-map.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
        const json = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts); return out?.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });

test('codes: anyone signed in can read; only admins can change', async () => {
    fake({ role: 'staff', branch: 'ALFSLL' }, { '/rest/v1/destination_codes': () => [{ code: '3' }], '/rest/v1/cargo_types': () => [{ code: '1' }] });
    let r = res();
    await codes(req('GET'), r);
    assert.deepEqual([r.body.destinations.length, r.body.cargo_types.length], [1, 1]);
    r = res();
    await codes(req('POST', { body: { type: 'cargo', code: '4', name: 'Express' } }), r);
    assert.equal(r.code, 403);
});

test('codes: validation and duplicate code message', async () => {
    fake({ role: 'super_admin' });
    let r = res();
    await codes(req('POST', { body: { type: 'destination', country_code: 'IN', code: 'X' } }), r);
    assert.match(r.body.error, /number/);
    fake({ role: 'super_admin' }, { '/rest/v1/destination_codes': () => ({ __fail: { message: 'duplicate key value violates unique constraint "destination_codes_code_key"' } }) });
    r = res();
    await codes(req('POST', { body: { type: 'destination', country_code: 'NP', country_name: 'Nepal', code: '3' } }), r);
    assert.match(r.body.error, /already used/);
    r = res();
    await codes(req('DELETE', { query: { type: 'cargo', key: '1' } }), r);
    assert.match(r.body.error, /deactivate/);
});

test('cleanFields: boxes, codes, volumetric', () => {
    const { fields, errors } = cleanFields({ dest_country_code: 'in', cargo_type_code: '1', boxes: [{ weight: '8', l: 50, w: 40, h: 30 }, { weight: 3 }] });
    assert.deepEqual(errors, []);
    assert.equal(fields.dest_country_code, 'IN');
    assert.equal(fields.boxes[0].vol, 12);
    assert.equal(fields.boxes[1].vol, null);
    assert.ok(cleanFields({ dest_country_code: 'IND' }).errors.length);
});

const BRANCH = { '/rest/v1/branches?branch_code': () => [{ branch_code: 'ALFSLL', branch_name: 'Salalah', location: 'Salalah' }] };

test('create with auto_ref: reference comes from next_booking_ref, client AWB ignored', async () => {
    const calls = fake({ role: 'staff', branch: 'ALFSLL', full_name: 'Ali' }, {
        ...BRANCH,
        'rpc/next_booking_ref': () => '311000001',
        'rpc/import_booking': (u, o) => ({ result: 'imported', awb: JSON.parse(o.body).p_row.awb })
    });
    const r = res();
    await bookings(req('POST', { body: { action: 'create', auto_ref: true, awb: 'HACK1', fields: { shipper: 'A', consignee: 'B', dest_country_code: 'IN', cargo_type_code: '1' } } }), r);
    assert.equal(r.body.awb, '311000001');
    assert.deepEqual(calls.find(c => c.url.includes('next_booking_ref')).body, { p_branch_code: 'ALFSLL', p_country_code: 'IN', p_cargo_code: '1' });
});

test('create with auto_ref needs destination and cargo; DB errors surface', async () => {
    fake({ role: 'staff', branch: 'ALFSLL' }, BRANCH);
    let r = res();
    await bookings(req('POST', { body: { action: 'create', auto_ref: true, fields: { shipper: 'A', consignee: 'B', cargo_type_code: '1' } } }), r);
    assert.match(r.body.error, /destination/);
    fake({ role: 'staff', branch: 'ALFSLL' }, { ...BRANCH, 'rpc/next_booking_ref': () => ({ __fail: { message: 'Branch ALFSLL has no booking code (AWB digit). Set it in Branch Network.' } }) });
    r = res();
    await bookings(req('POST', { body: { action: 'create', auto_ref: true, fields: { shipper: 'A', consignee: 'B', dest_country_code: 'IN', cargo_type_code: '1' } } }), r);
    assert.match(r.body.error, /AWB digit/);
});
