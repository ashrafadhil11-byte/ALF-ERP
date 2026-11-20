// Run: node --test tests/
// Farah as a personal assistant: to-dos, leave decisions, the daily check-in.
import test from 'node:test';
import assert from 'node:assert';
import todos from '../api/_routes/todos.js';
import { propose, runProposal } from '../api/_lib/ai-tasks.js';
import { checkIn, checkInText } from '../api/_lib/farah.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali Hassan' };
const MANAGER = { id: 'u2', role: 'branch_manager', branch: 'ALFSNY', full_name: 'Mona Saleh' };
const session = (e) => ({ user: { id: e.id }, role: e.role, branch: e.branch, employee: e });

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
const call = async (body, method = 'POST') => { const r = res(); await todos({ method, query: {}, body, headers: { authorization: 'Bearer t' } }, r); return r; };

test('to-dos: each user only touches their own list; links stay inside the ERP', async () => {
    const calls = fake(STAFF, { '/rest/v1/todos': (u, o, b, m) => m === 'POST' ? [{ id: 7, employee_id: 'u1', ...b }] : [{ id: 7, title: 'x' }] });
    let r = await call({ action: 'add', title: '  Call DHL  ', due_date: '2026-11-21', link: 'https://evil.example' });
    assert.equal(r.code, 200);
    const add = calls.find(c => c.method === 'POST' && c.url.endsWith('/todos')).body;
    assert.deepEqual([add.employee_id, add.title, add.due_date, add.link, add.source], ['u1', 'Call DHL', '2026-11-21', null, 'me']);
    assert.equal(r.body.todo.employee_id, undefined);
    r = await call({ action: 'add', title: 'See shipment', link: 'shipments.html?awb=311000045' });
    assert.equal(calls.filter(c => c.method === 'POST' && c.url.endsWith('/todos')).at(-1).body.link, 'shipments.html?awb=311000045');
    r = await call({ action: 'done', id: 7 });
    const done = calls.find(c => c.method === 'PATCH');
    assert.ok(done.url.includes('id=eq.7') && done.url.includes('employee_id=eq.u1') && done.body.done_at);
    r = await call({ action: 'add', title: '   ' });
    assert.equal(r.code, 400);
    // someone else's to-do: nothing matches → not found
    fake(STAFF, { '/rest/v1/todos': () => [] });
    r = await call({ action: 'delete', id: 99 });
    assert.equal(r.code, 404);
});

test('leave: managers only, not their own; the card names who and when; Confirm goes through Attendance', async () => {
    fake(STAFF);
    await assert.rejects(propose('leave_decide', { employee: 'Ali', decision: 'approved' }, session(STAFF)), /Only managers/);
    const rows = [{ id: 4, employee_id: 'u1', leave_type: 'Annual', from_date: '2026-11-22', to_date: '2026-11-24', reason: 'Family', branch_code: 'ALFSNY' },
                  { id: 5, employee_id: 'u2', leave_type: 'Sick', from_date: '2026-11-21', to_date: '2026-11-21', branch_code: 'ALFSNY' }];
    let calls = fake(MANAGER, {
        'leave_requests?status=eq.pending': (u) => { assert.ok(u.includes('branch_code=eq.ALFSNY')); return rows; },
        'employees?id=in.': () => [{ id: 'u1', full_name: 'Ali Hassan' }, { id: 'u2', full_name: 'Mona Saleh' }]
    });
    const p = await propose('leave_decide', { employee: 'ali', decision: 'approved' }, session(MANAGER));
    assert.deepEqual(p.payload, { action: 'leave_decide', id: 4, decision: 'approved', note: undefined });
    assert.match(p.title, /Approve Ali Hassan's leave/);
    assert.match(p.lines[0], /Annual · 2026-11-22 → 2026-11-24/);
    // her own request is not offered
    await assert.rejects(propose('leave_decide', { employee: 'mona', decision: 'approved' }, session(MANAGER)), /No pending leave request from mona/);
    calls = fake(MANAGER, { 'leave_requests?id=eq.4': () => [{ ...rows[0], status: 'pending' }] });
    const out = await runProposal({ kind: 'leave_decide', payload: p.payload }, session(MANAGER), 'Bearer t');
    assert.match(out.message, /1 leave request approved/);
    assert.ok(calls.some(c => c.method === 'PATCH' && c.url.includes('leave_requests?id=eq.4') && c.body.status === 'approved'));
    assert.ok(calls.some(c => c.url.includes('audit_log') && c.body?.route === 'attendance'));
});

test('check-in: lists what is waiting with a question; nothing waiting → no message', () => {
    const t = checkInText('Muhammed Adhil', {
        leave: [{ employee: 'Ali Hassan', from: '2026-11-22', to: '2026-11-24' }, { employee: 'Sara K', from: '2026-11-25', to: '2026-11-25' }],
        items: [{ kind: 'request', title: 'Payment request from Sohar', detail: 'OMR 45.000', link: '/app/main-office?tab=approvals', needs_pin: true }],
        todos: [{ title: 'Call DHL', overdue: true }]
    });
    assert.match(t, /Muhammed!/);
    assert.match(t, /2 leave requests — Ali \(22 Nov–24 Nov\), Sara \(25 Nov\)/);
    assert.match(t, /\/app\/main-office\?tab=approvals/);
    assert.match(t, /Shall I approve the leave requests/);
    assert.match(t, /need your PIN/);
    assert.match(t, /1 to-do: Call DHL \(some overdue\)/);
    assert.equal(checkInText('A', { leave: [], items: [], todos: [] }), null);
});

test('check-in: sent once a day — the day is claimed before the message', async () => {
    let claimed = false;
    const calls = fake(MANAGER, {
        'chat_threads?direct_key=eq.ai:u2': () => [{ id: 12, ai_checkin_on: null }],
        'chat_threads?id=eq.12&or=': () => { if (claimed) return []; claimed = true; return [{ id: 12 }]; },
        '/rest/v1/todos': () => [{ id: 1, title: 'Send the manifest', due_date: null, done_at: null }],
        '/rest/v1/chat_messages': (u, o, b, m) => m === 'POST' ? [{ id: 50, ...b, created_at: 'now' }] : []
    });
    const realHours = Date.prototype.getUTCHours;
    Date.prototype.getUTCHours = function () { return 6; };          // 6 am Oman
    try {
        await checkIn(session(MANAGER), 'Bearer t');
        await checkIn(session(MANAGER), 'Bearer t');                    // same day: nothing more
    } finally { Date.prototype.getUTCHours = realHours; }
    const msgs = calls.filter(c => c.url.endsWith('/chat_messages') && c.method === 'POST');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].body.body, /Good morning, Mona!.*\n• 1 to-do: Send the manifest/s);
    assert.equal(msgs[0].body.sender_name, 'Farah');
});
