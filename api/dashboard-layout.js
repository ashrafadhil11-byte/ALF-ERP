// File: api/dashboard-layout.js
export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    try {
        // 1. Verify the logged-in user with Supabase Auth
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': authHeader
            }
        });

        if (!userRes.ok) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }

        const userData = await userRes.json();
        const userId = userData.id;

        // 2. GET: Fetch saved widget layout from Supabase `employees` table
        if (req.method === 'GET') {
            const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${userId}&select=dashboard_config`, {
                headers: {
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                }
            });
            const rows = await dbRes.json();
            const config = (rows && rows.length > 0 && rows[0].dashboard_config) ? rows[0].dashboard_config : null;
            return res.status(200).json({ config });
        }

        // 3. POST: Save updated widget layout to Supabase `employees` table
        if (req.method === 'POST') {
            const { config } = req.body;
            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ dashboard_config: config })
            });

            if (!updateRes.ok) {
                return res.status(500).json({ error: 'Failed to save layout to cloud' });
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
