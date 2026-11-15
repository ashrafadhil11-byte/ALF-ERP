// File: api/branches.js
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;

    // Reading is for any signed-in employee; changing branches is admin only.
    const session = await requireSession(req, res, req.method === 'GET' ? undefined : ADMIN_ROLES);
    if (!session) return;

    try {
        const dbHeaders = serviceHeaders();

        // 2. GET: Fetch All Branches + Available Staff Managers
        if (req.method === 'GET') {
            const [branchesRes, managersRes] = await Promise.all([
                fetch(`${SUPABASE_URL}/rest/v1/branches?select=*&order=created_at.asc`, { headers: dbHeaders }),
                fetch(`${SUPABASE_URL}/rest/v1/employees?select=id,full_name,username,role,branch&order=full_name.asc`, { headers: dbHeaders })
            ]);

            const branches = branchesRes.ok ? await branchesRes.json() : [];
            const managers = managersRes.ok ? await managersRes.json() : [];

            return res.status(200).json({
                branches: Array.isArray(branches) ? branches : [],
                managers: Array.isArray(managers) ? managers : []
            });
        }

        // 3. POST: Create a New Branch
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

            const fullPayload = {
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

            let insertRes = await fetch(`${SUPABASE_URL}/rest/v1/branches`, {
                method: 'POST',
                headers: { ...dbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify(fullPayload)
            });

            // Fallback if optional postal_code/post_office/state columns haven't been added via SQL yet
            if (!insertRes.ok) {
                const errData = await insertRes.json();
                const errMsg = JSON.stringify(errData);
                if (errMsg.includes('postal_code') || errMsg.includes('post_office') || errMsg.includes('state')) {
                    const basePayload = {
                        branch_name: fullPayload.branch_name,
                        branch_code: fullPayload.branch_code,
                        booking_code: fullPayload.booking_code,
                        country: fullPayload.country,
                        location: fullPayload.location,
                        address: fullPayload.address,
                        phone_number: fullPayload.phone_number,
                        manager_id: fullPayload.manager_id,
                        manager_name: fullPayload.manager_name,
                        status: 'Optimal'
                    };
                    insertRes = await fetch(`${SUPABASE_URL}/rest/v1/branches`, {
                        method: 'POST',
                        headers: { ...dbHeaders, 'Prefer': 'return=representation' },
                        body: JSON.stringify(basePayload)
                    });
                } else {
                    if (errMsg.includes('branch_code')) {
                        return res.status(400).json({ error: 'Branch Code (e.g. ALFSLL) already exists.' });
                    }
                    if (errMsg.includes('booking_code')) {
                        return res.status(400).json({ error: 'Unique Booking Code digit is already assigned to another branch.' });
                    }
                    return res.status(400).json({ error: errData?.message || 'Failed to create branch.' });
                }
            }

            const savedData = await insertRes.json();
            return res.status(200).json({
                success: true,
                branch: Array.isArray(savedData) ? savedData[0] : savedData
            });
        }

        // 4. PUT: Edit / Update Existing Branch Details
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
                location: location.trim(),
                address: address.trim(),
                phone_number: phoneNumber.trim(),
                manager_id: managerId || null,
                manager_name: managerName || 'Unassigned'
            };
            if (status) updatePayload.status = status;

            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/branches?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { ...dbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify(updatePayload)
            });

            const data = await updateRes.json();
            if (!updateRes.ok) {
                return res.status(400).json({ error: data?.message || 'Failed to update branch.' });
            }

            return res.status(200).json({
                success: true,
                branch: Array.isArray(data) ? data[0] : data
            });
        }

        // 5. PATCH: Dismiss / Close Branch or Reactivate Branch
        if (req.method === 'PATCH') {
            const { id, status } = req.body;
            if (!id || !status) {
                return res.status(400).json({ error: 'Branch ID and target status are required.' });
            }

            const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/branches?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { ...dbHeaders, 'Prefer': 'return=representation' },
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
