// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import { pickCard, priceFor } from '../api/_lib/accounts.js';
import accounts from '../api/_routes/accounts.js';
import bookings from '../api/_routes/bookings.js';

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
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSLL', full_name: 'Ali' };
const MGR = { id: 'u1', role: 'branch_manager', branch: 'ALFSLL', full_name: 'Mgr' };
const ADMIN = { id: 'u1', role: 'super_admin', branch: null, full_name: 'Boss' };

test('pricing: most specific card wins', () => {
    const cards = [
        { id: 1, dest_country_code: '*', cargo_type_code: '*', method: 'per_kg', rate: 1 },
        { id: 2, dest_country_code: 'IN', cargo_type_code: '*', method: 'per_kg', rate: 2 },
        { id: 3, dest_country_code: 'IN', cargo_type_code: '1', method: 'per_kg', rate: 3 },
        { id: 4, dest_country_code: 'NP', cargo_type_code: '1', method: 'per_kg', rate: 4, active: false }
    ];
    assert.equal(pickCard(cards, { dest: 'in', cargo: '1' }).id, 3);
    assert.equal(pickCard(cards, { dest: 'IN', cargo: '2' }).id, 2);
    assert.equal(pickCard(cards, { dest: 'NP', cargo: '1' }).id, 1);   // inactive skipped
    assert.equal(pickCard([], { dest: 'IN' }), null);
});

test('pricing: per kg, package, box, bands, minimum', () => {
    assert.deepEqual(priceFor({ method: 'per_kg', rate: 1.8, min_charge: 5, currency: 'OMR' }, { kg: 12 }).amount, 21.6);
    assert.equal(priceFor({ method: 'per_kg', rate: 1.8, min_charge: 5 }, { kg: 2 }).amount, 5);
    assert.equal(priceFor({ method: 'per_kg', rate: 1.8, min_charge: 5 }, { kg: 2 }).detail, 'minimum charge');
    assert.equal(priceFor({ method: 'per_package', rate: 3 }, { pieces: 4 }).amount, 12);
    assert.equal(priceFor({ method: 'per_box', rate: 7.5 }, { boxes: 2 }).amount, 15);
    const band = { method: 'vol_band', bands: [{ upto: 20, price: 25 }, { upto: 10, price: 15 }], extra_per_kg: 1.2 };
    assert.equal(priceFor(band, { kg: 8 }).amount, 15);
    assert.equal(priceFor(band, { kg: 10 }).amount, 15);
    assert.equal(priceFor(band, { kg: 10.5 }).amount, 25);
    assert.equal(priceFor(band, { kg: 23 }).amount, 28.6);
});

test('accounts: staff may only get a quote, for their own branch', async () => {
    const calls = fake(STAFF, { '/rest/v1/rate_cards': () => [{ id: 9, dest_country_code: 'IN', cargo_type_code: '*', method: 'per_kg', rate: 2, min_charge: 0, currency: 'OMR' }] });
    let r = res();
    await accounts(req('GET', { query: { view: 'quote', branch: 'ALFMCT', dest: 'IN', cargo: '1', kg: '10' } }), r);
    assert.equal(r.body.quote.amount, 20);
    assert.ok(calls.find(c => c.url.includes('rate_cards')).url.includes('branch_code=eq.ALFSLL'));
    r = res();
    await accounts(req('GET', { query: { view: 'invoices' } }), r);
    assert.equal(r.code, 403);
});

test('accounts: branch manager is fixed to own branch and cannot see the ledger', async () => {
    const calls = fake(MGR);
    let r = res();
    await accounts(req('GET', { query: { view: 'invoices', branch: 'ALFKNR' } }), r);
    assert.ok(calls.find(c => c.url.includes('/rest/v1/invoices')).url.includes('branch_code=eq.ALFSLL'));
    r = res();
    await accounts(req('GET', { query: { view: 'ledger' } }), r);
    assert.equal(r.code, 403);
    r = res();
    await accounts(req('POST', { body: { action: 'journal', lines: [] } }), r);
    assert.equal(r.code, 403);
});

test('accounts: cannot pay or void another branch\'s documents', async () => {
    fake(MGR, { '/rest/v1/invoices?id=eq.5': () => [{ id: 5, branch_code: 'ALFKNR' }], '/rest/v1/payments?id=eq.6': () => [{ id: 6, branch_code: 'ALFKNR' }] });
    let r = res();
    await accounts(req('POST', { body: { action: 'payment', invoice_id: 5, amount: 1, method: 'cash' } }), r);
    assert.equal(r.code, 403);
    r = res();
    await accounts(req('POST', { body: { action: 'payment_void', id: 6, reason: 'x' } }), r);
    assert.equal(r.code, 403);
});

