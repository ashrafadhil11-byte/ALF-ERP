// File: api/profile.js
export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    try {
        // 1. Verify User Token
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': authHeader
            }
        });

        if (!userRes.ok) {
            return res.status(401).json({ error: 'Session expired. Please sign in again.' });
        }

        const authUser = await userRes.json();
        const userId = authUser.id;

        // 2. GET: Return Full Employee Profile from `public.employees` + Auth metadata fallback
        if (req.method === 'GET') {
            const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${userId}&select=*`, {
                headers: {
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                }
            });

            const rows = await empRes.json();
            const emp = (rows && rows.length > 0) ? rows[0] : {};
            const meta = authUser.user_metadata || {};

            return res.status(200).json({
                profile: {
                    id: userId,
                    full_name: emp.full_name || meta.full_name || 'Muhammed Adhil',
                    username: emp.username || meta.username || 'admin',
                    role: emp.role || meta.role || 'super_admin',
                    branch: emp.branch || meta.branch || 'Global (All Branches)',
                    contact_number: emp.contact_number || meta.contact_number || 'Not Set',
                    recovery_email: emp.recovery_email || authUser.email || 'Not Set',
                    oman_civil_id: emp.oman_civil_id || meta.oman_civil_id || 'Not Set',
                    date_of_birth: emp.date_of_birth || meta.date_of_birth || null
                }
            });
        }

        // 3. PUT: Change / Reset Password for the Authenticated User
        if (req.method === 'PUT') {
            const { newPassword } = req.body;

            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
            }

            const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': authHeader
                },
                body: JSON.stringify({ password: newPassword })
            });

            const updateData = await updateRes.json();

            if (!updateRes.ok) {
                return res.status(updateRes.status).json({
                    error: updateData.error_description || updateData.msg || 'Failed to update password.'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Password updated successfully.'
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
