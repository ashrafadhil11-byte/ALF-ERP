// File: api/_routes/delivery.js — Phase B: delivery runs + proof of delivery.
//   GET                       board: ready to deliver, out for delivery, done today, drivers
//   GET ?mine=1               a driver's own open deliveries
//   GET ?awb=X                delivery attempts of one shipment (POD images as 10-minute signed links)
//   POST { action:'dispatch', awbs, mode:'driver'|'agent', driver_id?, agent_name?, agent_ref? }
//   POST { action:'complete', awb, outcome:'delivered'|'failed', received_by?, relation?, id_no?, reason?, notes?,
//          photo?: dataURL, signature?: dataURL, lat?, lng? }
//   POST { action:'review_sent', awb }   marks "Review Requested" after the WhatsApp / email link was sent
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { cleanOrderNo } from '../_lib/booking-map.js';

const enc = encodeURIComponent;
const MAX_DISPATCH = 100;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
// Shipments that can be sent out: arrived / cleared at destination, waiting for collection, or a failed attempt
export const READY_CODES = ['ARRIVED_DEST_PORT', 'IMPORT_CLEARED', 'ARRIVED_DEST_HUB', 'READY_FOR_COLLECTION', 'DELIVERY_FAILED'];
export const FAIL_REASONS = ['Customer not reachable', 'Customer not available', 'Wrong / incomplete address', 'Customer refused', 'Payment / COD not ready', 'Area not accessible', 'Rescheduled by customer', 'Other'];

