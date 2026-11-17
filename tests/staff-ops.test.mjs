// Run: node --test tests/   — activity log, warehouse PIN, attendance
import test from 'node:test';
import assert from 'node:assert';
import { sanitize, withAudit } from '../api/_lib/audit.js';
import { hashPin, checkPin, signToken, readToken, validPin } from '../api/_lib/pin.js';
import warehouse from '../api/_routes/warehouse.js';
import attendance, { distanceM, insideFence, zonedIso, leaveDays } from '../api/_routes/attendance.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.WAREHOUSE_SECRET = 'test-secret';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, opts, body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u1&select=*')) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) { const out = fn(url, opts, body); return out?.__fail ? json(out.__fail, false) : json(out); }
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, headers: {}, status(c) { this.code = this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const req = (method, { query = {}, body, headers = {} } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t', ...headers } });

// ---------- activity log ----------
test('audit: passwords, PINs, keys and photos never reach the log', () => {
    const out = sanitize({ password: 'x', pin: '1234', current_pin: '1', api_key: 'k', pod_photo: 'data:image/png;base64,AAA', awb: 'A1', nested: { token: 't', note: 'ok' }, img: 'data:image/jpeg;base64,BB' });
    assert.deepEqual(out, { password: '[hidden]', pin: '[hidden]', current_pin: '[hidden]', api_key: '[hidden]', pod_photo: '[hidden]', awb: 'A1', nested: { token: '[hidden]', note: 'ok' }, img: '[file]' });
});

test('audit: a write is logged with who / what / result before the reply; reads are not', async () => {
    const jwt = 'h.' + Buffer.from(JSON.stringify({ sub: 'u9', email: 'ali@x.y' })).toString('base64url') + '.s';
    const calls = fake({}, { '/rest/v1/employees?id=eq.u9': () => [{ full_name: 'Ali', role: 'staff', branch: 'SLL' }] });
    const order = [];
    const r = res(); const orig = r.json.bind(r); r.json = (b) => { order.push('reply'); return orig(b); };
    const route = async (q, s) => s.status(403).json({ error: 'Only managers can do this.' });
    const rq = { method: 'POST', query: {}, body: { action: 'leave_decide', id: 7, pin: '9999' }, headers: { authorization: `Bearer ${jwt}`, 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
    globalThis.fetch = ((f) => async (u, o) => { if (String(u).includes('audit_log')) order.push('log'); return f(u, o); })(globalThis.fetch);
    await withAudit('attendance', route, rq, r);
    const row = calls.find(c => c.url.endsWith('/rest/v1/audit_log')).body;
    assert.deepEqual(order, ['log', 'reply']);
    assert.equal(row.user_name, 'Ali'); assert.equal(row.branch, 'SLL'); assert.equal(row.action, 'leave_decide'); assert.equal(row.target, '7');
    assert.equal(row.ok, false); assert.equal(row.status, 403); assert.equal(row.error, 'Only managers can do this.'); assert.equal(row.ip, '1.2.3.4');
    assert.equal(row.details.body.pin, '[hidden]');
    const before = calls.length;
    await withAudit('attendance', async (q, s) => s.json({ ok: 1 }), { method: 'GET', query: {}, headers: {} }, res());
    assert.equal(calls.slice(before).some(c => c.url.includes('audit_log')), false);
});

// ---------- warehouse PIN ----------
test('pin: hashed with salt, checked, token bound to user + warehouse and expires', () => {
    const h = hashPin('4826');
    assert.notEqual(h, hashPin('4826'));
    assert.ok(checkPin('4826', h)); assert.ok(!checkPin('4827', h)); assert.ok(!checkPin('4826', 'junk'));
    assert.ok(validPin('1234') && validPin('123456') && !validPin('123') && !validPin('12a4'));
    const { token } = signToken('u1', 'CWH');
    assert.equal(readToken(token, 'u1').warehouse, 'CWH');
    assert.equal(readToken(token, 'u2'), null);
    assert.equal(readToken(token.slice(0, -2) + 'xx', 'u1'), null);
    assert.equal(readToken(signToken('u1', 'CWH', -1).token, 'u1'), null);
});

const OP = { id: 'u1', role: 'staff', branch: 'SLL', full_name: 'Op', is_warehouse: true, warehouse_code: 'CWH', wh_pin_hash: null, wh_pin_failed: 0 };

test('warehouse: not an operator → refused; first visit sets a PIN (no 1234), then unlock gives a token', async () => {
    fake({ ...OP, is_warehouse: false });
    let r = res();
    await warehouse(req('POST', { body: { action: 'unlock', pin: '4826' } }), r);
    assert.equal(r.code, 403);

    let calls = fake(OP);
    r = res(); await warehouse(req('POST', { body: { action: 'set_pin', pin: '1234' } }), r);
    assert.equal(r.code, 400);
    r = res(); await warehouse(req('POST', { body: { action: 'set_pin', pin: '4826' } }), r);
    assert.ok(r.body.token);
    const saved = calls.find(c => c.opts.method === 'PATCH' && c.url.includes('employees')).body.wh_pin_hash;
    assert.ok(checkPin('4826', saved));

    // changing needs the current PIN
    fake({ ...OP, wh_pin_hash: saved });
    r = res(); await warehouse(req('POST', { body: { action: 'set_pin', pin: '7391' } }), r);
    assert.equal(r.code, 400);
    r = res(); await warehouse(req('POST', { body: { action: 'set_pin', pin: '7391', current_pin: '4826' } }), r);
    assert.equal(r.body.success, true);
});

test('warehouse: wrong PIN counts down, 5th locks for 15 min; operations need the token', async () => {
    const h = hashPin('4826');
    let calls = fake({ ...OP, wh_pin_hash: h, wh_pin_failed: 3 });
    let r = res(); await warehouse(req('POST', { body: { action: 'unlock', pin: '0000' } }), r);
    assert.equal(r.code, 401); assert.match(r.body.error, /1 tries left/);
    calls = fake({ ...OP, wh_pin_hash: h, wh_pin_failed: 4 });
    r = res(); await warehouse(req('POST', { body: { action: 'unlock', pin: '0000' } }), r);
    assert.match(r.body.error, /Locked for 15 minutes/);
    assert.ok(calls.find(c => c.opts.method === 'PATCH').body.wh_pin_locked_until);
    fake({ ...OP, wh_pin_hash: h, wh_pin_locked_until: new Date(Date.now() + 60e3).toISOString() });
    r = res(); await warehouse(req('POST', { body: { action: 'unlock', pin: '4826' } }), r);
    assert.equal(r.code, 423);   // even the right PIN waits out the lock

    fake({ ...OP, wh_pin_hash: h });
    r = res(); await warehouse(req('GET', { query: { view: 'requests' } }), r);
    assert.equal(r.code, 423);
    const { token } = signToken('u1', 'CWH');
    calls = fake({ ...OP, wh_pin_hash: h }, {
        '/rest/v1/stock_requests?id=eq.5': () => [{ id: 5, request_no: 'SRQ-SNY-000001', warehouse: 'CWH', branch_code: 'SNY', status: 'requested' }],
        '/rest/v1/stock_requests?id=eq.6': () => [{ id: 6, request_no: 'SRQ-SNY-000002', warehouse: 'OTHER', branch_code: 'SNY', status: 'requested' }],
        'rpc/stock_request_dispatch': () => ({ request_no: 'SRQ-SNY-000001', total: 7.5 })
    });
    r = res(); await warehouse(req('POST', { body: { action: 'dispatch', id: 5, lines: [{ product_id: 1, qty: 10 }] }, headers: { 'x-warehouse-token': token } }), r);
    assert.equal(r.body.total, 7.5);
    assert.equal(calls.find(c => c.url.includes('stock_request_dispatch')).body.p_user_name, 'Op');
    r = res(); await warehouse(req('POST', { body: { action: 'dispatch', id: 6, lines: [] }, headers: { 'x-warehouse-token': token } }), r);
    assert.equal(r.code, 404);   // another warehouse's request
    // a token for another warehouse does not open this one
    r = res(); await warehouse(req('GET', { query: { view: 'stock' }, headers: { 'x-warehouse-token': signToken('u1', 'XWH').token } }), r);
    assert.equal(r.code, 423);
});

// ---------- attendance ----------
test('attendance helpers: distance, fence with GPS accuracy, zone times, leave days', () => {
    const d = distanceM(23.5880, 58.3829, 23.5890, 58.3829);
    assert.ok(d > 105 && d < 117, String(d));
    const br = { lat: 23.588, lng: 58.3829, geofence_m: 100 };
    assert.equal(insideFence(br, 23.5890, 58.3829, 5).ok, false);
    assert.equal(insideFence(br, 23.5890, 58.3829, 30).ok, true);
    assert.equal(insideFence(br, 23.60, 58.3829, 5000).ok, false);   // bad accuracy capped
    assert.equal(insideFence({}, 1, 1, 0).unset, true);
    assert.equal(zonedIso('2026-11-17', '09:00', 'Asia/Muscat'), '2026-11-17T05:00:00.000Z');
    assert.equal(zonedIso('2026-11-17', '09:00', 'Asia/Kolkata'), '2026-11-17T03:30:00.000Z');
    assert.equal(leaveDays('2026-11-17', '2026-11-19'), 3);
});

const STAFF = { id: 'u1', role: 'staff', branch: 'SLL', full_name: 'Ali' };
const MGR = { id: 'u1', role: 'branch_manager', branch: 'SLL', full_name: 'Mgr' };
const BRANCH = { '/rest/v1/branches?branch_code=eq.SLL': () => [{ branch_code: 'SLL', branch_name: 'Salalah', lat: 17.0151, lng: 54.0924, geofence_m: 200, timezone: 'Asia/Muscat' }] };

test('attendance: check-in refused away from the branch, accepted inside it', async () => {
    let calls = fake(STAFF, { ...BRANCH, 'rpc/attendance_punch': () => ({ id: 1, check_in: new Date().toISOString(), late_min: 0 }) });
    let r = res();
    await attendance(req('POST', { body: { action: 'punch', kind: 'in', lat: 23.588, lng: 58.38, accuracy: 10 } }), r);
    assert.equal(r.code, 403); assert.match(r.body.error, /km from Salalah/);
    r = res();
    await attendance(req('POST', { body: { action: 'punch', kind: 'in' } }), r);
    assert.equal(r.code, 400);   // branch has a location, so GPS is required
    r = res();
    await attendance(req('POST', { body: { action: 'punch', kind: 'in', lat: 17.0155, lng: 54.0924, accuracy: 15 } }), r);
    assert.equal(r.body.success, true);
    const p = calls.find(c => c.url.includes('attendance_punch')).body;
    assert.deepEqual([p.p_emp, p.p_kind, p.p_branch], ['u1', 'in', 'SLL']);
    assert.ok(p.p_distance < 60);
});

test('attendance: staff cannot see reports or approve; managers cannot approve their own leave or edit other branches', async () => {
    fake(STAFF);
    let r = res(); await attendance(req('GET', { query: { view: 'report' } }), r);
    assert.equal(r.code, 403);
    fake(MGR, { '/rest/v1/leave_requests?id=eq.3': () => [{ id: 3, employee_id: 'u1', branch_code: 'SLL', status: 'pending' }] });
    r = res(); await attendance(req('POST', { body: { action: 'leave_decide', id: 3, decision: 'approved' } }), r);
    assert.equal(r.code, 403);
    fake(MGR, { '/rest/v1/employees?id=eq.e2': () => [{ id: 'e2', full_name: 'X', branch: 'MCT' }] });
    r = res(); await attendance(req('POST', { body: { action: 'manual', employee_id: 'e2', date: '2026-11-17', check_in: '09:00', reason: 'x' } }), r);
    assert.equal(r.code, 403);
});

test('attendance: manager correction converts branch local time; leave clash is refused; report sums per person + CSV', async () => {
    let calls = fake(MGR, { ...BRANCH, '/rest/v1/employees?id=eq.e2': () => [{ id: 'e2', full_name: 'Sara', branch: 'SLL' }], 'rpc/attendance_set': () => ({ id: 9 }) });
    let r = res();
    await attendance(req('POST', { body: { action: 'manual', employee_id: 'e2', date: '2026-11-17', check_in: '22:00', check_out: '06:00', reason: 'night shift, phone off' } }), r);
    const s = calls.find(c => c.url.includes('attendance_set')).body;
    assert.equal(s.p_in, '2026-11-17T18:00:00.000Z');
    assert.equal(s.p_out, '2026-11-18T02:00:00.000Z');   // ends the next morning
    assert.equal(s.p_user_name, 'Mgr');

    fake(STAFF, { '/rest/v1/leave_requests?employee_id=eq.u1&status=in.': () => [{ id: 1 }] });
    r = res(); await attendance(req('POST', { body: { action: 'leave_request', leave_type: 'annual', from_date: '2026-12-01', to_date: '2026-12-03' } }), r);
    assert.match(r.body.error, /already have leave/);

    const rows = [
        { employee_id: 'e2', full_name: 'Sara', branch: 'SLL', work_date: '2026-11-16', status: 'late', check_in: '2026-11-16T05:20:00Z', check_out: '2026-11-16T14:00:00Z', late_min: 20, early_min: 0, overtime_min: 0, worked_min: 520, leave_type: null, edited: false },
        { employee_id: 'e2', full_name: 'Sara', branch: 'SLL', work_date: '2026-11-17', status: 'absent', check_in: null, check_out: null, late_min: 0, early_min: 0, overtime_min: 0, worked_min: 0, leave_type: null, edited: false }
    ];
    calls = fake(MGR, { 'rpc/attendance_report': () => rows });
    r = res(); await attendance(req('GET', { query: { view: 'report', from: '2026-11-16', to: '2026-11-17', branch: 'MCT' } }), r);
    assert.deepEqual(r.body.summary[0], { employee_id: 'e2', full_name: 'Sara', branch: 'SLL', present: 0, late: 1, absent: 1, leave: 0, off: 0, late_min: 20, early_min: 0, overtime_min: 0, worked_min: 520 });
    assert.equal(calls.find(c => c.url.includes('attendance_report')).body.p_branch, 'SLL');   // a manager only sees their branch
    r = res(); await attendance(req('GET', { query: { view: 'report', from: '2026-11-16', to: '2026-11-17', format: 'csv' } }), r);
    assert.match(r.headers['Content-Type'], /text\/csv/);
    assert.match(r.body, /Sara,SLL,2026-11-16,late,09:20,18:00,20,0,0,8.67/);
});