test('accounts: manual invoice uses branch currency + tax; payment method mapped', async () => {
    const calls = fake(MGR, {
        '/rest/v1/branches?branch_code=eq.ALFSLL': () => [{ branch_code: 'ALFSLL', currency: 'OMR', tax_rate: 0 }],
        'rpc/invoice_create': () => ({ id: 1, invoice_no: 'INV-ALFSLL-000001', total: 3 })
    });
    const r = res();
    await accounts(req('POST', { body: { action: 'invoice', branch: 'ALFKNR', pay_method: 'bank_transfer', lines: [{ description: 'Packing', qty: 2, rate: 1.5 }, { description: 'empty', rate: 0 }] } }), r);
    assert.equal(r.body.invoice_no, 'INV-ALFSLL-000001');
    const rpc = calls.find(c => c.url.includes('invoice_create')).body;
    assert.deepEqual([rpc.p_branch, rpc.p_currency, rpc.p_tax_rate, rpc.p_pay_method, rpc.p_lines.length], ['ALFSLL', 'OMR', 0, 'bank', 1]);
});

test('accounts: rate card validation', async () => {
    fake(ADMIN, { '/rest/v1/branches?branch_code=eq.ALFSLL': () => [{ branch_code: 'ALFSLL', currency: 'OMR' }] });
    let r = res();
    await accounts(req('POST', { body: { action: 'rate_save', branch_code: 'ALFSLL', method: 'vol_band', bands: [] } }), r);
    assert.match(r.body.error, /weight band/);
    r = res();
    await accounts(req('POST', { body: { action: 'rate_save', branch_code: 'ALFSLL', method: 'per_kg', rate: 1, dest_country_code: 'IND' } }), r);
    assert.match(r.body.error, /2-letter/);
    r = res();
    await accounts(req('POST', { body: { action: 'rate_save', method: 'per_kg', rate: 1 } }), r);
    assert.match(r.body.error, /Choose the branch/);
});

test('booking create: counter booking with a charge gets an invoice; import does not', async () => {
    const BR = { '/rest/v1/branches?branch_code': () => [{ branch_code: 'ALFSLL', branch_name: 'Salalah', location: 'Salalah', currency: 'OMR', tax_rate: 0 }] };
    let calls = fake(STAFF, {
        ...BR,
        'rpc/next_booking_ref': () => '311000009',
        'rpc/import_booking': (u, o, b) => ({ result: 'imported', awb: b.p_row.awb }),
        '/rest/v1/bookings?awb=eq.311000009': () => [{ id: 'b-uuid' }],
        'rpc/invoice_create': () => ({ id: 3, invoice_no: 'INV-ALFSLL-000003', payment: { receipt_no: 'RCT-ALFSLL-000002' } })
    });
    let r = res();
    await bookings(req('POST', { body: { action: 'create', auto_ref: true, fields: { shipper: 'A', shipper_phone: '+968 9', consignee: 'B', dest_country_code: 'IN', dest_country: 'India', cargo_type_code: '1', amount: '21.6', payment_method: 'card', chargeable_weight: 12 } } }), r);
    assert.equal(r.body.invoice.invoice_no, 'INV-ALFSLL-000003');
    const inv = calls.find(c => c.url.includes('invoice_create')).body;
    assert.deepEqual([inv.p_booking_id, inv.p_pay_method, inv.p_currency, inv.p_lines[0].rate, inv.p_customer_phone], ['b-uuid', 'card', 'OMR', 21.6, '+968 9']);
    assert.match(inv.p_lines[0].description, /Freight 311000009 to India · 12 kg/);

    calls = fake(STAFF, { ...BR, 'rpc/import_booking': () => ({ result: 'imported', awb: 'X1' }) });
    r = res();
    await bookings(req('POST', { body: { action: 'create', source: 'alfarhaonline', awb: 'X1', fields: { shipper: 'A', consignee: 'B', amount: '9' } } }), r);
    assert.equal(r.body.invoice, null);
    assert.ok(!calls.some(c => c.url.includes('invoice_create')));
});

test('booking create: invoice failure does not lose the booking', async () => {
    fake(STAFF, {
        '/rest/v1/branches?branch_code': () => [{ branch_code: 'ALFSLL', currency: 'OMR' }],
        'rpc/import_booking': () => ({ result: 'imported', awb: 'M1' }),
        'rpc/invoice_create': () => ({ __fail: { message: 'The invoice total must be above zero.' } })
    });
    const r = res();
    await bookings(req('POST', { body: { action: 'create', awb: 'M1', fields: { shipper: 'A', consignee: 'B', amount: '5' } } }), r);
    assert.equal(r.body.result, 'imported');
    assert.match(r.body.invoice_error, /above zero/);
});

