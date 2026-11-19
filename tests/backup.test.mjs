// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import { gunzipSync } from 'node:zlib';
import { runBackup } from '../api/_lib/backup.js';
import backups from '../api/_routes/backups.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

function fakeDb({ old = [] } = {}) {
    const calls = [];
    const big = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1 }));
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b });
        if (url.includes('/rpc/backup_tables')) return json([{ name: 'bookings' }, { name: 'employees' }, { name: 'integrations' }]);
        if (url.includes('/rest/v1/bookings?')) { const [a, b] = opts.headers.Range.split('-').map(Number); return json(big.slice(a, b + 1)); }
        if (url.includes('/rest/v1/employees?')) return json([{ id: 'u1', full_name: 'Ali', wh_pin_hash: 'SECRET-HASH' }]);
        if (url.includes('/rest/v1/integrations?')) return json([{ id: 1, name: 'SMSA', secret: 'API-KEY-123' }]);
        if (url.includes('/storage/v1/object/list/backups')) return json(old.map(name => ({ name, metadata: { size: 10 } })));
        return json({});
    };
    return calls;
}

test('backup: every table, read in pages, secrets left out, old files pruned', async () => {
    const old = Array.from({ length: 16 }, (_, i) => `alf-erp-2026-11-${String(30 - i).padStart(2, '0')}-02-00.json.gz`);
    const calls = fakeDb({ old });
    const out = await runBackup('test');
    assert.equal(out.tables, 3);
    assert.equal(out.rows, 1502);
    const up = calls.find(c => c.method === 'POST' && c.url.includes('/storage/v1/object/backups/alf-erp-'));
    const data = JSON.parse(gunzipSync(up.body).toString());
    assert.equal(data.tables.bookings.length, 1500);                       // two pages of 1000
    assert.ok(!JSON.stringify(data).includes('SECRET-HASH'));
    assert.ok(!JSON.stringify(data).includes('API-KEY-123'));
    assert.equal(data.tables.employees[0].full_name, 'Ali');
    const del = calls.find(c => c.method === 'DELETE' && c.url.includes('/storage/v1/object/backups'));
    assert.deepEqual(JSON.parse(del.body).prefixes, old.slice(14));          // keeps the newest 14
});

test('backups: super admin only', async () => {
    globalThis.fetch = async (u) => {
        const url = decodeURIComponent(String(u));
        const json = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.includes('/auth/v1/user')) return json({ id: 'u7', email: 'a@b.c' });
        if (url.includes('/rest/v1/employees?id=eq.u7&select')) return json([{ id: 'u7', role: 'head_office', full_name: 'Boss' }]);
        return json([]);
    };
    const r = res(); await backups({ method: 'GET', query: {}, headers: { authorization: 'Bearer h' } }, r);
    assert.equal(r.code, 403);
});
