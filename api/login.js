export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, password } = req.body;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
        let targetEmail = username; 

        // 1. Look up the real email from the username
        if (!username.includes('@')) {
            const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?username=eq.${username}&select=recovery_email`, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                }
            });
            
            const lookupData = await lookupRes.json();
            
            if (lookupData && lookupData.length > 0) {
                targetEmail = lookupData[0].recovery_email;
            } else {
                return res.status(400).json({ error: 'Username not found.' });
            }
        }

        // 2. Request the secure token from Supabase
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ 
                email: targetEmail, 
                password: password 
            })
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.error_description && data.error_description.includes("Email not confirmed")) {
                 return res.status(403).json({ error: 'Please verify your email address before logging in.' });
            }
            return res.status(response.status).json({ error: data.error_description || 'Invalid login credentials' });
        }

        // 3. THE FIX: Pass the token and user directly from the raw Supabase response back to the frontend
        return res.status(200).json({ 
            success: true, 
            access_token: data.access_token,
            user: data.user 
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error connecting to database.' });
    }
}
