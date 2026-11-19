// File: api/_lib/audit.js — activity log for every change made through the API.
// api/router.js wraps each request with withAudit(). Reads (GET) are not logged; every POST / PUT / PATCH / DELETE is,
// with who, when, where, what (route + action + target) and whether it worked. Passwords, PINs, keys, tokens
// and images are removed before saving.
import { serviceHeaders } from './auth.js';

const SKIP = new Set(['notifications:seen']);           // noise
const PRIVATE = new Set(['chat']);                        // private messages are never copied into the activity log
const SECRET = /pass|pin|secret|token|api_?key|apikey|signature|photo|authorization|cookie/i;
const MAX_JSON = 6000;
const names = new Map();                                 // user id → { name, role, branch, at } (warm-function cache)

export function sanitize(v, depth = 0) {
    if (v == null || depth > 5) return v ?? null;
    if (typeof v === 'string') return v.startsWith('data:') ? '[file]' : v.length > 300 ? v.slice(0, 300) + '…' : v;
    if (Array.isArray(v)) return v.slice(0, 50).map(x => sanitize(x, depth + 1)).concat(v.length > 50 ? [`…${v.length - 50} more`] : []);
    if (typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? '[hidden]' : sanitize(x, depth + 1);
        return out;
    }
    return v;
}

function jwtUser(req) {
    try {
        const t = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').split('.')[1];
        if (!t) return null;
        const p = JSON.parse(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        return p?.sub ? { id: p.sub, email: p.email || null } : null;
    } catch (e) { return null; }
}

async function who(id) {
    const hit = names.get(id);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit;
    try {
        const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(id)}&select=full_name,role,branch`, { headers: serviceHeaders() });
        const e = (r.ok ? await r.json() : [])[0] || {};
        const v = { name: e.full_name || null, role: e.role || null, branch: e.branch || null, at: Date.now() };
        names.set(id, v);
        return v;
    } catch (e) { return {}; }
}

function targetOf(body = {}, query = {}) {
    const awbs = Array.isArray(body.awbs) ? body.awbs : null;
    const t = body.awb || (awbs && (awbs.slice(0, 5).join(', ') + (awbs.length > 5 ? ` +${awbs.length - 5}` : '')))
        || body.order_no || body.mawb || body.invoice_id || body.purchase_id || body.id || query.id || query.awb || body.username || body.code;
    return t == null ? null : String(t).slice(0, 200);
}

/**
 * Runs the handler; for writes, records the outcome before the reply leaves (so the entry is never lost).
 */
export async function withAudit(routeName, handler, req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return handler(req, res);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = body.action || null;
    if (PRIVATE.has(routeName) || SKIP.has(`${routeName}:${action}`)) return handler(req, res);

    let pending = null;
    const json = res.json.bind(res);
    res.json = (payload) => {
        pending = (async () => {
            try { await save(routeName, method, action, req, res.statusCode || 200, payload, body); } catch (e) { console.error(`[audit] could not save ${method} ${routeName}: ${e.message}`); /* never block the reply */ }
            json(payload);
        })();
        return res;
    };
    await handler(req, res);
    if (pending) await pending;
}

async function save(routeName, method, action, req, status, payload, body) {
    const u = jwtUser(req);
    const info = u ? await who(u.id) : {};
    const details = sanitize({ query: req.query || {}, body });
    let text = JSON.stringify(details);
    if (text.length > MAX_JSON) text = JSON.stringify({ truncated: true, preview: text.slice(0, MAX_JSON) });
    const row = {
        user_id: u?.id || null,
        user_email: u?.email || null,
        user_name: info.name || (routeName === 'login' ? String(body.username || '').slice(0, 80) : null),
        role: info.role || null,
        branch: info.branch || null,
        method, route: routeName, action,
        target: targetOf(body, req.query),
        status, ok: status < 400,
        error: status >= 400 ? String(payload?.error || '').slice(0, 300) || null : null,
        details: JSON.parse(text),
        ip: String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 60) || null,
        user_agent: String(req.headers?.['user-agent'] || '').slice(0, 200) || null
    };
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/audit_log`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    // a refused insert used to vanish without a trace; now it shows in the server logs
    if (!r.ok) console.error(`[audit] could not save ${method} ${routeName}${action ? ':' + action : ''} — HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 300)}`);
}
