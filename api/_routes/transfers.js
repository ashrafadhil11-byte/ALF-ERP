// File: api/_routes/transfers.js — outbound / inbound between branches (transfer manifests).
//   GET [?branch=X]          incoming + outgoing manifests, cargo on hand here (box level), branch list (admins may act for any branch)
//   GET ?id=N                one manifest with its shipments (for checking / printing)
//   POST { action:'outbound', awbs, to_branch, vehicle?, driver?, seal?, notes?, branch?, pieces?: { AWB: [1,2] } }   boxes sent
//   POST { action:'inbound',  awbs, note?, branch?, pieces?: { AWB: [1] } }   boxes that arrived (rest = missing)   → per-AWB results (received / wrong_branch / not_expected / …)
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
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    // Admins can act for any branch; everyone else is fixed to their own.
    const branchFor = (asked) => {
        const b = isAdmin ? String(asked || session.branch || '').trim().toUpperCase() : session.branch;
        if (!b) throw new UserError('Choose the branch you are working at.');
        return b;
    };

    try {
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.id) {
                const m = (await get(`transfer_manifests?id=eq.${enc(q.id)}&select=*`))[0];
                if (!m) return res.status(404).json({ error: 'Manifest not found.' });
                if (!isAdmin && ![m.from_branch, m.to_branch].includes(session.branch)) return res.status(403).json({ error: 'Not your branch.' });
                const items = await get(`transfers?manifest_id=eq.${enc(q.id)}&select=status,inbound_at,note,bookings(awb,shipper,consignee,dest_city,dest_country,pieces,weight,current_status)&order=id.asc`);
                return res.status(200).json({ manifest: m, items });
            }
            const branch = branchFor(q.branch);
            const since = new Date(Date.now() - 30 * 864e5).toISOString();
            const [incoming, outgoing, held, branches] = await Promise.all([
                get(`transfer_manifests?to_branch=eq.${enc(branch)}&status=in.(in_transit,partial)&select=*,transfers(status,pieces,missing_pieces,bookings(awb,consignee,pieces,weight))&order=created_at.asc`),
                get(`transfer_manifests?from_branch=eq.${enc(branch)}&created_at=gte.${enc(since)}&select=*,transfers(status,missing_pieces)&order=created_at.desc&limit=60`),
                // cargo on hand: the boxes that are here (not those already on a manifest that is on the way)
                fetch(`${rest}/rpc/cargo_stock`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_branch: branch }) }).then(r => r.ok ? r.json() : []),
                get(`branches?select=branch_code,branch_name,branch_type,is_hub,status&order=branch_name.asc`)
            ]);
            return res.status(200).json({
                branch,
                incoming,
                outgoing,
                // pieces = boxes here; boxes = which ones (fewer than boxes_total when the rest are elsewhere)
                held: held.map(h => ({ awb: h.awb, consignee: h.consignee, dest_city: h.dest_city, dest_country: h.dest_country, current_status: h.current_status,
                                       pieces: (h.boxes || []).length, boxes: h.boxes, boxes_total: h.boxes_total, weight: +h.weight || 0, cbm: +h.cbm || 0 })),
                // cargo goes to a branch or the warehouse, never to Main Office
                branches: branches.filter(b => b.status !== 'Dismissed' && b.branch_type !== 'main_office'),
                can_switch: isAdmin
            });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        const awbs = [...new Set((Array.isArray(b.awbs) ? b.awbs : []).map(cleanOrderNo).filter(Boolean))];
        if (!awbs.length) throw new UserError('Scan at least one shipment.');
        if (awbs.length > MAX) throw new UserError(`At most ${MAX} shipments at a time.`);
        const branch = branchFor(b.branch);
        const pieces = b.pieces && typeof b.pieces === 'object' ? Object.fromEntries(Object.entries(b.pieces).map(([k, v]) => [cleanOrderNo(k), (Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger)])) : null;

        if (b.action === 'outbound') {
            const out = await rpc('transfer_outbound', {
                p_awbs: awbs, p_from: branch, p_to: String(b.to_branch || '').toUpperCase(),
                p_vehicle: b.vehicle || null, p_driver: b.driver || null, p_seal: b.seal || null, p_notes: b.notes || null,
                p_user_id: session.user.id, p_user_name: userName, p_pieces: pieces
            });
            return res.status(200).json({ success: true, ...out });
        }
        if (b.action === 'inbound') {
            const results = await rpc('transfer_inbound', { p_awbs: awbs, p_branch: branch, p_user_id: session.user.id, p_user_name: userName, p_note: b.note || null, p_pieces: pieces });
            return res.status(200).json({ success: true, results });
        }
        throw new UserError('Unknown action.');
    } catch (e) {
        if (e instanceof UserError) return res.status(400).json({ error: e.message });
        return res.status(500).json({ error: 'Transfer failed.', details: e.message });
    }
}
