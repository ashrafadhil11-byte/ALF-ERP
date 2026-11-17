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
// Signed-in sessions are remembered for a minute per token, so each request does not re-check with
// Supabase Auth (two network round trips). Changes to a user (role, deactivation) apply within 60 s.
const SESSION_TTL_MS = 60e3;
const sessions = new Map();
export function forgetSessions() { sessions.clear(); }

function tokenSub(authHeader) {
    try {
        const p = JSON.parse(Buffer.from(authHeader.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        return p?.sub && /^[0-9a-f-]{36}$/i.test(p.sub) ? p.sub : null;
    } catch (e) { return null; }
}

export async function getSession(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    const hit = sessions.get(authHeader);
    if (hit && hit.until > Date.now()) return hit.session;

    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
    // The employee row is fetched at the same time as the token check (the id in the token is only
    // trusted after Supabase Auth confirms the token belongs to that same user).
    const sub = tokenSub(authHeader);
    const empFetch = (id) => fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(id)}&select=*`, { headers: serviceHeaders() })
        .then(r => r.ok ? r.json() : []).catch(() => []);
    const [userRes, early] = await Promise.all([
        fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader } }),
        sub ? empFetch(sub) : Promise.resolve(null)
    ]);
    if (!userRes.ok) return null;
    const user = await userRes.json();
    if (!user || !user.id) return null;

    const rows = user.id === sub && early ? early : await empFetch(user.id);
    const employee = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (employee && employee.active === false) return null; // deactivated in Staff & Users

    const role = normalizeRole(employee?.role) || normalizeRole(user.app_metadata?.role);
    if (!role) return null; // no recognised role = no access

    const session = { user, employee, role, branch: employee?.branch || null };
    if (process.env.NODE_TEST_CONTEXT && !process.env.SESSION_CACHE) return session;   // tests swap users per case
    if (sessions.size > 500) sessions.clear();
    sessions.set(authHeader, { session, until: Date.now() + SESSION_TTL_MS });
    return session;
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
