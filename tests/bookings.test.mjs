// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import bookings from '../api/bookings.js';
import status from '../api/status.js';
import { cleanOrderNo } from '../api/_lib/booking-map.js';
import CONNECTORS from '../api/_lib/integrations/connectors.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = String(u);
        calls.push({ url: decodeURIComponent(url), opts });
        const json = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (decodeURIComponent(url).includes(part)) { const out = fn(url, opts); return out && out.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });

// Response copied from the Al-Farha Online API document (totals sit OUTSIDE data[0]).
const DOC_RESPONSE = {
    response: 'success',
    data: [{ o_unique_id: '412 0431', order_date: '2024-09-16', booking_branch: 'AL-FARHA CARGO SALALAH', cargotype: 'AIR', order_from: 'Oman',
        sender_name: 'SANGITA TAMANG', sender_id: '120979611', sender_phone: '99419783', sender_whatsappno: '',
        receiver_name: 'SUBASH TAMANG', receiver_mobile: '9843468814', receiver_aadhar_id: '', receiver_housename: 'X',
        receiver_postoffice: 'BHAKTAPUR', receiver_pincode: 0, receiver_street: 'GATTTHAGHAR  MARG BISAUNI RESTO',
        receiver_district: 'BHAKTAPUR', receiver_state: 'BAGMATI PROVINCE', receiver_country: 'Nepal', receiver_landmark: '', receiver_whatsapp: '9749719785' }],
    total_box: 1,
    total_weight: 21.5
};

test('alfarhaonline.toBooking: maps the documented response', () => {
    const r = CONNECTORS.alfarhaonline.toBooking(DOC_RESPONSE, '412 0431', { branch_code: 'SLL', location: 'Salalah' });
    assert.deepEqual(
        [r.awb, r.external_ref, r.shipper, r.shipper_phone, r.consignee, r.consignee_phone, r.dest_city, r.dest_country, r.package_type, r.pieces, r.weight, r.origin_city],
        ['4120431', '4120431', 'Sangita Tamang', '99419783', 'Subash Tamang', '9843468814', 'Bhaktapur', 'Nepal', 'Air Freight', 1, 21.5, 'Salalah']);
    assert.equal(r.consignee_address, 'GATTTHAGHAR  MARG BISAUNI RESTO, BHAKTAPUR, BHAKTAPUR, BAGMATI PROVINCE'); // "X" and pincode 0 dropped
    assert.equal(r.raw.total_weight, 21.5);
    assert.equal(cleanOrderNo(" 'x 1 "), 'X1');
});

const ORDER = { response: 'success', data: [{ o_unique_id: 'ALF1', sender_name: 'A', receiver_name: 'B', receiver_country: 'Nepal' }] };
const importRoutes = (extra = {}) => ({
    '/rest/v1/branches': () => [{ branch_code: 'MCT', branch_name: 'Muscat', location: 'Muscat' }],
    '/rest/v1/integrations?adapter': () => [{ id: 'i1', adapter: 'alfarhaonline', active: true, base_url: 'https://api.test', secret: { api_key: 'K' } }],
    'api.test/api/order-details': (u, o) => (o.headers['X-API-KEY'] === 'K' && o.method === 'POST' && u.includes('order_no=ALF1') ? ORDER : { __fail: {} }),
    'rpc/import_booking': (u, o) => ({ result: 'imported', awb: JSON.parse(o.body).p_row.awb }),
    ...extra
});

test('import: staff imports into own branch, ignoring a branch in the body', async () => {
    const calls = fake({ role: 'staff', branch: 'MCT', full_name: 'Ali' }, importRoutes());
    const r = res();
    await bookings(req('POST', { body: { action: 'import', order_nos: ['alf1', 'ALF1'], branch: 'SLL' } }), r);
    assert.equal(r.body.results.length, 1); // de-duplicated
    assert.equal(r.body.results[0].result, 'imported');
    const rpc = JSON.parse(calls.find(c => c.url.includes('rpc/import_booking')).opts.body);
    assert.equal(rpc.p_row.branch_code, 'MCT');
    assert.equal(rpc.p_user_name, 'Ali');
    assert.ok(calls.find(c => c.url.includes('branch_code=eq.MCT')));
});

