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
