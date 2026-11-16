// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import delivery from '../api/_routes/delivery.js';
import track from '../api/_routes/track.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = typeof opts.body === 'string' ? (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() : opts.body;
        calls.push({ url, opts, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u1')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts, body); return out?.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body, auth = true } = {}) => ({ method, query, body, headers: auth ? { authorization: 'Bearer t' } : {} });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSLL', full_name: 'Ali', is_driver: false };
const HELD = { '/rest/v1/bookings?awb=in.': () => [{ awb: 'A1', branch_code: 'ALFSLL' }] };

test('board: non-admin sees only their branch', async () => {
    const calls = fake(STAFF);
    const r = res();
    await delivery(req('GET'), r);
    assert.equal(r.code, 200);
    const board = calls.filter(c => /bookings\?current_status_code|deliveries\?status/.test(c.url));
    assert.ok(board.length >= 3 && board.every(c => c.url.includes('branch_code=eq.ALFSLL')));
    assert.ok(r.body.reasons.includes('Customer not reachable'));
});

test('dispatch: driver must be a real driver; RPC gets the driver name', async () => {
    let calls = fake(STAFF, { ...HELD, '/rest/v1/employees?id=eq.d9': () => [] });
    let r = res();
    await delivery(req('POST', { body: { action: 'dispatch', awbs: ['a1'], mode: 'driver', driver_id: 'd9' } }), r);
    assert.match(r.body.error, /Choose a driver/);

    calls = fake(STAFF, { ...HELD, '/rest/v1/employees?id=eq.d1': () => [{ id: 'd1', full_name: 'Rashid' }], 'rpc/delivery_dispatch': () => 1 });
    r = res();
    await delivery(req('POST', { body: { action: 'dispatch', awbs: ['a1', 'A1'], mode: 'driver', driver_id: 'd1' } }), r);
    assert.equal(r.body.dispatched, 1);
    const rpc = calls.find(c => c.url.includes('delivery_dispatch')).body;
    assert.deepEqual([rpc.p_awbs, rpc.p_driver_name, rpc.p_branch], [['A1'], 'Rashid', 'ALFSLL']);
});

test('dispatch: another branch\'s shipment is refused for staff', async () => {
    fake(STAFF, { '/rest/v1/bookings?awb=in.': () => [{ awb: 'A1', branch_code: 'ALFMCT' }] });
    const r = res();
    await delivery(req('POST', { body: { action: 'dispatch', awbs: ['A1'], mode: 'agent', agent_name: 'Aramex' } }), r);
    assert.match(r.body.error, /another branch/);
});

test('complete: POD images go to the private bucket, paths passed to the RPC', async () => {
    const png = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
    const calls = fake(STAFF, {
        ...HELD,
        '/rest/v1/deliveries?awb=eq.A1&status=eq.out': () => [{ driver_id: 'someone' }],
        '/storage/v1/object/pod/': () => ({ Key: 'pod/x' }),
        'rpc/delivery_complete': () => ({ awb: 'A1', attempt: 1, outcome: 'delivered', review_token: 'f'.repeat(32) })
    });
    const r = res();
    await delivery(req('POST', { body: { action: 'complete', awb: 'A1', outcome: 'delivered', received_by: 'Fathima', signature: png, lat: '23.5', lng: '' } }), r);
    assert.equal(r.body.review_token.length, 32);
    const up = calls.find(c => c.url.includes('/storage/v1/object/pod/'));
    assert.match(up.url, /pod\/A1\/\d+-signature\.png$/);
    assert.equal(up.opts.headers['Content-Type'], 'image/png');
    const rpc = calls.find(c => c.url.includes('delivery_complete')).body;
    assert.match(rpc.p_signature, /^A1\/\d+-signature\.png$/);
    assert.deepEqual([rpc.p_photo, rpc.p_lat, rpc.p_lng], [null, 23.5, null]);
});

test('complete: rejects non-image uploads', async () => {
    fake(STAFF, { ...HELD });
    const r = res();
    await delivery(req('POST', { body: { action: 'complete', awb: 'A1', outcome: 'delivered', received_by: 'X', photo: 'data:text/html;base64,PGgxPg==' } }), r);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /JPEG, PNG or WebP/);
});

test('track: public, hides names and remarks; review only with the right token', async () => {
    fake(null, {
        '/rest/v1/bookings?awb=eq.A1': () => [{ id: 'b1', awb: 'A1', current_stage: 8, current_status_code: 'DELIVERED', review_token: 'a'.repeat(32), reviewed_at: null, statuses: { customer_label: 'Delivered' }, dest_city: 'Kannur' }],
        '/rest/v1/tracking_events': () => [{ status_code: 'DELIVERED', status: 'Delivered', location: 'Kannur', event_at: '2026-11-16T10:00:00Z', remark: 'Received by Fathima', created_by_name: 'Rashid', statuses: { customer_label: 'Delivered' } }]
    });
    let r = res();
    await track(req('GET', { query: { awb: 'a1' }, auth: false }), r);
    assert.equal(r.body.status, 'Delivered');
    assert.equal(r.body.review.can_review, false);
    assert.ok(!JSON.stringify(r.body).includes('Fathima') && !JSON.stringify(r.body).includes('Rashid') && !JSON.stringify(r.body).includes('aaaa'));
    r = res();
    await track(req('GET', { query: { awb: 'A1', r: 'a'.repeat(32) }, auth: false }), r);
    assert.equal(r.body.review.can_review, true);
});

test('track: review POST validates token format and passes the rating', async () => {
    const calls = fake(null, { 'rpc/review_submit': () => 'A1' });
    let r = res();
    await track(req('POST', { body: { token: 'bad', rating: 5 }, auth: false }), r);
    assert.equal(r.code, 400);
    r = res();
    await track(req('POST', { body: { token: 'b'.repeat(32), rating: '4', comment: 'Nice' }, auth: false }), r);
    assert.equal(r.body.awb, 'A1');
    assert.deepEqual(calls.find(c => c.url.includes('review_submit')).body, { p_token: 'b'.repeat(32), p_rating: 4, p_comment: 'Nice' });
});
