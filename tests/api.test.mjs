// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import dashboard from '../api/dashboard.js';
import integrations from '../api/integrations.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

// Fake Supabase: auth user + employee row + whatever `routes` answers.
function fakeSupabase(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
        calls.push({ url, opts });
        const json = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees')) return json(employee ? [employee] : []);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) return json(fn(url, opts));
        return json([]);
    };
    return calls;
}
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (method = 'GET', { query = {}, body } = {}) => ({ method, query, body, headers: { authorization: 'Bearer t' } });

test('dashboard: staff is locked to own branch and sees no revenue', async () => {
    const calls = fakeSupabase({ role: 'staff', branch: 'MCT' }, { 'rpc/dashboard_summary': () => ({ scope: 'MCT', revenue: [{ currency: 'OMR' }] }) });
    const r = res();
    await dashboard(req('GET', { query: { branch: 'SLL' } }), r);
    const rpc = calls.find(c => c.url.includes('rpc/dashboard_summary'));
    assert.deepEqual(JSON.parse(rpc.opts.body), { p_branch: 'MCT' }); // ?branch ignored for staff
    assert.equal(r.body.revenue, undefined);
    assert.equal(r.body.me.role, 'staff');
});

test('dashboard: admin can pick a branch and sees integrations', async () => {
    const calls = fakeSupabase({ role: 'super_admin' }, {
        'rpc/dashboard_summary': () => ({ scope: 'SLL', revenue: [] }),
        '/rest/v1/integrations': () => [{ name: 'DHL', active: true }]
    });
    const r = res();
    await dashboard(req('GET', { query: { branch: 'SLL' } }), r);
    assert.deepEqual(JSON.parse(calls.find(c => c.url.includes('rpc/')).opts.body), { p_branch: 'SLL' });
    assert.equal(r.body.integrations.length, 1);
});

test('dashboard: staff without branch is refused', async () => {
    fakeSupabase({ role: 'staff', branch: null });
    const r = res();
    await dashboard(req(), r);
    assert.equal(r.code, 403);
});

test('integrations: GET never returns secrets', async () => {
    fakeSupabase({ role: 'head_office' }, { '/rest/v1/integrations': () => [{ id: '1', name: 'DHL', secret: { api_key: 'SECRET', other: '' } }] });
    const r = res();
    await integrations(req(), r);
    assert.equal(JSON.stringify(r.body).includes('SECRET'), false);
    assert.deepEqual(r.body.integrations[0].secret_set, ['api_key']);
});

test('integrations: only super_admin can change; empty secret keeps stored value', async () => {
    fakeSupabase({ role: 'head_office' });
    const r1 = res();
    await integrations(req('PUT', { body: { id: '1' } }), r1);
    assert.equal(r1.code, 403);

    const calls = fakeSupabase({ role: 'super_admin' }, {
        '/rest/v1/integrations': (url, opts) => (opts.method === 'PATCH' ? [{ id: '1', name: 'DHL', secret: JSON.parse(opts.body).secret }] : [{ secret: { api_key: 'OLD' } }])
    });
    const r2 = res();
    await integrations(req('PUT', { body: { id: '1', name: 'DHL', kind: 'carrier', adapter: 'dhl', base_url: 'https://api-eu.dhl.com', secret: { api_key: '', account: 'A1' } } }), r2);
    const patch = calls.find(c => c.opts.method === 'PATCH');
    assert.deepEqual(JSON.parse(patch.opts.body).secret, { api_key: 'OLD', account: 'A1' });
    assert.equal(JSON.stringify(r2.body).includes('OLD'), false);
});

test('integrations: rejects non-https base URL', async () => {
    fakeSupabase({ role: 'super_admin' });
    const r = res();
    await integrations(req('POST', { body: { name: 'X', kind: 'other', adapter: 'generic_rest', base_url: 'http://10.0.0.1' } }), r);
    assert.equal(r.code, 400);
});