import { quoteShipment, fitSize, cleanLines } from '../api/_lib/accounts.js';

test('pricing: electronics priced on their own card, general boxes on the general card', () => {
    const cards = [
        { dest_country_code: 'IN', cargo_type_code: '*', commodity: '*', method: 'per_kg', rate: 1.8, currency: 'OMR' },
        { dest_country_code: 'IN', cargo_type_code: '*', commodity: 'ELEC', method: 'per_kg', rate: 2.5, currency: 'OMR' }
    ];
    const q = quoteShipment(cards, { dest: 'IN', cargo: '1', boxes: [{ weight: 10, commodity: 'GEN' }, { weight: 4, commodity: 'ELEC' }, { weight: 2, commodity: 'GEN' }], commodityNames: { ELEC: 'Electronics' } });
    assert.deepEqual(q.lines.map(l => [l.commodity, l.amount]), [['GEN', 21.6], ['ELEC', 10]]);
    assert.equal(q.amount, 31.6);
    assert.match(q.lines[1].description, /Electronics/);
    // no electronics card → falls back to the general card
    const g = quoteShipment([cards[0]], { dest: 'IN', boxes: [{ weight: 5, commodity: 'ELEC' }] });
    assert.equal(g.amount, 9);
    // nothing for the route
    assert.deepEqual(quoteShipment([], { dest: 'IN', boxes: [{ weight: 5 }] }).missing, ['General']);
});

test('pricing: per CBM and by box size', () => {
    const cbm = quoteShipment([{ dest_country_code: '*', cargo_type_code: '*', method: 'per_cbm', rate: 120, currency: 'OMR' }],
        { dest: 'IN', boxes: [{ weight: 30, l: 100, w: 50, h: 50 }, { weight: 10, l: 50, w: 50, h: 40 }] });
    assert.equal(cbm.amount, 120 * 0.35);
    const sizes = [{ name: 'Small', l: 40, w: 30, h: 30, price: 8 }, { name: 'Large', l: 80, w: 60, h: 60, price: 25 }, { name: 'Medium', l: 60, w: 40, h: 40, price: 15 }];
    assert.equal(fitSize(sizes, { l: 30, w: 40, h: 25 }).name, 'Small');        // rotated still fits
    assert.equal(fitSize(sizes, { l: 55, w: 45, h: 30 }).name, 'Large');        // 45 > 40 → not medium
    assert.equal(fitSize(sizes, { l: 90, w: 10, h: 10 }), null);
    const q = quoteShipment([{ dest_country_code: '*', cargo_type_code: '*', method: 'box_size', sizes, currency: 'OMR' }],
        { dest: 'IN', boxes: [{ l: 30, w: 30, h: 30, weight: 5 }, { l: 50, w: 40, h: 40, weight: 9 }, { l: 120, w: 50, h: 50, weight: 20 }] });
    assert.equal(q.amount, 23);
    assert.equal(q.unmatched, 1);
    assert.match(q.lines[0].description, /1 × Small, 1 × Medium/);
});

test('invoice lines are cleaned: unknown kinds become freight, zero lines dropped', () => {
    const l = cleanLines([{ kind: 'material', product_id: '7', qty: '2', rate: '1.25' }, { kind: 'hack', rate: 3 }, { kind: 'charge', rate: 0 }]);
    assert.deepEqual(l.map(x => [x.kind, x.product_id, x.qty, x.rate]), [['material', 7, 2, 1.25], ['freight', null, 1, 3]]);
});

test('accounts: purchase + stock count go to the RPCs with the branch currency', async () => {
    const calls = fake(MGR, {
        '/rest/v1/branches?branch_code=eq.ALFSLL': () => [{ branch_code: 'ALFSLL', currency: 'OMR' }],
        'rpc/purchase_create': () => ({ id: 1, purchase_no: 'PUR-ALFSLL-000001', total: 60 }),
        'rpc/stock_count': () => ({ difference: -2, value: 1 })
    });
    let r = res();
    await accounts(req('POST', { body: { action: 'purchase', branch: 'ALFKNR', supplier_id: 3, pay_method: 'credit', lines: [{ product_id: 1, qty: 100, unit_cost: 0.4 }, { qty: 0 }] } }), r);
    assert.equal(r.body.purchase_no, 'PUR-ALFSLL-000001');
    const p = calls.find(c => c.url.includes('purchase_create')).body;
    assert.deepEqual([p.p_branch, p.p_currency, p.p_pay_method, p.p_lines.length, p.p_supplier_id], ['ALFSLL', 'OMR', 'credit', 1, 3]);
    r = res();
    await accounts(req('POST', { body: { action: 'stock_count', product_id: 1, counted: 95 } }), r);
    assert.equal(r.body.difference, -2);
});

