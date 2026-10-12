export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, password } = req.body;

    // These grab the keys securely from Vercel's Environment Variables (set in Step 3)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    // Format the username into an email for Supabase (e.g., admin -> admin@alfarhacargo.com)
    // If they actually type an email, it leaves it alone.
    const formattedEmail = username.includes('@') ? username : `${username.toLowerCase()}@alfarhacargo.com`;

    try {
        // Securely communicate with Supabase from the server, entirely hidden from the browser
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ 
                email: formattedEmail, 
                password: password 
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error_description || 'Invalid login credentials' });
        }

        // Send success back to the frontend
        return res.status(200).json({ 
            success: true, 
            session: data.session 
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error connecting to database.' });
    }
}
