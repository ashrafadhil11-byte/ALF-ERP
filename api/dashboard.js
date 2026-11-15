// File: api/dashboard.js — one call feeds every dashboard widget, scoped by role.
import { requireSession, serviceHeaders, ADMIN_ROLES } from './_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const session = await requireSession(req, res);
    if (!session) return;

    const isAdmin = ADMIN_ROLES.includes(session.role);
    // Admins see all branches (or pick one with ?branch=CODE); everyone else only their own branch.
    const branch = isAdmin ? (req.query.branch || null) : session.branch;
    if (!isAdmin && !branch) {
        return res.status(403).json({ error: 'Your account has no branch assigned. Ask an admin.' });
    }

    const { SUPABASE_URL } = process.env;
    try {
        const [sumRes, intRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/rpc/dashboard_summary`, {
                method: 'POST',
                headers: serviceHeaders(),
                body: JSON.stringify({ p_branch: branch })
            }),
            isAdmin
                ? fetch(`${SUPABASE_URL}/rest/v1/integrations?select=name,kind,active,last_status,last_sync_at,last_error&order=kind,name`, { headers: serviceHeaders() })
                : null
        ]);
        if (!sumRes.ok) return res.status(500).json({ error: 'Could not load dashboard data.' });

        const data = await sumRes.json();
        if (session.role === 'staff') delete data.revenue; // staff don't see money
        data.integrations = intRes && intRes.ok ? await intRes.json() : [];
        data.me = {
            role: session.role,
            branch: session.branch,
            name: session.employee?.full_name || session.user.email,
            is_driver: Boolean(session.employee?.is_driver)
        };
        return res.status(200).json(data);
    } catch (e) {
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