test('import: admin must choose a branch; inactive integration is reported', async () => {
    fake({ role: 'super_admin' }, importRoutes());
    const r1 = res();
    await bookings(req('POST', { body: { action: 'import', order_nos: ['A'] } }), r1);
    assert.equal(r1.code, 400);

    fake({ role: 'staff', branch: 'MCT' }, importRoutes({ '/rest/v1/integrations?adapter': () => [] }));
    const r2 = res();
    await bookings(req('POST', { body: { action: 'import', order_nos: ['A'] } }), r2);
    assert.match(r2.body.error, /Integrations/);
});

test('import: an order the API cannot find is an error row, not a crash', async () => {
    fake({ role: 'staff', branch: 'MCT' }, importRoutes({ 'api.test/api/order-details': () => ({ response: 'error', data: [] }) }));
    const r = res();
    await bookings(req('POST', { body: { action: 'import', order_nos: ['NOPE'] } }), r);
    assert.equal(r.body.results[0].result, 'error');
});

test('detail: staff cannot open another branch booking', async () => {
    fake({ role: 'staff', branch: 'MCT' }, { '/rest/v1/bookings': () => [{ id: 'b1', awb: 'X', branch_code: 'SLL' }] });
    const r = res();
    await bookings(req('GET', { query: { awb: 'x' } }), r);
    assert.equal(r.code, 404);
});

const STATUS = (requires = []) => ({ '/rest/v1/statuses?code': () => [{ code: 'HANDED_TO_AGENT', label: 'Handed', requires }] });

test('status: staff blocked on other branch AWBs; required fields enforced', async () => {
    fake({ role: 'staff', branch: 'MCT' }, { ...STATUS(), '/rest/v1/bookings?awb=in': () => [{ awb: 'A', branch_code: 'SLL' }] });
    const r1 = res();
    await status(req('POST', { body: { awbs: ['a'], code: 'HANDED_TO_AGENT' } }), r1);
    assert.equal(r1.code, 403);

    fake({ role: 'staff', branch: 'MCT' }, STATUS(['agent_docket']));
    const r2 = res();
    await status(req('POST', { body: { awbs: ['a'], code: 'HANDED_TO_AGENT' } }), r2);
    assert.equal(r2.code, 400);
    assert.match(r2.body.error, /fwd agent/);
});

test('status: manager update calls set_status with allow_back and builds remark', async () => {
    const calls = fake({ role: 'branch_manager', branch: 'MCT', full_name: 'Sara' }, {
        ...STATUS(['agent_docket']),
        '/rest/v1/bookings?awb=in': (u, o) => (o.method === 'PATCH' ? [] : [{ awb: 'A', branch_code: 'MCT' }, { awb: 'B', branch_code: 'MCT' }]),
        'rpc/set_status': () => 2
    });
    const r = res();
    await status(req('POST', { body: { awbs: ['a', 'b', ''], code: 'HANDED_TO_AGENT', fwd_agent: 'SMSA', fwd_docket: '999', remark: 'ok' } }), r);
    assert.equal(r.body.updated, 2);
    const p = JSON.parse(calls.find(c => c.url.includes('rpc/set_status')).opts.body);
    assert.deepEqual([p.p_awbs, p.p_allow_back, p.p_branch, p.p_user_name, p.p_remark], [['A', 'B'], true, 'MCT', 'Sara', 'ok • Agent: SMSA / 999']);
    assert.ok(calls.find(c => c.opts.method === 'PATCH')); // fwd fields saved
});

test('status: database rule errors come back as 400 with the message', async () => {
    fake({ role: 'staff', branch: 'MCT' }, {
        ...STATUS(),
        '/rest/v1/bookings?awb=in': () => [{ awb: 'A', branch_code: 'MCT' }],
        'rpc/set_status': () => ({ __fail: { message: 'Booking A is already at a later step' } })
    });
    const r = res();
    await status(req('POST', { body: { awbs: ['A'], code: 'HANDED_TO_AGENT' } }), r);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /later step/);
});
