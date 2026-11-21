// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import packing, { packingSummaries } from '../api/_routes/packing.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali Hassan' };
const BOOKING = { id: 'b1', awb: '311000045', shipper: 'Ravi', consignee: 'Anu', dest_country: 'India', pieces: 3, boxes: 3, branch_code: 'ALFSNY', booking_pieces: [{ piece_no: 1 }, { piece_no: 2 }, { piece_no: 3 }] };

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
        const method = opts.method || 'GET';
        calls.push({ url, method, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: employee.id, email: 'a@b.c' });
        if (url.includes(`/rest/v1/employees?id=eq.${employee.id}&select`)) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const r = fn(url, opts, body, method); if (r !== undefined) return json(r); }
        return json([]);
    };
    return calls;
}
const call = async (method, body, query = {}) => { const r = res(); await packing({ method, query, body, headers: { authorization: 'Bearer t' } }, r); return r; };

test('packing: the list of a shipment — boxes, items, and the branch favourites before the common items', async () => {
    fake(STAFF, {
        'bookings?or=': () => [BOOKING],
        'packing_items?booking_id=eq.b1': () => [{ id: 1, piece_no: 1, item: 'Clothes', qty: 3 }],
        'rpc/packing_top_items': (u, o, b) => { assert.equal(b.p_branch, 'ALFSNY'); return [{ item: 'Dates', uses: 9 }]; }
    });
    const r = await call('GET', undefined, { awb: '311000045' });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.boxes, [1, 2, 3]);
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.common[0], 'Dates');
    assert.ok(r.body.common.includes('Clothes'));
    assert.equal(r.body.shipment.id, undefined);
});

test('packing: another branch\'s shipment is not found; a box that does not exist is refused', async () => {
    fake(STAFF, { 'bookings?or=': () => [{ ...BOOKING, branch_code: 'ALFSLL' }] });
    let r = await call('GET', undefined, { awb: '311000045' });
    assert.equal(r.code, 404);
    fake(STAFF, { 'bookings?or=': () => [BOOKING] });
    r = await call('POST', { action: 'add', awb: '311000045', piece_no: 7, item: 'Shoes' });
    assert.equal(r.code, 400);
    assert.match(r.body.error, /boxes/);
});

test('packing: adding the same item again in the same box adds to its quantity; a new item is saved with who added it', async () => {
    let calls = fake(STAFF, {
        'bookings?or=': () => [BOOKING],
        'packing_items?booking_id=eq.b1&piece_no=eq.2&item=ilike.Shoes': () => [{ id: 5, piece_no: 2, item: 'Shoes', qty: 2 }],
        'packing_items?id=eq.5': (u, o, b, m) => m === 'PATCH' ? [{ id: 5, piece_no: 2, item: 'Shoes', qty: b.qty }] : undefined
    });
    let r = await call('POST', { action: 'add', awb: '311000045', piece_no: 2, item: 'shoes', qty: 1 });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.merged, true);
    assert.equal(r.body.item.qty, 3);
    calls = fake(STAFF, { 'bookings?or=': () => [BOOKING], '/rest/v1/packing_items?select=': (u, o, b, m) => m === 'POST' ? [{ id: 9, ...b }] : undefined });
    r = await call('POST', { action: 'add', awb: '311000045', piece_no: 1, item: '  kitchen   utensils ', qty: 4 });
    const saved = calls.find(c => c.method === 'POST' && c.url.includes('/packing_items')).body;
    assert.deepEqual([saved.booking_id, saved.piece_no, saved.item, saved.qty, saved.created_by_name], ['b1', 1, 'Kitchen utensils', 4, 'Ali Hassan']);
    r = await call('POST', { action: 'add', awb: '311000045', piece_no: 1, item: 'Toys', qty: 0 });
    assert.equal(r.code, 400);
});

test('packing: changing or deleting a line checks the branch of its shipment', async () => {
    fake(STAFF, { 'packing_items?id=eq.5&select=id,booking_id': () => [{ id: 5, booking_id: 'b9', bookings: { branch_code: 'ALFSLL' } }] });
    const r = await call('POST', { action: 'delete', id: 5 });
    assert.equal(r.code, 404);
});

test('packing summaries for manifests: "Box 1: 3 Clothes, 2 Shoes · Box 2: …"', async () => {
    fake(STAFF, { 'packing_items?booking_id=in.': () => [
        { booking_id: 'b1', piece_no: 1, item: 'Clothes', qty: 3 }, { booking_id: 'b1', piece_no: 1, item: 'Shoes', qty: 2 },
        { booking_id: 'b1', piece_no: 2, item: 'Books', qty: 10 }, { booking_id: 'b2', piece_no: 1, item: 'Dates', qty: 1 }] });
    const s = await packingSummaries(['b1', 'b2']);
    assert.equal(s.b1, 'Box 1: 3 Clothes, 2 Shoes · Box 2: 10 Books');
    assert.equal(s.b2, 'Box 1: 1 Dates');
});
