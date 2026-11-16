// File: api/_routes/consolidation.js — MAWB / bag consolidation.
//   GET                     consolidations (open first, last 90 days) with piece / weight totals
//   GET ?id=N               one consolidation with its shipments
//   POST { action:'create', mawb, kind:'mawb'|'bag', carrier?, flight_no?, departure_date?, dest_country?, notes? }
//   POST { action:'add', id, awbs }      POST { action:'remove', id, awb }
//   POST { action:'close' | 'reopen', id }
// Status for everything inside: the page sends the AWB list to /api/status (same rules as Scan & Update).
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { cleanOrderNo } from '../_lib/booking-map.js';

const enc = encodeURIComponent;
const MAX = 300;
class UserError extends Error {}

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const userName = session.employee?.full_name || session.user.email;
    const branch = session.branch || 'HQ';
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    const load = async (id) => {
        const c = (await get(`consolidations?id=eq.${enc(id)}&select=*`))[0];
        if (!c) throw new UserError('Consolidation not found.');
        if (!isAdmin && c.origin_branch && c.origin_branch !== session.branch) throw new UserError('This consolidation belongs to another branch.');
        return c;
    };
    const scope = isAdmin ? '' : `&origin_branch=eq.${enc(session.branch || '-')}`;

    try {
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.id) {
                const c = await load(q.id);
                const items = await get(`consolidation_items?consolidation_id=eq.${enc(q.id)}&select=added_at,bookings(awb,shipper,consignee,dest_city,dest_country,pieces,weight,chargeable_weight,current_status,current_status_code,branch_code)&order=added_at.asc`);
                return res.status(200).json({ consolidation: c, items: items.map(i => ({ ...i.bookings, added_at: i.added_at })) });
            }
            const since = new Date(Date.now() - 90 * 864e5).toISOString();
            const list = await get(`consolidations?or=(closed.is.false,created_at.gte.${enc(since)})${scope}&select=*,consolidation_items(bookings(pieces,weight))&order=closed.asc,created_at.desc&limit=100`);
            return res.status(200).json({
                consolidations: list.map(({ consolidation_items: items = [], ...c }) => ({
                    ...c,
                    shipments: items.length,
                    pieces: items.reduce((s, i) => s + (+i.bookings?.pieces || 0), 0),
                    weight: Math.round(items.reduce((s, i) => s + (+i.bookings?.weight || 0), 0) * 100) / 100
                }))
            });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};

        if (b.action === 'create') {
            const mawb = String(b.mawb || '').trim().toUpperCase().replace(/\s+/g, '');
            if (!/^[A-Z0-9-]{3,30}$/.test(mawb)) throw new UserError('Enter the MAWB / bag number (letters, numbers, dashes).');
            const kind = b.kind === 'bag' ? 'bag' : 'mawb';
            if (kind === 'mawb' && /^\d{3}-?\d{8}$/.test(mawb)) {
                // IATA check digit: last digit = first 7 digits of the serial mod 7
                const serial = mawb.replace('-', '').slice(3);
                if (+serial.slice(0, 7) % 7 !== +serial[7]) throw new UserError(`MAWB ${mawb} fails the check digit — please re-check the number.`);
            }
            const r = await fetch(`${rest}/consolidations`, {
                method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
                body: JSON.stringify({
                    mawb, kind, origin_branch: branch, carrier: b.carrier || null, flight_no: b.flight_no || null,
                    departure_date: b.departure_date || null, dest_country: b.dest_country || null, notes: b.notes || null,
                    created_by: session.user.id, created_by_name: userName
                })
            });
            const out = await r.json().catch(() => ({}));
            if (!r.ok) throw new UserError(/duplicate|unique/i.test(out.message || '') ? `${mawb} already exists.` : out.message || 'Could not create.');
            return res.status(200).json({ success: true, consolidation: out[0] });
        }

        const c = await load(b.id);
        if (b.action === 'add') {
            const awbs = [...new Set((Array.isArray(b.awbs) ? b.awbs : []).map(cleanOrderNo).filter(Boolean))];
            if (!awbs.length) throw new UserError('Scan at least one shipment.');
            if (awbs.length > MAX) throw new UserError(`At most ${MAX} shipments at a time.`);
            if (!isAdmin) {
                const list = awbs.map(a => `"${a.replace(/"/g, '')}"`).join(',');
                const found = await get(`bookings?awb=in.(${enc(list)})&select=awb,branch_code`);
                const other = found.filter(f => f.branch_code !== session.branch).map(f => f.awb);
                if (other.length) throw new UserError(`Held by another branch: ${other.slice(0, 10).join(', ')}`);
            }
            const added = await rpc('consolidation_add', { p_id: c.id, p_awbs: awbs, p_user_id: session.user.id, p_user_name: userName, p_branch: branch });
            return res.status(200).json({ success: true, added });
        }
        if (b.action === 'remove') {
            await rpc('consolidation_remove', { p_id: c.id, p_awb: cleanOrderNo(b.awb), p_user_id: session.user.id, p_user_name: userName, p_branch: branch });
            return res.status(200).json({ success: true });
        }
        if (b.action === 'close' || b.action === 'reopen') {
            const closed = b.action === 'close';
            const r = await fetch(`${rest}/consolidations?id=eq.${enc(c.id)}`, {
                method: 'PATCH', headers: serviceHeaders(),
                body: JSON.stringify({ closed, closed_at: closed ? new Date().toISOString() : null })
            });
            if (!r.ok) throw new UserError('Could not update.');
            return res.status(200).json({ success: true, closed });
        }
        throw new UserError('Unknown action.');
    } catch (e) {
        if (e instanceof UserError) return res.status(400).json({ error: e.message });
        return res.status(500).json({ error: 'Consolidation update failed.', details: e.message });
    }
}
