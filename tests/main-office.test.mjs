// Run: node --test tests/   — Main Office money: who may open it, the PIN, and Accounts never touching its books
import test from 'node:test';
import assert from 'node:assert';
import { hashPin, signToken } from '../api/_lib/pin.js';
import mainOffice from '../api/_routes/main-office.js';
import warehouse from '../api/_routes/warehouse.js';
import accounts from '../api/_routes/accounts.js';
import users from '../api/_routes/users.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.WAREHOUSE_SECRET = 'test-secret';
const PIN = hashPin('4826');
const MO = [{ branch_code: 'HO', branch_name: 'Main Office', currency: 'OMR' }];

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, opts, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u1&select=*')) return json([employee]);
        if (url.includes('branches?branch_type=eq.main_office')) return json(MO);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) return json(fn(url, opts, body));
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method, { query = {}, body, headers = {} } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t', ...headers } });
const staff = { id: 'u1', full_name: 'Sam', role: 'staff', branch: 'SNY', active: true };
const cashier = { ...staff, role: 'branch_manager', is_cashier: true, wh_pin_hash: PIN };
const boss = { id: 'u1', full_name: 'Boss', role: 'super_admin', branch: null, active: true, wh_pin_hash: PIN };

test('main office: only cashiers and the super admin get in', async () => {
    fake(staff);
    let r = res(); await mainOffice(req('GET', { query: { view: 'status' } }), r);
    assert.equal(r.body.access, false);
    r = res(); await mainOffice(req('POST', { body: { action: 'unlock', pin: '4826' } }), r);
    assert.equal(r.code, 403);
    fake({ ...staff, role: 'head_office' });   // head office is not enough on its own
    r = res(); await mainOffice(req('GET', { query: { view: 'overview' } }), r);
    assert.equal(r.code, 403);
});

test('main office: locked until the PIN is entered; the unlock works only for Main Office', async () => {
    fake(cashier);
    let r = res(); await mainOffice(req('GET', { query: { view: 'overview' } }), r);
    assert.equal(r.code, 423);
    r = res(); await mainOffice(req('POST', { body: { action: 'unlock', pin: '1111' } }), r);
    assert.equal(r.code, 401);
    r = res(); await mainOffice(req('POST', { body: { action: 'unlock', pin: '4826' } }), r);
    assert.equal(r.code, 200);
    const token = r.body.token;
    r = res(); await mainOffice(req('GET', { query: { view: 'overview' }, headers: { 'x-office-token': token } }), r);
    assert.equal(r.code, 200);
    // a warehouse unlock does not open Main Office, and the Main Office unlock does not open a warehouse
    r = res(); await mainOffice(req('GET', { query: { view: 'overview' }, headers: { 'x-office-token': signToken('u1', 'CWH').token } }), r);
    assert.equal(r.code, 423);
    fake({ ...cashier, is_warehouse: true, warehouse_code: 'CWH' });
    r = res(); await warehouse(req('GET', { query: { view: 'stock' }, headers: { 'x-warehouse-token': token } }), r);
    assert.equal(r.code, 423);
});

test('super admin: opens Main Office and any warehouse, but only with their own PIN', async () => {
    fake(boss);
    let r = res(); await mainOffice(req('POST', { body: { action: 'unlock', pin: '4826' } }), r);
    assert.equal(r.code, 200);
    fake(boss, { 'branch_type=eq.warehouse': () => [{ branch_code: 'CWH', branch_name: 'Central Warehouse', currency: 'OMR' }] });
    r = res(); await warehouse(req('GET', { query: { view: 'status' } }), r);
    assert.equal(r.body.access, true);
    assert.equal(r.body.warehouse, 'CWH');
    r = res(); await warehouse(req('POST', { body: { action: 'unlock', pin: '0000', warehouse: 'CWH' } }), r);
    assert.equal(r.code, 401);
    r = res(); await warehouse(req('POST', { body: { action: 'unlock', pin: '4826', warehouse: 'CWH' } }), r);
    assert.equal(r.code, 200);
    const token = r.body.token;
    r = res(); await warehouse(req('GET', { query: { view: 'purchases' }, headers: { 'x-warehouse-token': token } }), r);
    assert.equal(r.code, 200);
});

test('accounts: never writes to the Main Office books, nor undoes what Main Office paid', async () => {
    fake({ ...boss, role: 'head_office' }, { 'expenses?id=eq.9': () => [{ id: 9, branch_code: 'SNY', paid_from_branch: 'HO' }] });
    let r = res(); await accounts(req('POST', { body: { action: 'expense', branch: 'HO', account_code: '5200', amount: 5, method: 'cash' } }), r);
    assert.equal(r.code, 403);
    r = res(); await accounts(req('POST', { body: { action: 'expense_void', id: 9, reason: 'x' } }), r);
    assert.equal(r.code, 403);
    r = res(); await accounts(req('GET', { query: { view: 'cash', branch: 'HO' } }), r);
    assert.equal(r.code, 403);
});

test('a branch sends cash to Main Office: no expense, only a transfer', async () => {
    const calls = fake({ ...staff, role: 'branch_manager' }, { 'branches?branch_code=eq.SNY': () => [{ branch_code: 'SNY', currency: 'OMR' }], '/rpc/money_transfer': () => ({ id: 1, transfer_no: 'TRF-SNY-000001', status: 'sent' }) });
    const r = res(); await accounts(req('POST', { body: { action: 'cash_send', amount: 50, from_account: '1000' } }), r);
    assert.equal(r.code, 200);
    const call = calls.find(c => c.url.includes('/rpc/money_transfer')).body;
    assert.deepEqual([call.p_from_branch, call.p_to_branch, call.p_to_account, call.p_amount], ['SNY', 'HO', '1000', 50]);
    assert.equal(calls.some(c => c.url.includes('expense_record')), false);
});

test('only the super admin can make someone a Main Office cashier', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    fake({ ...boss, role: 'head_office' }, { [`employees?id=eq.${id}`]: () => [{ id, role: 'staff', branch: 'SNY' }] });
    const r = res(); await users(req('PATCH', { body: { id, is_cashier: true } }), r);
    assert.equal(r.code, 403);
});