test('accounts: commodities are admin-only; box-size cards need sizes', async () => {
    fake(MGR);
    let r = res();
    await accounts(req('POST', { body: { action: 'commodity_save', code: 'PERF', name: 'Perfume' } }), r);
    assert.equal(r.code, 403);
    fake(ADMIN, { '/rest/v1/branches?branch_code=eq.ALFSLL': () => [{ branch_code: 'ALFSLL', currency: 'OMR' }] });
    r = res();
    await accounts(req('POST', { body: { action: 'rate_save', branch_code: 'ALFSLL', method: 'box_size', sizes: [{ name: 'S', l: 0 }] } }), r);
    assert.match(r.body.error, /box size/);
});

import { matchCharge } from '../api/_lib/accounts.js';

test('documents slab: first 0.5 kg + each extra 0.5 kg, actual weight only', () => {
    const doc = { dest_country_code: '*', cargo_type_code: '*', commodity: 'DOC', method: 'doc_slab', slab: { base_kg: 0.5, base_price: 5, step_kg: 0.5, step_price: 2 }, currency: 'OMR' };
    const gen = { dest_country_code: '*', cargo_type_code: '*', commodity: '*', method: 'per_kg', rate: 1.8, currency: 'OMR' };
    const p = (kg) => priceFor(doc, { kg: 99, actualKg: kg }).amount;
    assert.deepEqual([p(0.3), p(0.5), p(0.6), p(1.0), p(1.2)], [5, 5, 7, 7, 9]);
    // envelope with big dimensions: volumetric is ignored for documents, not for parcels
    const q = quoteShipment([doc, gen], { dest: 'IN', boxes: [{ weight: 0.4, l: 40, w: 30, h: 5, commodity: 'DOC' }, { weight: 3, l: 40, w: 40, h: 40, commodity: 'GEN' }], commodityNames: { DOC: 'Documents' } });
    assert.deepEqual(q.lines.map(l => [l.commodity, l.amount]), [['DOC', 5], ['GEN', 23.04]]);
});

test('extra charges: price by cargo type, most specific wins, missing = not applicable', () => {
    const items = [
        { name: 'Handling', basis: 'per_box', price: 2, cargo_type_code: '1', dest_country_code: '*' },
        { name: 'Handling', basis: 'per_box', price: 2.5, cargo_type_code: '2', dest_country_code: '*' },
        { name: 'Handling', basis: 'per_box', price: 3, cargo_type_code: '2', dest_country_code: 'NP' },
        { name: 'Insurance', basis: 'per_shipment', price: 1, cargo_type_code: '1', dest_country_code: '*' }
    ];
    assert.equal(matchCharge(items, { name: 'Handling', cargo: '1', dest: 'IN' }).price, 2);
    assert.equal(matchCharge(items, { name: 'Handling', cargo: '2', dest: 'IN' }).price, 2.5);
    assert.equal(matchCharge(items, { name: 'Handling', cargo: '2', dest: 'np' }).price, 3);
    assert.equal(matchCharge(items, { name: 'Insurance', cargo: '2', dest: 'IN' }), null);
});

test('accounts: charge saved with cargo / destination / auto; doc slab needs its first slab', async () => {
    const calls = fake(ADMIN, { '/rest/v1/branches?branch_code=eq.ALFSLL': () => [{ branch_code: 'ALFSLL', currency: 'OMR' }] });
    let r = res();
    await accounts(req('POST', { body: { action: 'charge_save', branch_code: 'ALFSLL', name: 'Handling', basis: 'per_box', price: '2.5', cargo_type_code: '2', dest_country_code: 'xx1', auto_add: true } }), r);
    assert.equal(r.body.success, true);
    const row = calls.find(c => c.url.includes('/rest/v1/charge_items') && c.opts.method === 'POST').body;
    assert.deepEqual([row.cargo_type_code, row.dest_country_code, row.auto_add, row.price], ['2', '*', true, 2.5]);
    r = res();
    await accounts(req('POST', { body: { action: 'rate_save', branch_code: 'ALFSLL', method: 'doc_slab', slab: { base_kg: '', base_price: '' } } }), r);
    assert.match(r.body.error, /first slab/);
});
