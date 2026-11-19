// File: api/_lib/backup.js — export every business table to one gzip JSON file in the private "backups" bucket.
// Used by the nightly job (api/_routes/summary.js) and "Back up now" (api/_routes/backups.js). Keeps the last 14 files.
// Left out on purpose: integration secrets and PIN hashes (never exported); sign-in passwords are in Supabase Auth.
import { gzipSync } from 'node:zlib';
import { serviceHeaders } from './auth.js';

export const KEEP = 14;
const PAGE = 1000;
// columns never written to a backup file
const SECRET_COLS = { integrations: ['secret'], employees: ['wh_pin_hash'] };
const store = () => `${process.env.SUPABASE_URL}/storage/v1`;

async function allRows(rest, table) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const r = await fetch(`${rest}/${encodeURIComponent(table)}?select=*`, { headers: { ...serviceHeaders(), Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
        if (!r.ok) throw new Error(`${table}: ${r.status}`);
        const rows = await r.json();
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
}

export async function listBackups() {
    const r = await fetch(`${store()}/object/list/backups`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ prefix: '', limit: 100, sortBy: { column: 'name', order: 'desc' } }) });
    const list = r.ok ? await r.json() : [];
    return (Array.isArray(list) ? list : []).filter(f => f.name?.endsWith('.json.gz')).map(f => ({ name: f.name, size: +(f.metadata?.size || 0), created_at: f.created_at }));
}

export async function signBackup(name) {
    if (!/^[\w.-]+\.json\.gz$/.test(name)) return null;
    const r = await fetch(`${store()}/object/sign/backups/${name}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ expiresIn: 300, download: name }) });
    const j = r.ok ? await r.json() : null;
    return j?.signedURL ? `${store()}${j.signedURL}` : null;
}

/** one backup now; returns { name, tables, rows, bytes } */
export async function runBackup(by = 'nightly') {
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const t = await fetch(`${rest}/rpc/backup_tables`, { method: 'POST', headers: serviceHeaders(), body: '{}' });
    if (!t.ok) throw new Error(`backup_tables ${t.status}`);
    const names = (await t.json()).map(x => x.name);
    const data = { app: 'ALF-ERP', created_at: new Date().toISOString(), by, tables: {} };
    let rows = 0;
    for (const name of names) {
        const list = await allRows(rest, name);
        const drop = SECRET_COLS[name] || [];
        data.tables[name] = drop.length ? list.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => !drop.includes(k)))) : list;
        rows += list.length;
    }
    const gz = gzipSync(Buffer.from(JSON.stringify(data)));
    const stamp = new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 16).replace(/[T:]/g, '-');   // Oman time, e.g. 2026-11-20-02-00
    const name = `alf-erp-${stamp}.json.gz`;
    const h = serviceHeaders();
    const up = await fetch(`${store()}/object/backups/${name}`, { method: 'POST', headers: { apikey: h.apikey, Authorization: h.Authorization, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gz });
    if (!up.ok) throw new Error(`upload ${up.status}`);
    // keep the newest KEEP files
    const old = (await listBackups()).slice(KEEP).map(f => f.name);
    if (old.length) await fetch(`${store()}/object/backups`, { method: 'DELETE', headers: serviceHeaders(), body: JSON.stringify({ prefixes: old }) }).catch(() => {});
    return { name, tables: names.length, rows, bytes: gz.length };
}
