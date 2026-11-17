// Run: node --test tests/   — check-in reminders, work hours, faster session check
import test from 'node:test';
import assert from 'node:assert';
import { remindFor } from '../api/_routes/attendance.js';
import { getSession, forgetSessions } from '../api/_lib/auth.js';
import users from '../api/_routes/users.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const SHIFT = { start: '09:00', end: '18:00', grace_min: 10, weekly_off: [5] };
const at = (iso) => new Date(iso);   // times below are Muscat (UTC+4): 05:00Z = 09:00 local

test('reminder: check in from 15 min before the shift until it ends; check out after it ends', () => {
    const tz = 'Asia/Muscat';
    // Tue 17 Nov 2026
    assert.equal(remindFor({ record: null, shift: SHIFT, tz, at: at('2026-11-17T04:30:00Z') }), null);          // 08:30 too early
    assert.equal(remindFor({ record: null, shift: SHIFT, tz, at: at('2026-11-17T04:46:00Z') }), 'in');          // 08:46
    assert.equal(remindFor({ record: null, shift: SHIFT, tz, at: at('2026-11-17T10:00:00Z') }), 'in');          // 14:00 still not in
    assert.equal(remindFor({ record: null, shift: SHIFT, tz, at: at('2026-11-17T15:00:00Z') }), null);          // 19:00 shift over
    const inOnly = { check_in: '2026-11-17T05:00:00Z' };
    assert.equal(remindFor({ record: inOnly, shift: SHIFT, tz, at: at('2026-11-17T12:00:00Z') }), null);        // working
    assert.equal(remindFor({ record: inOnly, shift: SHIFT, tz, at: at('2026-11-17T14:15:00Z') }), 'out');       // 18:15
    assert.equal(remindFor({ record: { ...inOnly, check_out: 'x' }, shift: SHIFT, tz, at: at('2026-11-17T14:15:00Z') }), null);
    // Friday off, leave
    assert.equal(remindFor({ record: null, shift: SHIFT, tz, at: at('2026-11-20T06:00:00Z') }), null);
    assert.equal(remindFor({ record: null, shift: SHIFT, tz, onLeave: true, at: at('2026-11-17T06:00:00Z') }), null);
    // night shift 22:00–06:00
    assert.equal(remindFor({ record: null, shift: { ...SHIFT, start: '22:00', end: '06:00' }, tz, at: at('2026-11-17T17:50:00Z') }), 'in');  // 21:50
});

test('session: checked once, then remembered for a minute (same token)', async () => {
    process.env.SESSION_CACHE = 'on'; forgetSessions();
    let authCalls = 0;
    const jwt = 'Bearer h.' + Buffer.from(JSON.stringify({ sub: '11111111-2222-3333-4444-555555555555' })).toString('base64url') + '.s';
    globalThis.fetch = async (u) => {
        const url = String(u);
        if (url.includes('/auth/v1/user')) { authCalls++; return { ok: true, json: async () => ({ id: '11111111-2222-3333-4444-555555555555' }) }; }
        return { ok: true, json: async () => [{ id: '11111111-2222-3333-4444-555555555555', role: 'staff', branch: 'SLL' }] };
    };
    const a = await getSession({ headers: { authorization: jwt } });
    const b = await getSession({ headers: { authorization: jwt } });
    assert.equal(a.branch, 'SLL'); assert.equal(b, a); assert.equal(authCalls, 1);
    // a token that Supabase rejects is never cached as valid
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
    assert.equal(await getSession({ headers: { authorization: 'Bearer other' } }), null);
    delete process.env.SESSION_CACHE; forgetSessions();
});

test('staff & users: work hours saved, bad times refused', async () => {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u)); calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
        const json = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.includes('/auth/v1/user')) return json({ id: 'u1' });
        if (url.includes('employees?id=eq.u1')) return json([{ id: 'u1', role: 'super_admin' }]);
        if (url.includes('employees?id=eq.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')) return json([{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'staff', branch: 'SLL' }]);
        return json([]);
    };
    const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    let r = res();
    await users({ method: 'PATCH', headers: { authorization: 'Bearer t' }, body: { id, shift_start: '14:00', shift_end: '22:00', grace_min: 5, weekly_off: [5, 6, 6, 9] } }, r);
    assert.equal(r.body.success, true);
    const p = calls.find(c => c.opts.method === 'PATCH').body;
    assert.deepEqual([p.shift_start, p.shift_end, p.grace_min, p.weekly_off], ['14:00', '22:00', 5, [5, 6]]);
    r = res();
    await users({ method: 'PATCH', headers: { authorization: 'Bearer t' }, body: { id, shift_start: '9am', shift_end: '18:00' } }, r);
    assert.equal(r.code, 400);
});