class UserError extends Error {}

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const userName = session.employee?.full_name || session.user.email;
    const branchFilter = isAdmin ? '' : `&branch_code=eq.${enc(session.branch || '-')}`;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };

    try {
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.awb) {
                const awb = cleanOrderNo(q.awb);
                const rows = await get(`deliveries?awb=eq.${enc(awb)}&select=*&order=attempt.asc`);
                for (const d of rows) {
                    d.pod_photo_url = d.pod_photo ? await signedUrl(d.pod_photo) : null;
                    d.pod_signature_url = d.pod_signature ? await signedUrl(d.pod_signature) : null;
                }
                return res.status(200).json({ deliveries: rows });
            }

            const BK = 'awb,consignee,consignee_phone,receiver_whatsapp,consignee_address,dest_city,dest_country,pieces,weight,amount,payment_method,current_status_code,current_status,branch_code,updated_at';
            if (q.mine) {
                const out = await get(`deliveries?status=eq.out&driver_id=eq.${enc(session.user.id)}&select=*,bookings(${BK})&order=assigned_at.asc`);
                return res.status(200).json({ out, reasons: FAIL_REASONS });
            }
            const since = new Date(); since.setHours(0, 0, 0, 0);
            const [ready, out, done, drivers] = await Promise.all([
                get(`bookings?current_status_code=in.(${READY_CODES.join(',')})&archived=is.false${branchFilter}&select=${BK}&order=updated_at.asc&limit=300`),
                get(`deliveries?status=eq.out${branchFilter}&select=*,bookings(${BK})&order=assigned_at.asc&limit=300`),
                get(`deliveries?status=in.(delivered,failed)&completed_at=gte.${enc(since.toISOString())}${branchFilter}&select=id,awb,attempt,mode,status,driver_name,agent_name,received_by,failure_reason,completed_at,pod_photo,pod_signature,bookings(consignee,consignee_phone,receiver_whatsapp,review_token,reviewed_at)&order=completed_at.desc&limit=200`),
                get(`employees?is_driver=is.true&active=is.true${isAdmin ? '' : `&branch=eq.${enc(session.branch || '-')}`}&select=id,full_name,branch&order=full_name.asc`)
            ]);
            return res.status(200).json({ ready, out, done, drivers, reasons: FAIL_REASONS, me: { id: session.user.id, role: session.role, is_driver: Boolean(session.employee?.is_driver) } });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};

        if (b.action === 'dispatch') {
            const awbs = [...new Set((Array.isArray(b.awbs) ? b.awbs : []).map(cleanOrderNo).filter(Boolean))];
            if (!awbs.length) throw new UserError('Choose at least one shipment.');
            if (awbs.length > MAX_DISPATCH) throw new UserError(`At most ${MAX_DISPATCH} shipments per run.`);
            await checkBranch(awbs);
            let driverName = null;
            if (b.mode === 'driver') {
                const drv = (await get(`employees?id=eq.${enc(b.driver_id || '')}&is_driver=is.true&select=id,full_name,branch`))[0];
                if (!drv) throw new UserError('Choose a driver from the list.');
                driverName = drv.full_name;
            }
            const out = await rpc('delivery_dispatch', {
                p_awbs: awbs, p_mode: b.mode, p_driver_id: b.mode === 'driver' ? b.driver_id : null, p_driver_name: driverName,
                p_agent_name: b.agent_name || null, p_agent_ref: b.agent_ref || null,
                p_user_id: session.user.id, p_user_name: userName, p_branch: session.branch || 'HQ'
            });
            return res.status(200).json({ success: true, dispatched: out });
        }

        if (b.action === 'complete') {
            const awb = cleanOrderNo(b.awb);
            if (!awb) throw new UserError('AWB is required.');
            if (!['delivered', 'failed'].includes(b.outcome)) throw new UserError('Choose delivered or failed.');
            // A driver may close their own run even if the shipment is held by another branch.
            const open = (await get(`deliveries?awb=eq.${enc(awb)}&status=eq.out&select=driver_id`))[0];
            if (!(open && open.driver_id === session.user.id)) await checkBranch([awb]);

            const stamp = Date.now();
            const photo = b.photo ? await upload(`${awb}/${stamp}-photo`, b.photo) : null;
            const signature = b.signature ? await upload(`${awb}/${stamp}-signature`, b.signature) : null;
            const out = await rpc('delivery_complete', {
                p_awb: awb, p_outcome: b.outcome, p_received_by: b.received_by || null, p_relation: b.relation || null,
                p_id_no: b.id_no || null, p_reason: b.reason || null, p_notes: b.notes || null,
                p_photo: photo, p_signature: signature,
                p_lat: Number.isFinite(+b.lat) && b.lat !== null && b.lat !== '' ? +b.lat : null,
                p_lng: Number.isFinite(+b.lng) && b.lng !== null && b.lng !== '' ? +b.lng : null,
                p_user_id: session.user.id, p_user_name: userName, p_branch: session.branch || 'HQ'
            });
            return res.status(200).json({ success: true, ...out });
        }

        if (b.action === 'review_sent') {
            const awb = cleanOrderNo(b.awb);
            await checkBranch([awb]);
            const bk = (await get(`bookings?awb=eq.${enc(awb)}&select=current_status_code,review_token`))[0];
            if (!bk?.review_token) throw new UserError('Review links are available after delivery.');
            if (bk.current_status_code === 'DELIVERED') {
                await rpc('set_status', {
                    p_awbs: [awb], p_code: 'REVIEW_REQUESTED', p_user_id: session.user.id, p_user_name: userName,
                    p_branch: session.branch || 'HQ', p_remark: `Review link sent (${String(b.channel || 'link').slice(0, 20)})`, p_allow_back: false, p_source: 'manual'
                });
            }
            return res.status(200).json({ success: true });
        }

        throw new UserError('Unknown action.');
    } catch (e) {
        if (e instanceof UserError) return res.status(400).json({ error: e.message });
        return res.status(500).json({ error: 'Delivery update failed.', details: e.message });
    }

    // ---------- helpers ----------
    async function checkBranch(awbs) {
        const list = awbs.map(a => `"${a.replace(/"/g, '')}"`).join(',');
        const found = await get(`bookings?awb=in.(${enc(list)})&select=awb,branch_code`);
        const missing = awbs.filter(a => !found.some(f => f.awb === a));
        if (missing.length) throw new UserError(`Not found: ${missing.slice(0, 10).join(', ')}`);
        if (isAdmin) return;
        const other = found.filter(f => f.branch_code !== session.branch).map(f => f.awb);
        if (other.length) throw new UserError(`Held by another branch: ${other.slice(0, 10).join(', ')}`);
    }
    async function rpc(fn, body) {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    }
}

/** data:image/...;base64 → private "pod" bucket. Returns the storage path. */
export async function upload(name, dataUrl) {
    const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new UserError('POD image must be a JPEG, PNG or WebP picture.');
    const bytes = Buffer.from(m[3], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new UserError('POD image is too large (max 3 MB).');
    const path = `${name}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`;
    const h = serviceHeaders();
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/pod/${path}`, {
        method: 'POST',
        headers: { apikey: h.apikey, Authorization: h.Authorization, 'Content-Type': m[1], 'x-upsert': 'true' },
        body: bytes
    });
    if (!r.ok) throw new UserError(`Could not save the POD image (${r.status}).`);
    return path;
}

async function signedUrl(path) {
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/sign/pod/${path}`, {
        method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ expiresIn: 600 })
    });
    const j = r.ok ? await r.json() : null;
    return j?.signedURL ? `${process.env.SUPABASE_URL}/storage/v1${j.signedURL}` : null;
}
