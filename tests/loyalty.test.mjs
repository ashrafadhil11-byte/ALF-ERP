// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import customers from '../api/_routes/customers.js';
import accounts from '../api/_routes/accounts.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, method: opts.method || 'GET', body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: employee.id, email: 'a@b.c' });
        if (url.includes(`/rest/v1/employees?id=eq.${employee.id}&select`)) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts, body); return out?.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const post = (body) => ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali' };
const MANAGER = { id: 'u1', role: 'branch_manager', branch: 'ALFSNY', full_name: 'Sara' };
const ADMIN = { id: 'u1', role: 'head_office', branch: null, full_name: 'Boss' };

test('loyalty: staff cannot adjust points; managers can, with a reason, never below zero', async () => {
    fake(STAFF);
    let r = res(); await customers(post({ action: 'loyalty_adjust', id: 5, points: 50, note: 'goodwill' }), r);
    assert.equal(r.code, 403);
    const routes = { 'customers?id=eq.5': () => [{ id: 5 }], '/rpc/loyalty_status': () => ({ balance: 30 }), '/rest/v1/loyalty_ledger': () => [] };
    fake(MANAGER, routes);
    r = res(); await customers(post({ action: 'loyalty_adjust', id: 5, points: 50, note: '' }), r);
    assert.equal(r.code, 400);
    r = res(); await customers(post({ action: 'loyalty_adjust', id: 5, points: -40, note: 'mistake' }), r);
    assert.match(r.body.error, /only 30 points/);
    const calls = fake(MANAGER, routes);
    r = res(); await customers(post({ action: 'loyalty_adjust', id: 5, points: 20, note: 'goodwill' }), r);
    assert.equal(r.code, 200);
    const w = calls.find(c => c.method === 'POST' && c.url.includes('loyalty_ledger'));
    assert.deepEqual([w.body.kind, w.body.points, w.body.created_by_name], ['adjust', 20, 'Sara']);
});

test('loyalty: only head office changes settings; first tier must start at 0', async () => {
    fake(MANAGER);
    let r = res(); await customers(post({ action: 'loyalty_settings', active: true, tiers: [{ name: 'Silver', min: 0, bonus: 0 }] }), r);
    assert.equal(r.code, 403);
    fake(ADMIN);
    r = res(); await customers(post({ action: 'loyalty_settings', active: true, tiers: [{ name: 'Gold', min: 300, bonus: 25 }] }), r);
    assert.match(r.body.error, /start at 0/);
    const calls = fake(ADMIN, { 'loyalty_settings?id=eq.1': () => [] });
    r = res(); await customers(post({ action: 'loyalty_settings', active: true, earn_rate: { omr: 1, bad: 'x' }, point_value: { OMR: 0.01 }, min_redeem: 100, tiers: [{ name: 'Gold', min: 300, bonus: 25 }, { name: 'Silver', min: 0, bonus: 0 }] }), r);
    assert.equal(r.code, 200);
    const p = calls.find(c => c.method === 'PATCH').body;
    assert.deepEqual(p.earn_rate, { OMR: 1 });
    assert.deepEqual(p.tiers.map(t => t.name), ['Silver', 'Gold']);
});

test('loyalty: points are spent only on an invoice of your own branch', async () => {
    const calls = fake(STAFF, { 'invoices?id=eq.9': () => [{ id: 9, branch_code: 'ALFSLL' }] });
    let r = res(); await accounts(post({ action: 'loyalty_redeem', invoice_id: 9, points: 150 }), r);
    assert.notEqual(r.code, 200);
    assert.ok(!calls.some(c => c.url.includes('/rpc/loyalty_redeem')));
    const c2 = fake({ ...MANAGER, branch: 'ALFSLL' }, { 'invoices?id=eq.9': () => [{ id: 9, branch_code: 'ALFSLL' }], '/rpc/loyalty_redeem': () => ({ points: 150, amount: 1.5, currency: 'OMR', invoice_no: 'INV-1' }) });
    r = res(); await accounts(post({ action: 'loyalty_redeem', invoice_id: 9, points: '150.7' }), r);
    assert.equal(r.code, 200);
    assert.equal(c2.find(c => c.url.includes('/rpc/loyalty_redeem')).body.p_points, 150);
});
