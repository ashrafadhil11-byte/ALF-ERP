// File: api/status.js — status list + status updates (single or bulk scan).
//   GET                      active statuses for dropdowns
//   GET  ?boxes=AWB          the shipment's boxes (for ticking which ones the update is for)
//   POST { awbs:[...], code, location?, remark?, event_at?, fwd_agent?, fwd_docket?, to_branch?, mawb?, driver?, pieces?: { AWB: [1,2] } }
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { cleanOrderNo } from '../_lib/booking-map.js';

const MAX_AWBS = 200;
const CAN_GO_BACK = ['super_admin', 'head_office', 'branch_manager'];
const enc = encodeURIComponent;

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;

    try {
        if (req.method === 'GET' && req.query?.boxes) {
            const awb = cleanOrderNo(req.query.boxes);
            const br = await fetch(`${rest}/bookings?or=(awb.eq.${enc(awb)},external_ref.eq.${enc(awb)})&select=id,awb,consignee,dest_city,dest_country,branch_code,current_status,pieces,booking_pieces(piece_no,weight,l,w,h,commodity,status)&limit=1`, { headers: serviceHeaders() });
            const bk = (br.ok ? await br.json() : [])[0];
            if (!bk || (!ADMIN_ROLES.includes(session.role) && bk.branch_code !== session.branch)) return res.status(404).json({ error: `Shipment ${awb} not found.` });
            const { booking_pieces: boxes = [], ...booking } = bk;
            return res.status(200).json({ booking, boxes: boxes.sort((a, b) => a.piece_no - b.piece_no) });
        }
        if (req.method === 'GET') {
            const r = await fetch(`${rest}/statuses?active=is.true&select=code,label,customer_label,stage,sort,is_exception,requires&order=is_exception,stage,sort`, { headers: serviceHeaders() });
            return res.status(200).json({ statuses: r.ok ? await r.json() : [] });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const b = req.body || {};
        const awbs = [...new Set((Array.isArray(b.awbs) ? b.awbs : []).map(cleanOrderNo).filter(Boolean))];
        if (!awbs.length) return res.status(400).json({ error: 'Scan at least one AWB.' });
        if (awbs.length > MAX_AWBS) return res.status(400).json({ error: `At most ${MAX_AWBS} AWBs per update.` });

        const sr = await fetch(`${rest}/statuses?code=eq.${enc(b.code || '')}&active=is.true&select=*`, { headers: serviceHeaders() });
        const status = (sr.ok ? await sr.json() : [])[0];
        if (!status) return res.status(400).json({ error: 'Choose a valid status.' });

        // Extra details some statuses need (set per status in the status master).
        const need = (field, label) => {
            if (status.requires.includes(field) && !String(b[label] || '').trim()) throw new UserError(`"${status.label}" needs ${label.replace('_', ' ')}.`);
        };
        need('agent_docket', 'fwd_agent');
        need('agent_docket', 'fwd_docket');
        need('to_branch', 'to_branch');
        need('mawb', 'mawb');
        need('driver', 'driver');

        // Non-admins may only update shipments held by their own branch.
        const list = awbs.map(a => `"${a.replace(/"/g, '')}"`).join(',');
        const br = await fetch(`${rest}/bookings?awb=in.(${enc(list)})&select=awb,branch_code`, { headers: serviceHeaders() });
        const found = br.ok ? await br.json() : [];
        const missing = awbs.filter(a => !found.some(f => f.awb === a));
        if (missing.length) return res.status(400).json({ error: `Not found: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}` });
        if (!ADMIN_ROLES.includes(session.role)) {
            const other = found.filter(f => f.branch_code !== session.branch).map(f => f.awb);
            if (other.length) return res.status(403).json({ error: `Held by another branch: ${other.slice(0, 10).join(', ')}` });
        }

        const extras = [
            b.to_branch && `To: ${b.to_branch}`,
            b.mawb && `MAWB: ${b.mawb}`,
            b.driver && `Driver: ${b.driver}`,
            b.fwd_agent && `Agent: ${b.fwd_agent} / ${b.fwd_docket}`
        ].filter(Boolean);
        const remark = [String(b.remark || '').trim(), ...extras].filter(Boolean).join(' • ') || null;

        // Boxes: shipments where only some boxes were ticked go one by one; the rest in one batch.
        const picked = b.pieces && typeof b.pieces === 'object' ? b.pieces : {};
        const partial = awbs.filter(a => Array.isArray(picked[a]) && picked[a].length);
        for (const a of partial) {
            const rp = await fetch(`${rest}/rpc/set_status_pieces`, {
                method: 'POST', headers: serviceHeaders(),
                body: JSON.stringify({
                    p_awb: a, p_pieces: picked[a].map(Number).filter(Number.isInteger), p_code: status.code, p_user_id: session.user.id,
                    p_user_name: session.employee?.full_name || session.user.email, p_branch: session.branch || 'HQ',
                    p_location: b.location ? String(b.location).trim() : null, p_remark: remark,
                    p_allow_back: CAN_GO_BACK.includes(session.role), p_source: 'scan'
                })
            });
            const po = await rp.json().catch(() => ({}));
            if (!rp.ok) return res.status(400).json({ error: `${a}: ${po.message || 'Status update failed.'}` });
        }
        const whole = awbs.filter(a => !partial.includes(a));
        if (!whole.length) return res.status(200).json({ success: true, updated: partial.length, status: status.label });
        const r = await fetch(`${rest}/rpc/set_status`, {
            method: 'POST',
            headers: serviceHeaders(),
            body: JSON.stringify({
                p_awbs: whole,
                p_code: status.code,
                p_user_id: session.user.id,
                p_user_name: session.employee?.full_name || session.user.email,
                p_branch: session.branch || 'HQ',
                p_location: b.location ? String(b.location).trim() : null,
                p_remark: remark,
                p_event_at: b.event_at || new Date().toISOString(),
                p_allow_back: CAN_GO_BACK.includes(session.role),
                p_source: 'scan'
            })
        });
        const out = await r.json();
        if (!r.ok) return res.status(400).json({ error: out.message || 'Status update failed.' });

        if (b.fwd_agent || b.fwd_docket) {
            await fetch(`${rest}/bookings?awb=in.(${enc(list)})`, {
                method: 'PATCH',
                headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
                body: JSON.stringify({ fwd_agent: b.fwd_agent || null, fwd_docket: b.fwd_docket || null })
            });
        }
        return res.status(200).json({ success: true, updated: out + partial.length, status: status.label });
    } catch (e) {
        if (e instanceof UserError) return res.status(400).json({ error: e.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

class UserError extends Error {}
