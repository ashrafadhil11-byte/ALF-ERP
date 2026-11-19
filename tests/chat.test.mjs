// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import chat from '../api/_routes/chat.js';
import notifications from '../api/_routes/notifications.js';
import { withAudit } from '../api/_lib/audit.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const ME = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222';

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;   // uploads are binary
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
const req = (method, { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });
const STAFF = { id: ME, role: 'staff', branch: 'ALFSNY', full_name: 'Ali' };

test('chat: only members can read or write a chat', async () => {
    const calls = fake(STAFF, { 'chat_threads?id=eq.9': () => [] });     // not a member → no row
    let r = res();
    await chat(req('GET', { query: { thread: '9' } }), r);
    assert.equal(r.code, 404);
    r = res();
    await chat(req('POST', { body: { action: 'send', thread: 9, body: 'hi' } }), r);
    assert.equal(r.code, 404);
    assert.ok(!calls.some(c => c.method === 'POST' && c.url.includes('chat_messages')), 'nothing was written');
    // the membership check filters on the signed-in user
    assert.ok(calls.some(c => c.url.includes(`chat_members.employee_id=eq.${ME}`)));
});

test('chat: send trims, refuses empty / too long, writes as the signed-in user', async () => {
    const calls = fake(STAFF, {
        'chat_threads?id=eq.5': () => [{ id: 5, kind: 'direct', chat_members: [{ employee_id: ME }] }],
        '/rest/v1/chat_messages': (u, o, b) => o.method === 'POST' ? [{ id: 77, ...b }] : []
    });
    let r = res();
    await chat(req('POST', { body: { action: 'send', thread: 5, body: '   ' } }), r);
    assert.equal(r.code, 400);
    r = res();
    await chat(req('POST', { body: { action: 'send', thread: 5, body: 'x'.repeat(4001) } }), r);
    assert.equal(r.code, 400);
    r = res();
    await chat(req('POST', { body: { action: 'send', thread: 5, body: '  hello \r\n there  ', sender_id: OTHER } }), r);
    assert.equal(r.code, 200);
    const w = calls.find(c => c.method === 'POST' && c.url.includes('chat_messages'));
    assert.equal(w.body.body, 'hello \n there');
    assert.equal(w.body.sender_id, ME);           // never taken from the request
    assert.equal(w.body.sender_name, 'Ali');
});

test('chat: delete only your own message; direct chat with yourself refused', async () => {
    fake(STAFF, { 'chat_messages?id=eq.3&sender_id': () => [] });
    let r = res();
    await chat(req('POST', { body: { action: 'delete', id: 3 } }), r);
    assert.equal(r.code, 403);
    fake(STAFF, { '/rpc/chat_direct': () => ({ __fail: { message: 'Choose someone else to chat with.' } }) });
    r = res();
    await chat(req('POST', { body: { action: 'direct', user_id: ME } }), r);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /someone else/);
});

test('chat: messages never reach the activity log', async () => {
    const calls = fake(STAFF, {
        'chat_threads?id=eq.5': () => [{ id: 5, kind: 'direct', chat_members: [{ employee_id: ME }] }],
        '/rest/v1/chat_messages': (u, o, b) => o.method === 'POST' ? [{ id: 1, ...b }] : []
    });
    const r = res();
    await withAudit('chat', chat, req('POST', { body: { action: 'send', thread: 5, body: 'private' } }), r);
    assert.equal(r.code, 200);
    assert.ok(!calls.some(c => c.url.includes('audit_log')));
});

