// File: api/_routes/pickups.js — pickup requests (collect cargo at the customer's door).
//   GET [?date=YYYY-MM-DD&branch=]     board for a day: requests + drivers (staff see their branch; admins any)
//   GET ?mine=1                        a driver's open pickups (today and earlier, not done)
//   GET ?id=N                          one pickup (also used by the booking form to fill the sender)
//   POST { action:'create', branch?, customer_name, phone, address, city?, pickup_date, slot, pieces?, weight_kg?, dest_country?, notes? }
//   POST { action:'assign', id, driver_id }            managers / admins
//   POST { action:'picked', id, pieces? }              the driver (or a manager)
//   POST { action:'fail', id, reason } | { action:'cancel', id, reason }
//   POST { action:'booked', id, awb }                  the booking made from it (booking form)
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

const enc = encodeURIComponent;
const MANAGERS = [...ADMIN_ROLES, 'branch_manager'];
const SLOTS = ['morning', 'afternoon', 'evening', 'any'];
const SEL = 'id,pickup_no,branch_code,customer_id,customer_name,phone,address,city,lat,lng,pickup_date,slot,pieces,weight_kg,dest_country,notes,status,driver_id,driver_name,assigned_at,picked_up_at,picked_pieces,booking_awb,reason,source,created_at,created_by_name';
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const today = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);   // Oman day

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const isManager = MANAGERS.includes(session.role);
    const me = session.user.id;
    const userName = session.employee?.full_name || session.user.email;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const write = async (method, path, body) => {
        const r = await fetch(`${rest}/${path}`, { method, headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(body) });
        const out = await r.json().catch(() => null);
        if (!r.ok) throw new UserError(out?.message || 'Could not save.', 500);
        return Array.isArray(out) ? out[0] : out;
    };
    // a pickup this user may see / act on: admins any; others their branch; drivers also the ones assigned to them
    const load = async (id) => {
        if (!/^\d+$/.test(String(id || ''))) throw new UserError('Pickup not found.', 404);
        const p = (await get(`pickup_requests?id=eq.${id}&select=${SEL}`))[0];
        if (!p || !(isAdmin || p.branch_code === session.branch || p.driver_id === me)) throw new UserError('Pickup not found.', 404);
        return p;
    };
    const branchOf = (asked) => {
        const b = isAdmin ? str(asked || session.branch, 20).toUpperCase() : session.branch;
        if (!b) throw new UserError('Choose the branch.');
        return b;
    };

    try {
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.id) return res.status(200).json({ pickup: await load(q.id) });
            if (q.mine) {
                const list = await get(`pickup_requests?driver_id=eq.${enc(me)}&status=eq.assigned&pickup_date=lte.${today()}&select=${SEL}&order=pickup_date.asc,slot.asc`);
                return res.status(200).json({ pickups: list });
            }
            const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? q.date : today();
            const branch = isAdmin ? (q.branch ? str(q.branch, 20).toUpperCase() : '') : session.branch;
            const bf = branch ? `&branch_code=eq.${enc(branch)}` : '';
            const [day, overdue, drivers, branches] = await Promise.all([
                get(`pickup_requests?pickup_date=eq.${date}${bf}&select=${SEL}&order=slot.asc,created_at.asc&limit=300`),
                // still open from earlier days
                get(`pickup_requests?pickup_date=lt.${date}&status=in.(requested,assigned)${bf}&select=${SEL}&order=pickup_date.asc&limit=100`),
                get(`employees?is_driver=is.true&active=not.is.false${branch ? `&branch=eq.${enc(branch)}` : ''}&select=id,full_name,branch&order=full_name.asc`),
                isAdmin ? get('branches?branch_type=eq.branch&status=neq.Dismissed&select=branch_code,branch_name&order=branch_name') : []
            ]);
            return res.status(200).json({ date, pickups: [...overdue, ...day], drivers, branches, me: { id: me, is_driver: Boolean(session.employee?.is_driver), manager: isManager, branch: session.branch } });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        switch (b.action) {
            case 'create': {
                const branch = branchOf(b.branch);
                const br = (await get(`branches?branch_code=eq.${enc(branch)}&select=branch_code,branch_type`))[0];
                if (!br || br.branch_type !== 'branch') throw new UserError('Pickups belong to a branch.');
                const row = {
                    branch_code: branch, customer_name: str(b.customer_name, 80), phone: str(b.phone, 30), address: str(b.address, 300), city: str(b.city, 80) || null,
                    pickup_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.pickup_date || '')) ? b.pickup_date : today(),
                    slot: SLOTS.includes(b.slot) ? b.slot : 'any', pieces: Math.max(0, Math.trunc(+b.pieces || 0)) || null, weight_kg: Math.max(0, +b.weight_kg || 0) || null,
                    dest_country: str(b.dest_country, 60) || null, notes: str(b.notes, 500) || null, created_by_name: userName, source: 'staff'
                };
                if (!row.customer_name) throw new UserError('Enter the customer name.');
                if (row.phone.replace(/\D/g, '').length < 7) throw new UserError('Enter the customer phone.');
                if (!row.address) throw new UserError('Enter the pickup address.');
                if (row.pickup_date < today()) throw new UserError('The pickup date cannot be in the past.');
                const p = await write('POST', 'pickup_requests', row);
                return res.status(200).json({ success: true, pickup: p });
            }
            case 'assign': {
                if (!isManager) throw new UserError('Only managers assign drivers.', 403);
                const p = await load(b.id);
                if (!['requested', 'assigned', 'failed'].includes(p.status)) throw new UserError(`${p.pickup_no} is already ${p.status.replace('_', ' ')}.`);
                const d = (await get(`employees?id=eq.${enc(b.driver_id || '')}&is_driver=is.true&active=not.is.false&select=id,full_name,branch`))[0];
                if (!d) throw new UserError('Choose a driver.');
                await write('PATCH', `pickup_requests?id=eq.${p.id}`, { status: 'assigned', driver_id: d.id, driver_name: d.full_name, assigned_at: new Date().toISOString(), reason: null, updated_at: new Date().toISOString() });
                return res.status(200).json({ success: true });
            }
            case 'picked': {
                const p = await load(b.id);
                if (p.driver_id !== me && !isManager) throw new UserError('This pickup is assigned to someone else.', 403);
                if (p.status !== 'assigned') throw new UserError(`${p.pickup_no} is ${p.status.replace('_', ' ')}.`);
                await write('PATCH', `pickup_requests?id=eq.${p.id}`, { status: 'picked_up', picked_up_at: new Date().toISOString(), picked_pieces: Math.max(0, Math.trunc(+b.pieces || 0)) || p.pieces, updated_at: new Date().toISOString() });
                return res.status(200).json({ success: true });
            }
            case 'fail':
            case 'cancel': {
                const p = await load(b.id);
                const reason = str(b.reason, 200);
                if (!reason) throw new UserError('Give a reason.');
                if (b.action === 'fail' && p.driver_id !== me && !isManager) throw new UserError('This pickup is assigned to someone else.', 403);
                if (['booked', 'cancelled'].includes(p.status) || (b.action === 'fail' && p.status !== 'assigned')) throw new UserError(`${p.pickup_no} is ${p.status.replace('_', ' ')}.`);
                await write('PATCH', `pickup_requests?id=eq.${p.id}`, { status: b.action === 'fail' ? 'failed' : 'cancelled', reason, updated_at: new Date().toISOString() });
                return res.status(200).json({ success: true });
            }
            case 'booked': {
                const p = await load(b.id);
                const awb = str(b.awb, 30).toUpperCase();
                if (!(await get(`bookings?awb=eq.${enc(awb)}&select=awb`)).length) throw new UserError('Shipment not found.');
                if (['cancelled', 'booked'].includes(p.status)) throw new UserError(`${p.pickup_no} is ${p.status}.`);
                await write('PATCH', `pickup_requests?id=eq.${p.id}`, { status: 'booked', booking_awb: awb, picked_up_at: p.picked_up_at || new Date().toISOString(), updated_at: new Date().toISOString() });
                return res.status(200).json({ success: true });
            }
            default: throw new UserError('Unknown action.');
        }
    } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: 'Pickup request failed.', details: e.message });
    }
}
