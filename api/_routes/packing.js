// File: api/_routes/packing.js — packing list per box (optional, quick entry; items are often mixed personal effects).
//   GET  ?awb=X        { shipment:{ awb, shipper, consignee, dest_city, dest_country, pieces, branch_code }, boxes:[1..n], items:[…], common:[…] }
//   POST { action:'add', awb, piece_no, item, qty?, value? }   → { item }
//   POST { action:'qty', id, qty } | { action:'edit', id, item?, qty?, value? } | { action:'delete', id }
//   POST { action:'clear_box', awb, piece_no }
// Same branch rule as the shipment: staff and managers their own branch's shipments; head office all.
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { cleanOrderNo } from '../_lib/booking-map.js';

const enc = encodeURIComponent;
const SEL = 'id,piece_no,item,qty,value,created_by_name,created_at';
// common personal-effects items, offered as one-tap chips until the branch has its own favourites
export const COMMON = ['Clothes', 'Shoes', 'Bags', 'Bed sheets', 'Blankets', 'Towels', 'Kitchen utensils', 'Toys', 'Books', 'Cosmetics',
    'Toiletries', 'Perfume', 'Dry food', 'Spices', 'Dates', 'Sweets', 'Medicines (personal)', 'Electronics', 'Mobile accessories', 'Watches', 'Documents', 'Household items'];
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// "Clothes" ← "clothes", keeps short words like "TV" as typed
const tidy = (s) => s.length <= 3 ? s : s.charAt(0).toUpperCase() + s.slice(1);

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const send = async (method, path, body) => {
        const r = await fetch(`${rest}/${path}`, { method, headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new UserError(`Could not save (${r.status}).`, 500);
        return r.json();
    };
    // the shipment, if this user may see it
    const shipment = async (awbIn) => {
        const awb = cleanOrderNo(awbIn);
        if (!awb) throw new UserError('Which shipment (AWB)?');
        const b = (await get(`bookings?or=(awb.eq.${enc(awb)},external_ref.eq.${enc(awb)})&select=id,awb,shipper,consignee,dest_city,dest_country,pieces,boxes,branch_code,booking_pieces(piece_no)&limit=1`))[0];
        if (!b || (!isAdmin && b.branch_code !== session.branch)) throw new UserError(`Shipment ${awb} not found.`, 404);
        return b;
    };
    const boxesOf = (b) => {
        const listed = (b.booking_pieces || []).map(p => p.piece_no).filter(n => n > 0);
        const n = Math.max(1, Math.min(999, +b.pieces || +b.boxes || listed.length || 1));
        return [...new Set([...Array.from({ length: n }, (_, i) => i + 1), ...listed])].sort((x, y) => x - y);
    };
    // one item line, if its shipment is this user's
    const line = async (id) => {
        if (!/^\d+$/.test(String(id || ''))) throw new UserError('Item not found.', 404);
        const p = (await get(`packing_items?id=eq.${id}&select=id,booking_id,bookings!inner(branch_code)`))[0];
        if (!p || (!isAdmin && p.bookings.branch_code !== session.branch)) throw new UserError('Item not found.', 404);
        return p;
    };

    try {
        if (req.method === 'GET') {
            const b = await shipment(req.query?.awb);
            const [items, top] = await Promise.all([
                get(`packing_items?booking_id=eq.${b.id}&select=${SEL}&order=piece_no.asc,id.asc`),
                fetch(`${rest}/rpc/packing_top_items`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_branch: isAdmin ? null : session.branch, p_limit: 24 }) }).then(r => r.ok ? r.json() : []).catch(() => [])
            ]);
            const mine = top.map(t => t.item);
            const common = [...new Set([...mine, ...COMMON])].slice(0, 24);
            const { id, booking_pieces, ...ship } = b;
            return res.status(200).json({ shipment: ship, boxes: boxesOf(b), items, common });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const body = req.body || {};
        const who = session.employee?.full_name || session.user.email || null;
        switch (body.action) {
            case 'add': {
                const b = await shipment(body.awb);
                const piece = Math.round(num(body.piece_no) || 0);
                if (!boxesOf(b).includes(piece)) throw new UserError('Choose one of the shipment\'s boxes.');
                const item = tidy(str(body.item, 120));
                if (!item) throw new UserError('What is the item?');
                const qty = num(body.qty) ?? 1;
                if (!(qty > 0 && qty <= 100000)) throw new UserError('Quantity must be more than 0.');
                const value = body.value === '' || body.value == null ? null : num(body.value);
                if (value !== null && value < 0) throw new UserError('Value cannot be negative.');
                // the same item again in the same box adds to its quantity (tapping a chip twice = 2)
                const same = (await get(`packing_items?booking_id=eq.${b.id}&piece_no=eq.${piece}&item=ilike.${enc(item.replace(/[%_*,()]/g, ''))}&select=${SEL}&limit=1`))[0];
                if (same && value === null) {
                    const [row] = await send('PATCH', `packing_items?id=eq.${same.id}&select=${SEL}`, { qty: +same.qty + qty });
                    return res.status(200).json({ item: row, merged: true });
                }
                const [row] = await send('POST', `packing_items?select=${SEL}`, { booking_id: b.id, piece_no: piece, item, qty, value, created_by_name: who });
                return res.status(200).json({ item: row });
            }
            case 'qty': case 'edit': {
                const p = await line(body.id);
                const patch = {};
                if ('qty' in body) { const q = num(body.qty); if (!(q > 0 && q <= 100000)) throw new UserError('Quantity must be more than 0.'); patch.qty = q; }
                if (body.action === 'edit' && 'item' in body) { patch.item = tidy(str(body.item, 120)); if (!patch.item) throw new UserError('What is the item?'); }
                if (body.action === 'edit' && 'value' in body) { const v = body.value === '' || body.value == null ? null : num(body.value); if (v !== null && v < 0) throw new UserError('Value cannot be negative.'); patch.value = v; }
                const [row] = await send('PATCH', `packing_items?id=eq.${p.id}&select=${SEL}`, patch);
                return res.status(200).json({ item: row });
            }
            case 'delete': {
                const p = await line(body.id);
                await send('DELETE', `packing_items?id=eq.${p.id}`);
                return res.status(200).json({ success: true });
            }
            case 'clear_box': {
                const b = await shipment(body.awb);
                const piece = Math.round(num(body.piece_no) || 0);
                await send('DELETE', `packing_items?booking_id=eq.${b.id}&piece_no=eq.${piece}`);
                return res.status(200).json({ success: true });
            }
            default: throw new UserError('Unknown action.');
        }
    } catch (e) {
        return res.status(e.status || 500).json({ error: e.status ? e.message : 'Packing list error.', details: e.status ? undefined : e.message });
    }
}

/** "Box 1: 3 Clothes, 2 Shoes · Box 2: …" for each booking id (manifest exports) */
export async function packingSummaries(bookingIds) {
    if (!bookingIds.length) return {};
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/packing_items?booking_id=in.(${bookingIds.map(enc).join(',')})&select=booking_id,piece_no,item,qty&order=piece_no.asc,id.asc`, { headers: serviceHeaders() });
    const rows = r.ok ? await r.json() : [];
    const out = {};
    for (const x of rows) ((out[x.booking_id] ||= {})[x.piece_no] ||= []).push(`${+x.qty} ${x.item}`);
    return Object.fromEntries(Object.entries(out).map(([id, boxes]) => [id, Object.entries(boxes).map(([n, l]) => `Box ${n}: ${l.join(', ')}`).join(' · ')]));
}
