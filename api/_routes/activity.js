// File: api/_routes/activity.js — read the activity log (super admin / head office).
//   GET ?from&to&user&route&q&failed=1&page=   newest first, 100 per page
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

const enc = encodeURIComponent;
const PAGE = 100;

export default async function handler(req, res) {
    const session = await requireSession(req, res, ADMIN_ROLES);
    if (!session) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const q = req.query || {};
    const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
    const from = day(q.from) || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const to = day(q.to);
    const page = Math.max(0, parseInt(q.page, 10) || 0);
    const s = String(q.q || '').replace(/[(),*%]/g, ' ').trim().slice(0, 60);
    const f = [
        `at=gte.${from}`,
        to && `at=lt.${new Date(new Date(to + 'T00:00:00Z').getTime() + 864e5).toISOString()}`,
        q.user && `user_id=eq.${enc(q.user)}`,
        q.route && `route=eq.${enc(q.route)}`,
        q.failed === '1' && 'ok=is.false',
        s && `or=(target.ilike.*${enc(s)}*,action.ilike.*${enc(s)}*,user_name.ilike.*${enc(s)}*,error.ilike.*${enc(s)}*)`
    ].filter(Boolean).join('&');
    const [rows, users] = await Promise.all([
        fetch(`${rest}/audit_log?${f}&select=*&order=at.desc&limit=${PAGE}&offset=${page * PAGE}`, { headers: serviceHeaders() }).then(r => r.ok ? r.json() : []),
        fetch(`${rest}/employees?select=id,full_name,branch&order=full_name.asc`, { headers: serviceHeaders() }).then(r => r.ok ? r.json() : [])
    ]);
    return res.status(200).json({ rows, users, page, more: rows.length === PAGE, from });
}
