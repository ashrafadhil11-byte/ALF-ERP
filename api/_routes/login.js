// File: api/_routes/login.js — sign in with username (or email) and password.
// Safety: a wrong username and a wrong password get the same answer (no hint which usernames exist).
// After 5 wrong passwords the account is locked for 15 minutes; a good sign-in resets the count.
// Deactivated users (Staff & Users) cannot sign in.
import { normalizeRole, serviceHeaders } from '../_lib/auth.js';

const MAX_TRIES = 5;
const LOCK_MIN = 15;
const BAD = 'Wrong username or password.';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const rest = `${SUPABASE_URL}/rest/v1`;
    const name = String(username).trim();

    try {
        // 1. Who is this? (by username, or by the account email)
        const col = name.includes('@') ? 'recovery_email' : 'username';
        const find = (cols) => fetch(`${rest}/employees?${col}=eq.${encodeURIComponent(name)}&select=${cols}&limit=1`, { headers: serviceHeaders() });
        let lookup = await find('id,recovery_email,active,login_failed,login_locked_until');
        if (!lookup.ok) lookup = await find('id,recovery_email,active');      // lock columns not added yet (migration 024): sign-in still works
        if (!lookup.ok) return res.status(500).json({ error: 'Internal server error connecting to database.' });
        const emp = (await lookup.json())[0] || null;
        if (!emp && col === 'username') return res.status(401).json({ error: BAD });
        if (emp && emp.active === false) return res.status(403).json({ error: 'This account is switched off. Ask an admin.' });
        if (emp?.login_locked_until && new Date(emp.login_locked_until) > new Date()) {
            const min = Math.max(1, Math.ceil((new Date(emp.login_locked_until) - Date.now()) / 60000));
            return res.status(429).json({ error: `Too many wrong passwords. Try again in ${min} minute${min === 1 ? '' : 's'}, or ask an admin to reset your password.` });
        }
        const patchEmp = (body) => emp ? fetch(`${rest}/employees?id=eq.${encodeURIComponent(emp.id)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify(body) }).catch(() => {}) : null;

        // 2. Ask Supabase for the session token
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify({ email: emp?.recovery_email || name, password })
        });
        const data = await response.json();

        if (!response.ok) {
            if (data.error_description && data.error_description.includes('Email not confirmed')) {
                return res.status(403).json({ error: 'Please verify your email address before logging in.' });
            }
            if (response.status === 429) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
            // count the wrong password; lock after MAX_TRIES
            if (emp) {
                const tries = (+emp.login_failed || 0) + 1;
                const lock = tries >= MAX_TRIES;
                await patchEmp({ login_failed: lock ? 0 : tries, login_locked_until: lock ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null });
                if (lock) return res.status(429).json({ error: `Too many wrong passwords. Locked for ${LOCK_MIN} minutes.` });
                const left = MAX_TRIES - tries;
                if (left <= 2) return res.status(401).json({ error: `${BAD} ${left} tr${left === 1 ? 'y' : 'ies'} left before a ${LOCK_MIN}-minute lock.` });
            }
            return res.status(401).json({ error: BAD });
        }

        // 3. Role from the employees table / app_metadata (never user_metadata, which users can edit)
        const empRes = await fetch(`${rest}/employees?id=eq.${encodeURIComponent(data.user.id)}&select=*`, { headers: serviceHeaders() });
        const empRows = empRes.ok ? await empRes.json() : [];
        if (empRows[0]?.active === false) return res.status(403).json({ error: 'This account is switched off. Ask an admin.' });
        if (empRows[0] && (empRows[0].login_failed || empRows[0].login_locked_until)) {
            await fetch(`${rest}/employees?id=eq.${encodeURIComponent(data.user.id)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ login_failed: 0, login_locked_until: null }) }).catch(() => {});
        }
        const role = normalizeRole(empRows[0]?.role) || normalizeRole(data.user.app_metadata?.role) || 'staff';

        return res.status(200).json({
            success: true,
            access_token: data.access_token,
            user: data.user,
            role,
            is_warehouse: Boolean(empRows[0]?.is_warehouse && empRows[0]?.warehouse_code),
            is_cashier: Boolean(empRows[0]?.is_cashier)
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error connecting to database.' });
    }
}
