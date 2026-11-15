import { requireSession, serviceHeaders, normalizeRole, ADMIN_ROLES } from './_lib/auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Only super_admin / head_office may create accounts.
    const session = await requireSession(req, res, ADMIN_ROLES);
    if (!session) return;

    const {
        fullName, dob, contactNumber, recoveryEmail,
        omanId, username, role: requestedRole, branch, password
    } = req.body || {};

    const role = normalizeRole(requestedRole);
    const isDriver = String(requestedRole).toLowerCase() === 'driver';
    if (!role) {
        return res.status(400).json({ error: 'Invalid role.' });
    }
    if (role === 'super_admin' && session.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin.' });
    }
    if (!recoveryEmail || !password || !username) {
        return res.status(400).json({ error: 'Email, username and password are required.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    try {
        // 1. Sign up (keeps the email verification flow)
        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                email: recoveryEmail,
                password: password,
                data: {
                    full_name: fullName,
                    date_of_birth: dob,
                    contact_number: contactNumber,
                    recovery_email: recoveryEmail,
                    oman_civil_id: omanId,
                    username: username, // Still saving the username for login mapping
                    role: role,
                    branch: branch,
                    is_driver: isDriver
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error_description || data.msg || 'Failed to create user' });
        }

        // 2. Store role in app_metadata — users cannot edit this themselves.
        const newUserId = data.user?.id || data.id;
        if (newUserId) {
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(newUserId)}`, {
                method: 'PUT',
                headers: serviceHeaders(),
                body: JSON.stringify({ app_metadata: { role, branch, is_driver: isDriver } })
            });
            // The signup trigger leaves employees.role empty (no access) — set it here.
            await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(newUserId)}`, {
                method: 'PATCH',
                headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
                body: JSON.stringify({ role, is_driver: isDriver })
            });
        }

        return res.status(200).json({
            success: true,
            message: 'User created successfully',
            user: data.user || data
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error connecting to database.' });
    }
}
