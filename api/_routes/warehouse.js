// File: api/_routes/warehouse.js — warehouse operator page (separate PIN, short unlock).
// Any user can be a warehouse operator (Staff & Users → Warehouse operator + which warehouse).
// Even then, nothing here works until they unlock with their own PIN (stops accidental updates).
//
//   GET  ?view=status                         access, has PIN, locked until
//   POST { action:'set_pin', pin, current_pin? }   first time: no current PIN needed
//   POST { action:'unlock', pin }             → { token, expires_at }  (5 wrong PINs = locked 15 min)
//   POST { action:'reset_pin', employee_id }  super admin / head office
//   — with header x-warehouse-token —
//   GET  ?view=requests | stock | purchases
//   POST { action:'dispatch', id, lines } | { action:'reject', id, reason } | { action:'price', product_id, sell_price, reorder_level }
//        | { action:'count', product_id, counted, note } | { action:'purchase', supplier_id?, pay_method, lines, bill_ref?, date? }
//        | { action:'item', sku, name, unit, sell_price }
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { warehouseOf, isSuperAdmin, pinAction } from '../_lib/pin.js';

const enc = encodeURIComponent;
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const e = session.employee || {};
    const userName = e.full_name || session.user.email;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const patchEmp = (id, body) => fetch(`${rest}/employees?id=eq.${enc(id)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify(body) });
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    // assigned warehouse operators, and super admins (any warehouse, with their own PIN)
    const hasAccess = Boolean(e.is_warehouse && e.warehouse_code) || isSuperAdmin(session);

    try {
        const q = req.query || {};
        const b = req.body || {};

        // ---------- access / PIN ----------
        if (req.method === 'GET' && (!q.view || q.view === 'status')) {
            const open = warehouseOf(session, req);
            // super admins choose the warehouse; operators always get their own
            const choices = isSuperAdmin(session) ? await get('branches?branch_type=eq.warehouse&select=branch_code,branch_name,currency&order=branch_name') : [];
            const code = open || e.warehouse_code || choices[0]?.branch_code || null;
            const wh = hasAccess && code ? (choices.find(c => c.branch_code === code) || (await get(`branches?branch_code=eq.${enc(code)}&select=branch_code,branch_name,currency`))[0]) : null;
            return res.status(200).json({
                access: hasAccess, warehouse: code, warehouse_name: wh?.branch_name || null, currency: wh?.currency || null,
                warehouses: choices,
                has_pin: Boolean(e.wh_pin_hash), locked_until: e.wh_pin_locked_until && new Date(e.wh_pin_locked_until) > new Date() ? e.wh_pin_locked_until : null,
                unlocked: Boolean(open)
            });
        }
        if (req.method === 'POST' && b.action === 'reset_pin') {
            if (!ADMIN_ROLES.includes(session.role)) throw new UserError('Only super admin / head office can reset a PIN.', 403);
            if (!/^[0-9a-f-]{36}$/i.test(String(b.employee_id || ''))) throw new UserError('Invalid user.');
            await patchEmp(b.employee_id, { wh_pin_hash: null, wh_pin_failed: 0, wh_pin_locked_until: null });
            return res.status(200).json({ success: true });
        }
        if (!hasAccess) throw new UserError('You are not a warehouse operator. Ask an admin to give you warehouse access.', 403);
        // set / unlock the personal PIN; a super admin also says which warehouse they are opening
        if (req.method === 'POST' && (b.action === 'set_pin' || b.action === 'unlock')) {
            let area = e.warehouse_code;
            if (isSuperAdmin(session) && b.warehouse && b.warehouse !== e.warehouse_code) {
                const w = (await get(`branches?branch_code=eq.${enc(b.warehouse)}&branch_type=eq.warehouse&select=branch_code`))[0];
                if (!w) throw new UserError('Choose a warehouse.');
                area = w.branch_code;
            }
            if (!area) throw new UserError('Choose a warehouse.');
            if (b.action === 'unlock' && !e.wh_pin_hash) throw new UserError('Set your warehouse PIN first.');
            try { return res.status(200).json({ success: true, ...(await pinAction(b, { ...e, id: e.id || session.user.id }, patchEmp, area)) }); }
            catch (err) { throw new UserError(err.message, err.status || 400); }
        }

        // ---------- operations: unlocked only ----------
        const wh = warehouseOf(session, req);
        if (!wh) throw new UserError('Warehouse is locked — enter your PIN.', 423);
        const whRow = (await get(`branches?branch_code=eq.${enc(wh)}&select=branch_code,currency`))[0] || { currency: 'OMR' };

        if (req.method === 'GET') {
            if (q.view === 'requests') {
                return res.status(200).json({ requests: await get(`stock_requests?warehouse=eq.${enc(wh)}&select=*&order=status.asc,requested_at.desc&limit=200`),
                    stock: await get(`branch_products?branch_code=eq.${enc(wh)}&select=product_id,qty,sell_price`) });
            }
            if (q.view === 'cargo') {
                // shipments / boxes held in the warehouse (not packing materials), and what is on the way here
                const [cargo, incoming] = await Promise.all([
                    fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/cargo_stock`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_branch: wh }) }).then(r => r.ok ? r.json() : []),
                    get(`transfer_manifests?to_branch=eq.${enc(wh)}&status=in.(in_transit,partial)&select=manifest_no,from_branch,created_at,transfers(status,pieces,bookings(awb,pieces))&order=created_at.asc`)
                ]);
                return res.status(200).json({ cargo, incoming });
            }
            if (q.view === 'stock') {
                const [products, stock, moves] = await Promise.all([
                    get('products?track_stock=is.true&active=is.true&select=id,sku,name,unit&order=name'),
                    get(`branch_products?branch_code=eq.${enc(wh)}&select=*`),
                    get(`stock_moves?branch_code=eq.${enc(wh)}&select=*,products(name,unit)&order=created_at.desc&limit=80`)
                ]);
                return res.status(200).json({
                    currency: whRow.currency, moves,
                    items: products.map(p => { const s = stock.find(x => x.product_id === p.id) || {}; return { ...p, qty: +s.qty || 0, avg_cost: +s.avg_cost || 0, sell_price: +s.sell_price || 0, reorder_level: +s.reorder_level || 0 }; })
                });
            }
            if (q.view === 'purchases') {
                const [purchases, suppliers] = await Promise.all([
                    get(`purchases?branch_code=eq.${enc(wh)}&select=*,suppliers(name)&order=purchase_date.desc,id.desc&limit=100`),
                    get('suppliers?active=is.true&kind=in.(supplier,both)&select=id,name&order=name')
                ]);
                return res.status(200).json({ purchases, suppliers });
            }
            throw new UserError('Unknown view.');
        }

        const reqRow = async () => {
            const r = (await get(`stock_requests?id=eq.${enc(b.id)}&select=*`))[0];
            if (!r || r.warehouse !== wh) throw new UserError('Request not found for this warehouse.', 404);
            return r;
        };
        switch (b.action) {
            case 'dispatch': {
                const r = await reqRow();
                return res.status(200).json({ success: true, ...(await rpc('stock_request_dispatch', { p_id: r.id, p_lines: Array.isArray(b.lines) ? b.lines.slice(0, 60) : [], p_user_name: userName })) });
            }
            case 'reject': {
                const r = await reqRow();
                if (r.status !== 'requested') throw new UserError(`${r.request_no} is already ${r.status}.`);
                await fetch(`${rest}/stock_requests?id=eq.${r.id}&status=eq.requested`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ status: 'rejected', reject_reason: str(b.reason, 200) || null }) });
                return res.status(200).json({ success: true });
            }
            case 'price': {
                const price = num(b.sell_price);
                if (price === null || price < 0) throw new UserError('Enter the price for branches.');
                const r = await fetch(`${rest}/branch_products?on_conflict=branch_code,product_id`, {
                    method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' },
                    body: JSON.stringify({ branch_code: wh, product_id: Number(b.product_id), sell_price: price, reorder_level: num(b.reorder_level) || 0 })
                });
                if (!r.ok) throw new UserError('Could not save.');
                return res.status(200).json({ success: true });
            }
            case 'count':
                return res.status(200).json({ success: true, ...(await rpc('stock_count', { p_branch: wh, p_product: Number(b.product_id), p_counted: num(b.counted), p_note: b.note || null, p_user_name: userName, p_currency: whRow.currency || 'OMR' })) });
            case 'purchase': {
                const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).map(l => ({ product_id: l.product_id ? Number(l.product_id) : null, description: str(l.description, 200), qty: num(l.qty), unit_cost: num(l.unit_cost) })).filter(l => l.qty > 0);
                if (!lines.length) throw new UserError('Add at least one item.');
                const pay = { bank_transfer: 'bank' }[b.pay_method] || b.pay_method;
                return res.status(200).json({ success: true, ...(await rpc('purchase_create', {
                    p_branch: wh, p_supplier_id: b.supplier_id ? Number(b.supplier_id) : null, p_currency: whRow.currency || 'OMR', p_lines: lines,
                    p_pay_method: pay, p_bill_ref: b.bill_ref || null, p_date: b.date || null, p_notes: b.notes || null, p_user_name: userName
                })) });
            }
            case 'item': {
                const sku = String(b.sku || '').trim().toUpperCase().replace(/\s+/g, '-');
                if (!/^[A-Z0-9-]{2,20}$/.test(sku)) throw new UserError('Item code: 2–20 letters, numbers or dashes.');
                if (!str(b.name, 80)) throw new UserError('Enter the item name.');
                const r = await fetch(`${rest}/products`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ sku, name: str(b.name, 80), unit: str(b.unit, 10) || 'pcs', track_stock: true }) });
                const out = await r.json().catch(() => ({}));
                if (!r.ok) throw new UserError(/duplicate|unique/i.test(out.message || '') ? `Item code ${sku} is already used.` : 'Could not save.');
                await fetch(`${rest}/branch_products?on_conflict=branch_code,product_id`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ branch_code: wh, product_id: out[0].id, sell_price: num(b.sell_price) || 0 }) });
                return res.status(200).json({ success: true, id: out[0].id });
            }
            default: throw new UserError('Unknown action.');
        }
    } catch (err) {
        if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Warehouse request failed.', details: err.message });
    }
}
