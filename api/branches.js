// File: api/branches.js
export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': authHeader
            }
        });

        if (!userRes.ok) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }

        // GET: Fetch All Branches + Available Staff Managers
        if (req.method === 'GET') {
            const [branchesRes, managersRes] = await Promise.all([
                fetch(`${SUPABASE_URL}/rest/v1/branches?select=*&order=created_at.asc`, {
                    headers: {
                        'apikey': SUPABASE_SERVICE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                    }
                }),
                fetch(`${SUPABASE_URL}/rest/v1/employees?select=id,full_name,username,role,branch&order=full_name.asc`, {
                    headers: {
                        'apikey': SUPABASE_SERVICE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                    }
                })
            ]);

            const branches = branchesRes.ok ? await branchesRes.json() : [];
            const managers = managersRes.ok ? await managersRes.json() : [];

            return res.status(200).json({ branches, managers });
        }

        // POST: Create a New Branch
        if (req.method === 'POST') {
            const {
                branchName,
                branchCode,
                bookingCode,
                country,
                postalCode,
                postOffice,
                state,
                location,
                address,
                phoneNumber,
                managerId,
                managerName
            } = req.body;

            if (!branchName || !branchCode || !bookingCode || !country || !location || !address || !phoneNumber) {
                return res.status(400).json({ error: 'Please complete all required branch fields.' });
            }

            const payload = {
                branch_name: branchName.trim(),
                branch_code: branchCode.trim().toUpperCase(),
                booking_code: String(bookingCode).trim().toUpperCase(),
                country: country.trim(),
                postal_code: (postalCode || '').trim(),
                post_office: (postOffice || '').trim(),
                state: (state || '').trim(),
                location: location.trim(),
                address: address.trim(),
                phone_number: phoneNumber.trim(),
                manager_id: managerId || null,
                manager_name: managerName || 'Unassigned',
                status: 'Optimal'
            };

            const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/branches`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(payload)
            });

            const data = await insertRes.json();

            if (!insertRes.ok) {
                const msg = data?.message || data?.details || 'Failed to create branch.';
                if (msg.includes('branch_code')) {
                    return res.status(400).json({ error: 'Branch Code (e.g. ALFSLL) already exists.' });
                }
                if (msg.includes('booking_code')) {
                    return res.status(400).json({ error: 'Unique Booking Code digit is already assigned to another branch.' });
                }
                return res.status(400).json({ error: msg });
            }

            return res.status(200).json({
                success: true,
                branch: Array.isArray(data) ? data[0] : data
            });
        }

        // PUT: Edit / Update Existing Branch Details
        if (req.method === 'PUT') {
            const {
                id,
                branchName,
                branchCode,
                bookingCode,
                country,
                postalCode,
                postOffice,
                state,
                location,
                address,
                phoneNumber,
                managerId,
                managerName,
                status
            } = req.body;

            if (!id) {
                return res.status(400).json({ error: 'Branch ID is required for updating.' });
            }

            const updatePayload = {
                branch_name: branchName.trim(),
                branch_code: branchCode.trim().toUpperCase(),
                booking_code: String(bookingCode).trim().toUpperCase(),
                country: country.trim(),
                postal_code: (postalCode || '').trim(),
                post_office: (postOffice || '').trim(),
                state: (state || '').trim(),
                location: location.trim(),
                address: address.trim(),
                phone_number: phoneNumber.trim(),
                manager_id: managerId || null,
                manager_name: managerName || 'Unassigned'
            };
            if (status) updatePayload.status = status;

            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/branches?id=eq.${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(updatePayload)
            });

            const data = await updateRes.json();
            if (!updateRes.ok) {
                const msg = data?.message || data?.details || 'Failed to update branch.';
                return res.status(400).json({ error: msg });
            }

            return res.status(200).json({
                success: true,
                branch: Array.isArray(data) ? data[0] : data
            });
        }

        // PATCH: Dismiss / Close Branch or Reactivate Branch
        if (req.method === 'PATCH') {
            const { id, status } = req.body;
            if (!id || !status) {
                return res.status(400).json({ error: 'Branch ID and target status are required.' });
            }

            const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/branches?id=eq.${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({ status })
            });

            const data = await patchRes.json();
            if (!patchRes.ok) {
                return res.status(400).json({ error: 'Failed to update branch status.' });
            }

            return res.status(200).json({
                success: true,
                branch: Array.isArray(data) ? data[0] : data
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error connecting to database.' });
    }
}
