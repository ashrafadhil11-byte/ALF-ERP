export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Extract all the new fields from the incoming request body
    const { 
        fullName, dob, contactNumber, recoveryEmail, 
        omanId, username, role, branch, password 
    } = req.body;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    // We still use username formatting for the internal Supabase auth system
    const formattedAuthEmail = username.includes('@') ? username : `${username.toLowerCase().replace(/\s+/g, '')}@alfarhacargo.com`;

    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                email: formattedAuthEmail, // System email for login
                password: password,
                data: {
                    // This data gets stored in Supabase's auth.users table under 'raw_user_meta_data'
                    full_name: fullName,
                    date_of_birth: dob,
                    contact_number: contactNumber,
                    recovery_email: recoveryEmail,
                    oman_civil_id: omanId,
                    username: username,
                    role: role,
                    branch: branch
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
