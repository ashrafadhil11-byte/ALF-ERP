// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import { getSession, requireSession, normalizeRole, ADMIN_ROLES } from '../api/_lib/auth.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function mockFetch({ userOk = true, user = { id: 'u1', user_metadata: { role: 'super_admin' } }, emp = [] } = {}) {
    globalThis.fetch = async (url) => url.includes('/auth/v1/user')
        ? { ok: userOk, json: async () => user }
        : { ok: true, json: async () => emp };
}
const res = () => ({ code: 0, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (auth = 'Bearer tok') => ({ headers: { authorization: auth } });

test('normalizeRole maps legacy names and rejects unknown', () => {
    assert.equal(normalizeRole('employee'), 'staff');
    assert.equal(normalizeRole('branch_admin'), 'branch_manager');
    assert.equal(normalizeRole('Super_Admin'), 'super_admin');
    assert.equal(normalizeRole('hacker'), null);
});

test('rejects missing / invalid token', async () => {
    mockFetch({ userOk: false });
    assert.equal(await getSession(req('')), null);
    assert.equal(await getSession(req()), null);
});

test('ignores user_metadata role (user-editable)', async () => {
    mockFetch({ emp: [] }); // no employee row, only user_metadata says super_admin
    assert.equal(await getSession(req()), null);
});

test('role from employees row; requireSession enforces roles', async () => {
    mockFetch({ emp: [{ role: 'employee', branch: 'MCT' }] });
    const s = await getSession(req());
    assert.deepEqual([s.role, s.branch], ['staff', 'MCT']);
    const r = res();
    assert.equal(await requireSession(req(), r, ADMIN_ROLES), null);
    assert.equal(r.code, 403);
});

test('app_metadata role works when no employee row', async () => {
    mockFetch({ user: { id: 'u1', app_metadata: { role: 'head_office' } } });
    assert.equal((await requireSession(req(), res(), ADMIN_ROLES)).role, 'head_office');
});
