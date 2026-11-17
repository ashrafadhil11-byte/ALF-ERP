// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import customers from '../api/_routes/customers.js';

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
const MGR = { id: 'u1', role: 'branch_manager', branch: 'SLL', full_name: 'Mgr' };

test('lookup by phone uses digits only; returns contacts and balance', async () => {
    const calls = fake(STAFF, {
        '/rest/v1/customers?merged_into=is.null&phone_key=eq.96891234567': () => [{ id: 7, name: 'Ali Hassan', customer_no: 'C000007' }],
        '/rest/v1/customer_contacts': () => [{ id: 1, name: 'Fathima' }],
        '/rest/v1/customer_stats': () => [{ shipments: 3 }],
        '/rest/v1/invoices': () => [{ currency: 'OMR', balance: 2 }, { currency: 'OMR', balance: 3.5 }]
    });
    const r = res();
    await customers(req('GET', { query: { lookup: 'phone', value: '+968 9123 4567' } }), r);
    assert.equal(r.body.customer.customer_no, 'C000007');
    assert.deepEqual(r.body.customer.balance, [{ currency: 'OMR', amount: 5.5 }]);
    assert.equal(r.body.contacts.length, 1);
    assert.ok(calls.some(c => c.url.includes('phone_key=eq.96891234567')));
});

test('lookup ignores too-short values; civil ID is normalised', async () => {
    const calls = fake(STAFF);
    let r = res();
    await customers(req('GET', { query: { lookup: 'phone', value: '12' } }), r);
    assert.equal(r.body.customer, null);
    r = res();
    await customers(req('GET', { query: { lookup: 'civil', value: '1234-5678' } }), r);
    assert.ok(calls.some(c => c.url.includes('civil_key=eq.12345678')));
});

test('search builds name / phone / civil filters safely', async () => {
    const calls = fake(STAFF, { '/rest/v1/customers?merged_into=is.null&or=': () => [] });
    const r = res();
    await customers(req('GET', { query: { q: '9123 4567' } }), r);
    const u = calls.find(c => c.url.includes('/rest/v1/customers?')).url;
    assert.ok(u.includes('phone_key.like.*91234567*') && u.includes('name.ilike.*9123 4567*'));
});

test('save: staff cannot block; civil ID already used is refused', async () => {
    fake(STAFF, { '/rest/v1/customers?id=eq.7': () => [{ id: 7, merged_into: null }] });
    let r = res();
    await customers(req('POST', { body: { action: 'save', id: 7, blocked: true } }), r);
    assert.equal(r.code, 403);
    fake(STAFF, { '/rest/v1/customers?id=eq.7': () => [{ id: 7, merged_into: null }], 'civil_key=eq.X1234': () => [{ customer_no: 'C000002', name: 'Other' }] });
    r = res();
    await customers(req('POST', { body: { action: 'save', id: 7, civil_id: 'x-1234' } }), r);
    assert.match(r.body.error, /already belongs to C000002/);
});

test('merge is for managers and goes to the database function', async () => {
    fake(STAFF);
    let r = res();
    await customers(req('POST', { body: { action: 'merge', keep: 1, drop: 2 } }), r);
    assert.equal(r.code, 403);
    const calls = fake(MGR, { 'rpc/customer_merge': () => null });
    r = res();
    await customers(req('POST', { body: { action: 'merge', keep: '1', drop: '2' } }), r);
    assert.equal(r.body.success, true);
    assert.deepEqual(calls.find(c => c.url.includes('customer_merge')).body, { p_keep: 1, p_drop: 2, p_user_name: 'Mgr' });
});
