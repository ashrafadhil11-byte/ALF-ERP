// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import transfers from '../api/_routes/transfers.js';
import consolidation from '../api/_routes/consolidation.js';
import notifications from '../api/_routes/notifications.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, opts, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u1&select')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts, body); return out?.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali' };
const ADMIN = { id: 'u1', role: 'super_admin', branch: null, full_name: 'Boss' };

test('transfers: staff cannot act for another branch; held list = boxes on hand here; no cargo to Main Office', async () => {
    const calls = fake(STAFF, {
        '/rpc/cargo_stock': (u, o, body) => body.p_branch === 'ALFSNY' ? [{ awb: 'A1', boxes: [1, 2], boxes_total: 2, weight: '10.5' }, { awb: 'A3', boxes: [2], boxes_total: 3, weight: 4 }] : [],
        '/rest/v1/branches?': () => [{ branch_code: 'ALFSLL', status: 'Optimal' }, { branch_code: 'ALFHO', branch_type: 'main_office' }, { branch_code: 'AFWRSL', branch_type: 'warehouse' }, { branch_code: 'X', status: 'Dismissed' }]
    });
    const r = res();
    await transfers(req('GET', { query: { branch: 'ALFSLL' } }), r);
    assert.equal(r.body.branch, 'ALFSNY');
    assert.deepEqual(r.body.held.map(b => [b.awb, b.pieces, b.boxes_total, b.weight]), [['A1', 2, 2, 10.5], ['A3', 1, 3, 4]]);
    assert.deepEqual(r.body.branches.map(b => b.branch_code), ['ALFSLL', 'AFWRSL']);
    assert.ok(!calls.some(c => c.url.includes('ALFSLL')));
});

test('transfers: admin must pick a branch; outbound passes everything to the RPC', async () => {
    fake(ADMIN);
    let r = res();
    await transfers(req('GET'), r);
    assert.match(r.body.error, /branch you are working at/);

    const calls = fake(ADMIN, { 'rpc/transfer_outbound': () => ({ id: 7, manifest_no: 'TR-ALFKNR-00007', count: 2 }) });
    r = res();
    await transfers(req('POST', { body: { action: 'outbound', branch: 'alfknr', awbs: ['a1', 'A1', 'b2'], to_branch: 'alfkoc', vehicle: 'Van 3' } }), r);
    assert.equal(r.body.manifest_no, 'TR-ALFKNR-00007');
    const rpc = calls.find(c => c.url.includes('transfer_outbound')).body;
    assert.deepEqual([rpc.p_awbs, rpc.p_from, rpc.p_to, rpc.p_vehicle], [['A1', 'B2'], 'ALFKNR', 'ALFKOC', 'Van 3']);
});

test('transfers: inbound returns per-AWB results; DB errors surface as 400', async () => {
    fake(STAFF, { 'rpc/transfer_inbound': () => [{ awb: 'A1', result: 'received' }, { awb: 'ZZ', result: 'not_found' }] });
    let r = res();
    await transfers(req('POST', { body: { action: 'inbound', awbs: ['A1', 'ZZ'] } }), r);
    assert.deepEqual(r.body.results.map(x => x.result), ['received', 'not_found']);
    fake(STAFF, { 'rpc/transfer_outbound': () => ({ __fail: { message: 'Choose a different destination branch.' } }) });
    r = res();
    await transfers(req('POST', { body: { action: 'outbound', awbs: ['A1'], to_branch: 'ALFSNY' } }), r);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /different destination/);
});

test('consolidation: MAWB check digit and duplicate number', async () => {
    fake(STAFF);
    let r = res();
    await consolidation(req('POST', { body: { action: 'create', mawb: '176-12345670' } }), r);
    assert.match(r.body.error, /check digit/);
    const calls = fake(STAFF, { '/rest/v1/consolidations': (u, o) => o.method === 'POST' ? [{ id: 3, mawb: '176-12345675' }] : [] });
    r = res();
    await consolidation(req('POST', { body: { action: 'create', mawb: ' 176-12345675 ' } }), r);
    assert.equal(r.body.consolidation.id, 3);
    assert.equal(calls.find(c => c.opts.method === 'POST').body.origin_branch, 'ALFSNY');
    fake(STAFF, { '/rest/v1/consolidations': () => ({ __fail: { message: 'duplicate key value violates unique constraint' } }) });
    r = res();
    await consolidation(req('POST', { body: { action: 'create', kind: 'bag', mawb: 'BAG-1' } }), r);
    assert.match(r.body.error, /already exists/);
});

