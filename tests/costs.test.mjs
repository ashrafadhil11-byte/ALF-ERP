// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import status from '../api/_routes/status.js';
import consolidation from '../api/_routes/consolidation.js';
import accounts from '../api/_routes/accounts.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, opts, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u1')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts, body); return out?.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });
const STAFF = { id: 'u1', role: 'staff', branch: 'SLL', full_name: 'Ali' };
const MGR = { id: 'u1', role: 'branch_manager', branch: 'SNY', full_name: 'Mgr' };
const ADMIN = { id: 'u1', role: 'super_admin', branch: null, full_name: 'Boss' };

test('status: shipments with some boxes ticked go one by one, the rest in one batch', async () => {
    const calls = fake(STAFF, {
        '/rest/v1/statuses?code=eq.': () => [{ code: 'OUTBOUND_HUB', label: 'In Transit to Hub', requires: [] }],
        '/rest/v1/bookings?awb=in.': () => [{ awb: 'A1', branch_code: 'SLL' }, { awb: 'A2', branch_code: 'SLL' }],
        'rpc/set_status_pieces': () => ({ updated: 2 }),
        'rpc/set_status': () => 1
    });
    const r = res();
    await status(req('POST', { body: { awbs: ['A1', 'A2'], code: 'OUTBOUND_HUB', pieces: { A1: [1, '2'] } } }), r);
    assert.equal(r.body.updated, 2);
    assert.deepEqual(calls.find(c => c.url.includes('set_status_pieces')).body.p_pieces, [1, 2]);
    assert.deepEqual(calls.find(c => c.url.endsWith('rpc/set_status')).body.p_awbs, ['A2']);
});

test('status: ?boxes= lists the boxes; other branch hidden from staff', async () => {
    fake(STAFF, { '/rest/v1/bookings?or=': () => [{ id: 'b', awb: 'A1', branch_code: 'SLL', booking_pieces: [{ piece_no: 2 }, { piece_no: 1 }] }] });
    let r = res();
    await status(req('GET', { query: { boxes: 'a1' } }), r);
    assert.deepEqual(r.body.boxes.map(b => b.piece_no), [1, 2]);
    fake(STAFF, { '/rest/v1/bookings?or=': () => [{ id: 'b', awb: 'A1', branch_code: 'KNR', booking_pieces: [] }] });
    r = res();
    await status(req('GET', { query: { boxes: 'A1' } }), r);
    assert.equal(r.code, 404);
});

test('consolidation: container fields + box selection passed to the database', async () => {
    let calls = fake(STAFF, { '/rest/v1/consolidations': (u, o) => o.method === 'POST' ? [{ id: 9, mawb: 'MSKU1234567' }] : [] });
    let r = res();
    await consolidation(req('POST', { body: { action: 'create', kind: 'container', mawb: 'msku1234567', container_size: '40HC', seal_no: 'S1', bl_no: 'BL9' } }), r);
    const row = calls.find(c => c.opts.method === 'POST').body;
    assert.deepEqual([row.kind, row.container_size, row.seal_no, row.bl_no], ['container', '40HC', 'S1', 'BL9']);
    calls = fake(STAFF, {
        '/rest/v1/consolidations?id=eq.9': () => [{ id: 9, mawb: 'X', origin_branch: 'SLL' }],
        '/rest/v1/bookings?awb=in.': () => [{ awb: 'A1', branch_code: 'SLL' }],
        'rpc/consolidation_add': () => 1
    });
    r = res();
    await consolidation(req('POST', { body: { action: 'add', id: 9, awbs: ['a1'], pieces: { a1: [2, '3'] } } }), r);
    assert.deepEqual(calls.find(c => c.url.includes('consolidation_add')).body.p_pieces, { A1: [2, 3] });
});

test('accounts: cost bill for a shipment by AWB; staff cannot', async () => {
    fake(STAFF);
    let r = res();
    await accounts(req('POST', { body: { action: 'cost_bill', cost_type: 'trucking', awb: 'A1', amount: 5 } }), r);
    assert.equal(r.code, 403);
    const calls = fake(MGR, {
        '/rest/v1/branches?branch_code=eq.SNY': () => [{ branch_code: 'SNY', currency: 'OMR' }],
        '/rest/v1/bookings?awb=eq.A1': () => [{ id: 'bk1', branch_code: 'SNY' }],
        'rpc/cost_bill_create': () => ({ id: 1, bill_no: 'CST-SNY-000001' })
    });
    r = res();
    await accounts(req('POST', { body: { action: 'cost_bill', cost_type: 'trucking', awb: 'a1', amount: '5', pay_method: 'cash' } }), r);
    assert.equal(r.body.bill_no, 'CST-SNY-000001');
    const b = calls.find(c => c.url.includes('cost_bill_create')).body;
    assert.deepEqual([b.p_branch, b.p_booking_id, b.p_consolidation_id, b.p_pay_method], ['SNY', 'bk1', null, 'cash']);
});

test('accounts: sending moved to the Warehouse page, only the branch receives; settling is head office', async () => {
    const REQ = { '/rest/v1/stock_requests?id=eq.5': () => [{ id: 5, request_no: 'SRQ-SNY-000001', warehouse: 'CWH', branch_code: 'SNY', status: 'requested' }] };
    fake(MGR, REQ);
    let r = res();
    await accounts(req('POST', { body: { action: 'stock_dispatch', id: 5, lines: [] } }), r);
    assert.equal(r.code, 403);
    const calls = fake(MGR, { ...REQ, 'rpc/stock_request_receive': () => ({ request_no: 'SRQ-SNY-000001', total: 22.5 }) });
    r = res();
    await accounts(req('POST', { body: { action: 'stock_receive', id: 5 } }), r);
    assert.equal(r.body.total, 22.5);
    fake({ ...MGR, branch: 'CWH' }, { ...REQ, 'rpc/stock_request_dispatch': () => ({ request_no: 'SRQ-SNY-000001', total: 22.5 }) });
    r = res();
    await accounts(req('POST', { body: { action: 'stock_dispatch', id: 5, lines: [{ product_id: 1, qty: 30 }] } }), r);
    assert.equal(r.code, 403);   // even the warehouse branch: sending is on the PIN-locked Warehouse page now
    assert.match(r.body.error, /Warehouse page/);
    fake(MGR);
    r = res();
    await accounts(req('POST', { body: { action: 'internal_settle', warehouse: 'CWH', branch_code: 'SNY', amount: 5, method: 'bank' } }), r);
    assert.equal(r.code, 403);
});

test('accounts: supplier / agent saved with type, services and terms', async () => {
    const calls = fake(ADMIN, { '/rest/v1/suppliers': () => [{ id: 3 }] });
    let r = res();
    await accounts(req('POST', { body: { action: 'supplier_save', name: 'Maersk', kind: 'agent', services: ['sea', 'hack'], payment_terms_days: '900', email: 'ops@maersk.example' } }), r);
    const row = calls.find(c => c.url.includes('/rest/v1/suppliers') && c.opts.method === 'POST').body;
    assert.deepEqual([row.kind, row.services, row.payment_terms_days], ['agent', ['sea'], 365]);
    r = res();
    await accounts(req('POST', { body: { action: 'supplier_save', name: 'X', email: 'not-an-email' } }), r);
    assert.match(r.body.error, /email/);
});
