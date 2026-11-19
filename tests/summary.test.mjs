// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import summary, { totalOf } from '../api/_routes/summary.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const DAY = (branch, x = {}) => ({ day: '2026-11-19', branch, bookings: 2, kg: 10, invoiced: { OMR: 5 }, received: { 'OMR cash': 4 }, expenses: {}, cash_closed: false, delivered: 1, delivery_failed: 0,
    pickups: 0, pickups_done: 0, pickups_open: 0, exceptions: 0, waiting: { cargo_in: 1, cash_in: 0, payment_requests: 0, materials_in: 0 }, unpaid: { OMR: 1.5 }, unpaid_count: 1, ...x });
function fake(employee, extra = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, method: opts.method || 'GET', body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (employee && url.includes('/rest/v1/employees?id=eq.u1&select')) return json([employee]);
        if (url.includes('/rest/v1/branches?')) return json([{ branch_code: 'ALFSLL', branch_name: 'Salalah' }, { branch_code: 'ALFSNY', branch_name: 'Sannayya' }]);
        if (url.includes('/rpc/daily_summary')) return json(DAY(body.p_branch, extra[body.p_branch] || {}));
        return json([]);
    };
    return calls;
}

test('summary: staff are refused; a manager gets only their branch', async () => {
    fake({ id: 'u1', role: 'staff', branch: 'ALFSNY' });
    let r = res(); await summary({ method: 'GET', query: {}, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 403);
    const calls = fake({ id: 'u1', role: 'branch_manager', branch: 'ALFSNY' });
    r = res(); await summary({ method: 'GET', query: { branch: 'ALFSLL' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.branches.map(b => b.branch), ['ALFSNY']);
    assert.equal(r.body.total, null);
    assert.deepEqual(calls.filter(c => c.url.includes('daily_summary')).map(c => c.body.p_branch), ['ALFSNY']);
});

test('summary: head office gets every branch and the company total', async () => {
    fake({ id: 'u1', role: 'head_office' }, { ALFSNY: { cash_closed: true } });
    const r = res(); await summary({ method: 'GET', query: { date: '2026-11-18' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.body.branches.length, 2);
    assert.equal(r.body.total.bookings, 4);
    assert.deepEqual(r.body.total.received, { 'OMR cash': 8 });
    assert.deepEqual(r.body.total.cash_not_closed, ['ALFSLL']);
    assert.equal(r.body.total.waiting.cargo_in, 2);
});

test('summary: the evening job needs the cron key and saves every branch + the company', async () => {
    process.env.CRON_SECRET = 'cron-key';
    let calls = fake(null);
    let r = res(); await summary({ method: 'GET', query: {}, headers: { authorization: 'Bearer wrong' } }, r);
    assert.equal(r.code, 401);                           // falls through to the user check and fails
    calls = fake(null);
    r = res(); await summary({ method: 'GET', query: {}, headers: { authorization: 'Bearer cron-key' } }, r);
    assert.equal(r.code, 200);
    const saved = calls.find(c => c.method === 'POST' && c.url.includes('daily_summaries')).body;
    assert.deepEqual(saved.map(x => x.branch_code), ['ALFSLL', 'ALFSNY', null]);
    assert.ok(calls.some(c => c.method === 'DELETE' && c.url.includes('daily_summaries?day=eq.')));
    delete process.env.CRON_SECRET;
});

test('summary: totals add currencies separately', () => {
    const t = totalOf([DAY('A', { invoiced: { OMR: 5, INR: 100 } }), DAY('B', { invoiced: { OMR: 2.5 } })], '2026-11-19');
    assert.deepEqual(t.invoiced, { OMR: 7.5, INR: 100 });
});
