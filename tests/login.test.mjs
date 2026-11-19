// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import login from '../api/_routes/login.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const post = (body) => ({ method: 'POST', body, headers: {} });

// emp: the employees row (or null); good: the right password
function fake({ emp = null, good = 'secret', lockColsMissing = false } = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url, method: opts.method || 'GET', body });
        const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b });
        if (url.includes('/rest/v1/employees?username=') || url.includes('/rest/v1/employees?recovery_email=')) {
            if (lockColsMissing && url.includes('login_failed')) return json({ message: 'column does not exist' }, 400);
            return json(emp ? [emp] : []);
        }
        if (url.includes('/auth/v1/token')) return body.password === good ? json({ access_token: 't', user: { id: 'u1', app_metadata: {} } }) : json({ error_description: 'Invalid login credentials' }, 400);
        if (url.includes('/rest/v1/employees?id=eq.u1&select=*')) return json([{ ...(emp || {}), id: 'u1', role: 'staff' }]);
        return json([]);
    };
    return calls;
}
const EMP = { id: 'u1', recovery_email: 'ali@x.com', active: true, login_failed: 0, login_locked_until: null };

test('login: unknown username and wrong password give the same message', async () => {
    fake({ emp: null });
    let r = res(); await login(post({ username: 'nobody', password: 'x' }), r);
    assert.equal(r.code, 401); const unknown = r.body.error;
    fake({ emp: { ...EMP } });
    r = res(); await login(post({ username: 'ali', password: 'wrong' }), r);
    assert.equal(r.code, 401);
    assert.equal(r.body.error, unknown);
    assert.doesNotMatch(unknown, /not found/i);
});

test('login: wrong passwords are counted; the 5th locks for 15 minutes', async () => {
    let calls = fake({ emp: { ...EMP, login_failed: 2 } });
    let r = res(); await login(post({ username: 'ali', password: 'wrong' }), r);
    assert.equal(calls.find(c => c.method === 'PATCH').body.login_failed, 3);
    assert.match(r.body.error, /2 tries left/);
    calls = fake({ emp: { ...EMP, login_failed: 4 } });
    r = res(); await login(post({ username: 'ali', password: 'wrong' }), r);
    assert.equal(r.code, 429);
    const p = calls.find(c => c.method === 'PATCH').body;
    assert.equal(p.login_failed, 0);
    assert.ok(new Date(p.login_locked_until) > new Date(Date.now() + 14 * 60000));
});

test('login: a locked account is refused before the password is even tried', async () => {
    const calls = fake({ emp: { ...EMP, login_locked_until: new Date(Date.now() + 10 * 60000).toISOString() } });
    const r = res(); await login(post({ username: 'ali', password: 'secret' }), r);
    assert.equal(r.code, 429);
    assert.match(r.body.error, /Try again in \d+ minutes/);
    assert.ok(!calls.some(c => c.url.includes('/auth/v1/token')));
});

test('login: success resets the count; switched-off accounts cannot sign in', async () => {
    let calls = fake({ emp: { ...EMP, login_failed: 3 } });
    let r = res(); await login(post({ username: 'ali', password: 'secret' }), r);
    assert.equal(r.code, 200);
    assert.deepEqual(calls.find(c => c.method === 'PATCH').body, { login_failed: 0, login_locked_until: null });
    calls = fake({ emp: { ...EMP, active: false } });
    r = res(); await login(post({ username: 'ali', password: 'secret' }), r);
    assert.equal(r.code, 403);
    assert.ok(!calls.some(c => c.url.includes('/auth/v1/token')));
});

test('login: still works before the lock columns exist (migration not applied yet)', async () => {
    fake({ emp: { id: 'u1', recovery_email: 'ali@x.com', active: true }, lockColsMissing: true });
    const r = res(); await login(post({ username: 'ali', password: 'secret' }), r);
    assert.equal(r.code, 200);
});
