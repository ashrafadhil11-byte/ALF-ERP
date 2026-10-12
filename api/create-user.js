export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { fullName, username, password, role } = req.body;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    // Ensure the username is formatted as the backend email
    const formattedEmail = username.includes('@') ? username : `${username.toLowerCase().replace(/\s+/g, '')}@alfarhacargo.com`;

    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                email: formattedEmail,
                password: password,
                data: {
                    full_name: fullName,
                    username: username,
                    role: role
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error_description || data.msg || 'Failed to create user' });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'User created successfully',
            user: data.user 
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error connecting to database.' });
    }
}