test('notifications: cash, payment requests and confirmations go to the right people', async () => {
    const CASHIER = { id: ME, role: 'staff', branch: 'ALFSNY', full_name: 'Ali', is_cashier: true };
    const calls = fake(CASHIER, {
        'branches?branch_type=eq.main_office': () => [{ branch_code: 'ALFHO' }],
        'cash_transfers?status=eq.sent': () => [{ id: 1, transfer_no: 'TRF-1', from_branch: 'ALFSLL', to_branch: 'ALFHO', currency: 'OMR', amount: 85, sent_at: new Date().toISOString(), sent_by_name: 'Salim' },
                                                 { id: 2, transfer_no: 'TRF-2', from_branch: 'ALFHO', to_branch: 'ALFSNY', currency: 'OMR', amount: 10, sent_at: new Date().toISOString(), sent_by_name: 'Ali' }],
        'cash_transfers?status=eq.received': () => [{ id: 3, transfer_no: 'TRF-3', from_branch: 'ALFSNY', to_branch: 'ALFHO', currency: 'OMR', amount: 50, received_amount: 49.5, received_at: new Date().toISOString(), received_by_name: 'Adhil' }],
        'payment_requests?status=eq.requested': () => [{ id: 4, request_no: 'PRQ-4', branch_code: 'ALFTMT', currency: 'OMR', amount: 180, requested_at: new Date().toISOString(), requested_by_name: 'Sara' }]
    });
    const r = res();
    await notifications(req('GET'), r);
    const ids = r.body.items.map(i => i.id);
    assert.ok(ids.includes('cs-1'), 'cash coming to Main Office reaches the cashier');
    assert.ok(!ids.includes('cs-2'), 'own action left out');
    assert.ok(ids.includes('cr-3') && r.body.items.find(i => i.id === 'cr-3').body.includes('short OMR 0.500'));
    assert.equal(r.body.items.find(i => i.id === 'pq-4').href, 'main-office.html?tab=approvals');
    // the cash queries are limited to this user's locations
    assert.ok(calls.some(c => c.url.includes('cash_transfers?status=eq.sent') && c.url.includes('to_branch=in.(ALFSNY,ALFHO)')));
});

test('notifications: a branch user does not see Main Office payment requests', async () => {
    const calls = fake(STAFF, {});
    const r = res();
    await notifications(req('GET'), r);
    assert.equal(r.code, 200);
    assert.ok(!calls.some(c => c.url.includes('payment_requests?status=eq.requested')));
    assert.ok(!calls.some(c => c.url.includes('branch_type=eq.main_office')));
});

test('chat: files must be a photo or PDF up to 3 MB; a shipment card needs a real shipment', async () => {
    const routes = { 'chat_threads?id=eq.5': () => [{ id: 5, kind: 'direct', chat_members: [{ employee_id: ME }] }], '/rest/v1/chat_messages': (u, o, b) => o.method === 'POST' ? [{ id: 9, ...b }] : [], 'bookings?awb=eq.': () => [] };
    let calls = fake(STAFF, routes);
    let r = res(); await chat(req('POST', { body: { action: 'send', thread: 5, file: { name: 'a.exe', data: 'data:application/x-msdownload;base64,AAAA' } } }), r);
    assert.equal(r.code, 400);
    r = res(); await chat(req('POST', { body: { action: 'send', thread: 5, file: { name: 'big.pdf', data: 'data:application/pdf;base64,' + Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64') } } }), r);
    assert.match(r.body.error, /too large/);
    r = res(); await chat(req('POST', { body: { action: 'send', thread: 5, awb: '311000099' } }), r);
    assert.match(r.body.error, /not found/);
    assert.ok(!calls.some(c => c.method === 'POST' && c.url.includes('chat_messages')));
    calls = fake(STAFF, { ...routes, 'bookings?awb=eq.': (u) => u.includes('311000001') ? [{ awb: '311000001' }] : [], '/storage/v1/object/chat-files/': () => ({ Key: 'x' }) });
    r = res(); await chat(req('POST', { body: { action: 'send', thread: 5, awb: '311000001', file: { name: 'pod.png', data: 'data:image/png;base64,iVBORw0KGgo=' } } }), r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const w = calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/chat_messages')).body;
    assert.equal(w.awb, '311000001');
    assert.equal(w.file_type, 'image/png');
    assert.ok(w.file_path.startsWith('5/'));
});
