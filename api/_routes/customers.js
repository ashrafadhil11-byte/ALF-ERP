// File: api/_routes/customers.js — Phase D customer database (company-wide, all branches).
//   GET ?q=…[&page=]          search by name, phone, civil ID or customer no.
//   GET ?id=N                 profile: details, receivers, shipments, invoices, totals per currency
//   GET ?lookup=phone|civil&value=…   booking form: returning customer + their receivers
//   POST { action:'save', id, name?, email?, whatsapp?, civil_id?, address?, city?, country?, notes?, tags?, blocked? }
//   POST { action:'merge', keep, drop }                 (branch manager and above)
//   POST { action:'contact_delete', id }
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

const enc = encodeURIComponent;
const PAGE = 50;
const OPS = [...ADMIN_ROLES, 'branch_manager'];
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^00/, '');
const civil = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const userName = session.employee?.full_name || session.user.email;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const COLS = 'id,customer_no,name,phone,civil_id,email,whatsapp,address,city,country,branch_code,notes,tags,blocked,merged_into,first_booking_at,last_booking_at,created_at';

    try {
        const q = req.query || {};
        if (req.method === 'GET') {
            if (q.lookup) {
                const v = q.lookup === 'civil' ? civil(q.value) : digits(q.value);
                if (!v || v.length < 5) return res.status(200).json({ customer: null });
                const c = (await get(`customers?merged_into=is.null&${q.lookup === 'civil' ? 'civil_key' : 'phone_key'}=eq.${enc(v)}&select=${COLS}&limit=1`))[0];
                if (!c) return res.status(200).json({ customer: null });
                const [contacts, stats, open] = await Promise.all([
                    get(`customer_contacts?customer_id=eq.${c.id}&select=*&order=last_used_at.desc&limit=15`),
                    get(`customer_stats?customer_id=eq.${c.id}&select=*`),
                    get(`invoices?customer_id=eq.${c.id}&status=in.(unpaid,partial)&select=currency,balance`)
                ]);
                return res.status(200).json({ customer: { ...c, stats: stats[0] || null, balance: sumBy(open, 'balance') }, contacts });
            }
            if (q.id) {
                const c = (await get(`customers?id=eq.${enc(q.id)}&select=${COLS}`))[0];
                if (!c) throw new UserError('Customer not found.', 404);
                const [contacts, bookings, invoices, stats, merged] = await Promise.all([
                    get(`customer_contacts?customer_id=eq.${c.id}&select=*&order=last_used_at.desc&limit=100`),
                    get(`bookings?customer_id=eq.${c.id}&select=awb,booked_at,consignee,dest_city,dest_country,pieces,weight,chargeable_weight,current_status,current_status_code,branch_code,amount&order=booked_at.desc&limit=200`),
                    get(`invoices?customer_id=eq.${c.id}&select=id,invoice_no,awb,issued_at,currency,total,paid,balance,status&order=issued_at.desc&limit=200`),
                    get(`customer_stats?customer_id=eq.${c.id}&select=*`),
                    get(`customers?merged_into=eq.${c.id}&select=id,customer_no,name,phone`)
                ]);
                const live = invoices.filter(i => i.status !== 'void');
                return res.status(200).json({
                    customer: c, contacts, bookings, invoices, merged, stats: stats[0] || null,
                    spent: sumBy(live, 'total'), balance: sumBy(live.filter(i => ['unpaid', 'partial'].includes(i.status)), 'balance')
                });
            }
            // search / list
            const s = str(q.q, 60);
            const page = Math.max(0, parseInt(q.page, 10) || 0);
            const ors = [];
            if (s) {
                const safe = s.replace(/[(),*%]/g, ' ').trim();
                if (safe) ors.push(`name.ilike.*${enc(safe)}*`, `customer_no.ilike.*${enc(safe)}*`);
                if (digits(s).length >= 4) ors.push(`phone_key.like.*${digits(s)}*`);
                if (civil(s).length >= 4) ors.push(`civil_key.like.*${civil(s)}*`);
            }
            const filter = q.filter === 'blocked' ? '&blocked=is.true' : '';
            const list = await get(`customers?merged_into=is.null${ors.length ? `&or=(${ors.join(',')})` : ''}${filter}&select=${COLS},customer_stats(shipments,kg,last_shipment_at)&order=last_booking_at.desc.nullslast,id.desc&limit=${PAGE}&offset=${page * PAGE}`);
            const ids = list.map(c => c.id);
            const open = ids.length ? await get(`invoices?customer_id=in.(${ids.join(',')})&status=in.(unpaid,partial)&select=customer_id,currency,balance`) : [];
            return res.status(200).json({
                customers: list.map(c => ({ ...c, stats: Array.isArray(c.customer_stats) ? c.customer_stats[0] : c.customer_stats, customer_stats: undefined, balance: sumBy(open.filter(o => o.customer_id === c.id), 'balance') })),
                page, more: list.length === PAGE
            });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        if (b.action === 'save') {
            const c = (await get(`customers?id=eq.${enc(b.id)}&select=id,merged_into`))[0];
            if (!c) throw new UserError('Customer not found.', 404);
            if (c.merged_into) throw new UserError('This customer was merged — edit the one it was merged into.');
            const patch = {};
            if (b.name !== undefined) { if (!str(b.name, 80)) throw new UserError('Enter the name.'); patch.name = str(b.name, 80); }
            for (const k of ['email', 'whatsapp', 'address', 'city', 'country']) if (b[k] !== undefined) patch[k] = str(b[k], k === 'address' ? 300 : 120) || null;
            if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(b.email))) throw new UserError('Check the email address.');
            if (b.notes !== undefined) patch.notes = str(b.notes, 2000) || null;
            if (b.tags !== undefined) patch.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).map(t => str(t, 30)).filter(Boolean).slice(0, 20);
            if (b.blocked !== undefined) { if (!OPS.includes(session.role)) throw new UserError('Only managers can block customers.', 403); patch.blocked = Boolean(b.blocked); }
            if (b.civil_id !== undefined) {
                patch.civil_id = str(b.civil_id, 40) || null;
                patch.civil_key = civil(b.civil_id) || null;
                if (patch.civil_key) {
                    const other = (await get(`customers?civil_key=eq.${enc(patch.civil_key)}&merged_into=is.null&id=neq.${c.id}&select=customer_no,name`))[0];
                    if (other) throw new UserError(`Civil ID already belongs to ${other.customer_no} ${other.name} — merge them instead.`);
                }
            }
            patch.updated_at = new Date().toISOString();
            const r = await fetch(`${rest}/customers?id=eq.${c.id}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify(patch) });
            if (!r.ok) throw new UserError('Could not save.');
            return res.status(200).json({ success: true });
        }
        if (b.action === 'merge') {
            if (!OPS.includes(session.role)) throw new UserError('Only managers can merge customers.', 403);
            const r = await fetch(`${rest}/rpc/customer_merge`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_keep: Number(b.keep), p_drop: Number(b.drop), p_user_name: userName }) });
            const out = await r.json().catch(() => ({}));
            if (!r.ok) throw new UserError(out.message || 'Merge failed.');
            return res.status(200).json({ success: true });
        }
        if (b.action === 'contact_delete') {
            await fetch(`${rest}/customer_contacts?id=eq.${enc(b.id)}`, { method: 'DELETE', headers: serviceHeaders() });
            return res.status(200).json({ success: true });
        }
        throw new UserError('Unknown action.');
    } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: 'Customer request failed.', details: e.message });
    }
}

function sumBy(rows, field) {
    const m = {};
    rows.forEach(r => { m[r.currency] = Math.round(((m[r.currency] || 0) + +r[field]) * 1000) / 1000; });
    return Object.entries(m).map(([currency, amount]) => ({ currency, amount }));
}
