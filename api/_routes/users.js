// File: api/users.js — Staff & Users (admins). Creating users stays in api/create-user.js.
//   GET                                   list staff with last sign-in
//   PATCH { id, full_name?, contact_number?, role?, branch?, is_driver?, active? }
//   POST  { action:'reset_password', id }  emails a password-reset link
//   PATCH also takes { is_warehouse, warehouse_code }  — warehouse operator (they still need their own PIN)
import { requireSession, serviceHeaders, normalizeRole, ADMIN_ROLES } from '../_lib/auth.js';

const enc = encodeURIComponent;
class UserError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export default async function handler(req, res) {
    const session = await requireSession(req, res, ADMIN_ROLES);
    if (!session) return;
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
    const rest = `${SUPABASE_URL}/rest/v1`;

    const loadEmployee = async (id) => {
        if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new UserError('Invalid user.');
        const r = await fetch(`${rest}/employees?id=eq.${enc(id)}&select=*`, { headers: serviceHeaders() });
        const e = (r.ok ? await r.json() : [])[0];
        if (!e) throw new UserError('User not found.', 404);
        return e;
    };
    // head_office may manage everyone except super admins
    const assertCanManage = (target) => {
        if (target.role === 'super_admin' && session.role !== 'super_admin') throw new UserError('Only a Super Admin can change another Super Admin.', 403);
    };

    try {
        if (req.method === 'GET') {
            const [er, ar] = await Promise.all([
                fetch(`${rest}/employees?select=id,full_name,username,role,branch,contact_number,recovery_email,is_driver,is_warehouse,warehouse_code,wh_pin_hash,active,created_at&order=full_name.asc`, { headers: serviceHeaders() }),
                fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: serviceHeaders() })
            ]);
            const employees = er.ok ? await er.json() : [];
            const authUsers = ar.ok ? ((await ar.json()).users || []) : [];
            const byId = Object.fromEntries(authUsers.map(u => [u.id, u]));
            return res.status(200).json({
                users: employees.map(({ wh_pin_hash, ...e }) => ({
                    ...e,
                    has_wh_pin: Boolean(wh_pin_hash),
                    role: normalizeRole(e.role) || e.role,
                    last_sign_in_at: byId[e.id]?.last_sign_in_at || null,
                    email_confirmed: Boolean(byId[e.id]?.email_confirmed_at),
                    is_me: e.id === session.user.id
                })),
                me: { id: session.user.id, role: session.role }
            });
        }

        const body = req.body || {};

        if (req.method === 'POST' && body.action === 'reset_password') {
            const emp = await loadEmployee(body.id);
            assertCanManage(emp);
            if (!emp.recovery_email) throw new UserError('This user has no email address.');
            const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
                body: JSON.stringify({ email: emp.recovery_email })
            });
            if (!r.ok) throw new UserError('Could not send the reset email. Try again in a minute.');
            return res.status(200).json({ success: true, message: `Password reset link sent to ${emp.recovery_email}.` });
        }

        if (req.method === 'PATCH') {
            const emp = await loadEmployee(body.id);
            assertCanManage(emp);
            const isSelf = emp.id === session.user.id;
            const patch = {};

            if ('full_name' in body) {
                const v = String(body.full_name || '').trim();
                if (!v || v.length > 120) throw new UserError('Name is required (max 120 characters).');
                patch.full_name = v;
            }
            if ('contact_number' in body) patch.contact_number = String(body.contact_number || '').trim().slice(0, 40) || null;
            if ('role' in body) {
                const role = normalizeRole(body.role);
                if (!role) throw new UserError('Invalid role.');
                if (role === 'super_admin' && session.role !== 'super_admin') throw new UserError('Only a Super Admin can grant Super Admin.', 403);
                if (isSelf && role !== emp.role) throw new UserError('You cannot change your own role.');
                patch.role = role;
            }
            if ('branch' in body) {
                const code = String(body.branch || '').trim();
                if (code) {
                    const br = await fetch(`${rest}/branches?branch_code=eq.${enc(code)}&select=branch_code&limit=1`, { headers: serviceHeaders() });
                    if (!(br.ok ? await br.json() : []).length) throw new UserError(`Branch ${code} does not exist.`);
                }
                patch.branch = code || null;
            }
            if ('is_driver' in body) patch.is_driver = Boolean(body.is_driver);
            if ('is_warehouse' in body) {
                patch.is_warehouse = Boolean(body.is_warehouse);
                if (patch.is_warehouse) {
                    const code = String(body.warehouse_code || '').trim();
                    const wr = await fetch(`${rest}/branches?branch_code=eq.${enc(code)}&branch_type=eq.warehouse&select=branch_code&limit=1`, { headers: serviceHeaders() });
                    if (!code || !(wr.ok ? await wr.json() : []).length) throw new UserError('Pick the warehouse this operator works in.');
                    if (code !== emp.warehouse_code) Object.assign(patch, { wh_pin_hash: null, wh_pin_failed: 0, wh_pin_locked_until: null });  // new warehouse → set a new PIN
                    patch.warehouse_code = code;
                } else {
                    Object.assign(patch, { warehouse_code: null, wh_pin_hash: null, wh_pin_failed: 0, wh_pin_locked_until: null });
                }
            }
            if ('active' in body) {
                if (isSelf && !body.active) throw new UserError('You cannot deactivate yourself.');
                patch.active = Boolean(body.active);
            }
            const finalRole = patch.role || emp.role;
            if (['branch_manager', 'staff'].includes(finalRole) && !('branch' in patch ? patch.branch : emp.branch)) {
                throw new UserError('Branch managers and staff need a branch.');
            }
            if (!Object.keys(patch).length) return res.status(200).json({ success: true });

            const r = await fetch(`${rest}/employees?id=eq.${enc(emp.id)}`, {
                method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(patch)
            });
            if (!r.ok) throw new UserError('Could not save user.');

            // Keep the login record in step: role in app_metadata; deactivated = blocked from signing in.
            const authPatch = {
                app_metadata: { role: finalRole, branch: 'branch' in patch ? patch.branch : emp.branch, is_driver: 'is_driver' in patch ? patch.is_driver : emp.is_driver }
            };
            if ('active' in patch) authPatch.ban_duration = patch.active ? 'none' : '876000h';
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${enc(emp.id)}`, { method: 'PUT', headers: serviceHeaders(), body: JSON.stringify(authPatch) });

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