test('consolidation: staff cannot touch another branch\'s MAWB or add its shipments', async () => {
    fake(STAFF, { '/rest/v1/consolidations?id=eq.4': () => [{ id: 4, mawb: 'X', origin_branch: 'ALFSLL' }] });
    let r = res();
    await consolidation(req('POST', { body: { action: 'add', id: 4, awbs: ['A1'] } }), r);
    assert.match(r.body.error, /another branch/);
    fake(STAFF, { '/rest/v1/consolidations?id=eq.5': () => [{ id: 5, mawb: 'Y', origin_branch: 'ALFSNY' }], '/rest/v1/bookings?awb=in.': () => [{ awb: 'A1', branch_code: 'ALFKNR' }] });
    r = res();
    await consolidation(req('POST', { body: { action: 'add', id: 5, awbs: ['A1'] } }), r);
    assert.match(r.body.error, /Held by another branch: A1/);
});

test('notifications: branch-scoped, own actions excluded, unread after last seen', async () => {
    const calls = fake({ ...STAFF, notif_seen_at: '2026-11-16T10:00:00Z' }, {
        '/rest/v1/statuses': () => [{ code: 'DELIVERY_FAILED' }, { code: 'CANCELLED' }],
        '/rest/v1/tracking_events': () => [
            { id: 1, status_code: 'DELIVERY_FAILED', status: 'Delivery Attempt Failed', remark: 'Not reachable', event_at: '2026-11-16T11:00:00Z', created_by_name: 'Rashid', bookings: { awb: 'A1' } },
            { id: 2, status_code: 'REVIEWED', status: 'Customer Reviewed', remark: '5★', event_at: '2026-11-16T09:00:00Z', bookings: { awb: 'A2' } }
        ],
        // incoming manifests only (the 'received' query for the sender's confirmations returns nothing here)
        '/rest/v1/transfer_manifests': (u) => u.includes('status=in.(received,partial)') ? [] : [{ id: 9, manifest_no: 'TR-ALFSLL-00009', from_branch: 'ALFSLL', status: 'in_transit', created_at: '2026-11-16T10:30:00Z', transfers: [{ status: 'pending' }, { status: 'pending' }] }]
    });
    const r = res();
    await notifications(req('GET'), r);
    assert.deepEqual(r.body.items.map(n => [n.kind, n.unread]), [['exception', true], ['inbound', true], ['review', false]]);
    assert.equal(r.body.unread, 2);
    assert.match(r.body.items[1].title, /2 shipments coming from ALFSLL/);
    const ev = calls.find(c => c.url.includes('/tracking_events')).url;
    assert.ok(ev.includes('bookings.branch_code=eq.ALFSNY') && ev.includes('created_by.neq.u1') && !ev.includes('CANCELLED'));
    assert.ok(calls.find(c => c.url.includes('/transfer_manifests?status=in.(in_transit,partial)')).url.includes('to_branch=eq.ALFSNY'));
});

test('notifications: "seen" stamps the employee row', async () => {
    const calls = fake(STAFF);
    const r = res();
    await notifications(req('POST', { body: { action: 'seen' } }), r);
    const patch = calls.find(c => c.opts.method === 'PATCH');
    assert.ok(patch.url.includes('employees?id=eq.u1') && patch.body.notif_seen_at);
});

test('transfers: boxes sent / boxes received are passed to the database', async () => {
    let calls = fake(STAFF, { 'rpc/transfer_outbound': () => ({ id: 1, manifest_no: 'TR-ALFSNY-00001', count: 1 }) });
    let r = res();
    await transfers(req('POST', { body: { action: 'outbound', awbs: ['a1'], to_branch: 'ALFSLL', pieces: { a1: [1, '2'] } } }), r);
    assert.deepEqual(calls.find(c => c.url.includes('transfer_outbound')).body.p_pieces, { A1: [1, 2] });
    calls = fake(STAFF, { 'rpc/transfer_inbound': () => [{ awb: 'A1', result: 'received_short', missing: [2] }] });
    r = res();
    await transfers(req('POST', { body: { action: 'inbound', awbs: ['A1'], pieces: { A1: [1] } } }), r);
    assert.deepEqual(calls.find(c => c.url.includes('transfer_inbound')).body.p_pieces, { A1: [1] });
    assert.deepEqual(r.body.results[0].missing, [2]);
});
