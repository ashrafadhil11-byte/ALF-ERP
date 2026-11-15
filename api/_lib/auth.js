// File: api/_lib/auth.js — shared session check for all API routes (files under _lib are not routes on Vercel)

export const ROLES = ['super_admin', 'head_office', 'branch_manager', 'staff'];
export const ADMIN_ROLES = ['super_admin', 'head_office'];

// Old role names still stored on some accounts.
const LEGACY_ROLES = { employee: 'staff', driver: 'staff', branch_admin: 'branch_manager' };

export function normalizeRole(role) {
    const r = String(role || '').trim().toLowerCase();
    return ROLES.includes(r) ? r : (LEGACY_ROLES[r] || null);
}

export function serviceHeaders() {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Verifies the Bearer token with Supabase Auth and loads the employee row.
 * Role comes from `employees.role` (or app_metadata), never user_metadata — users can edit their own user_metadata.
 * Returns { user, employee, role, branch } or null when the session is invalid.
 */
export async function getSession(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;

    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader }
    });
    if (!userRes.ok) return null;
    const user = await userRes.json();
    if (!user || !user.id) return null;

    const empRes = await fetch(
        `${SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(user.id)}&select=*`,
        { headers: serviceHeaders() }
    );
    const rows = empRes.ok ? await empRes.json() : [];
    const employee = Array.isArray(rows) && rows.length ? rows[0] : null;

    const role = normalizeRole(employee?.role) || normalizeRole(user.app_metadata?.role);
    if (!role) return null; // no recognised role = no access

    return { user, employee, role, branch: employee?.branch || null };
}

/**
 * Use at the top of a handler. Sends 401/403 itself and returns null on failure.
 *   const session = await requireSession(req, res, ADMIN_ROLES); if (!session) return;
 */
export async function requireSession(req, res, allowedRoles = ROLES) {
    let session = null;
    try {
        session = await getSession(req);
    } catch (e) {
        res.status(500).json({ error: 'Could not verify session.' });
        return null;
    }
    if (!session) {
        res.status(401).json({ error: 'Unauthorized session. Please sign in again.' });
        return null;
    }
    if (!allowedRoles.includes(session.role)) {
        res.status(403).json({ error: 'You do not have permission for this action.' });
        return null;
    }
    return session;
}
