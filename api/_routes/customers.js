// File: api/_routes/customers.js — Phase D customer database (company-wide, all branches).
//   GET ?q=…[&page=]          search by name, phone, civil ID or customer no.
//   GET ?id=N                 profile: details, receivers, shipments, invoices, totals per currency
//   GET ?lookup=phone|civil&value=…   booking form: returning customer + their receivers
//   POST { action:'save', id, name?, email?, whatsapp?, civil_id?, address?, city?, country?, notes?, tags?, blocked? }
//   POST { action:'merge', keep, drop }                 (branch manager and above)
//   POST { action:'contact_delete', id }
//   GET ?view=loyalty_settings · POST { action:'loyalty_adjust', id, points, note } (managers) · { action:'loyalty_settings', … } (head office)
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
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    const COLS = 'id,customer_no,name,phone,civil_id,email,whatsapp,address,city,country,branch_code,notes,tags,blocked,merged_into,first_booking_at,last_booking_at,created_at';

    try {
        const q = req.query || {};
        if (req.method === 'GET') {
            if (q.view === 'loyalty_settings') return res.status(200).json({ settings: (await get('loyalty_settings?id=eq.1&select=*'))[0] || null });
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
                const [contacts, bookings, invoices, stats, merged, loyalty, points] = await Promise.all([
                    get(`customer_contacts?customer_id=eq.${c.id}&select=*&order=last_used_at.desc&limit=100`),
                    get(`bookings?customer_id=eq.${c.id}&select=awb,booked_at,consignee,dest_city,dest_country,pieces,weight,chargeable_weight,current_status,current_status_code,branch_code,amount&order=booked_at.desc&limit=200`),
                    get(`invoices?customer_id=eq.${c.id}&select=id,invoice_no,awb,issued_at,currency,total,paid,balance,status&order=issued_at.desc&limit=200`),
                    get(`customer_stats?customer_id=eq.${c.id}&select=*`),
                    get(`customers?merged_into=eq.${c.id}&select=id,customer_no,name,phone`),
                    rpc('loyalty_status', { p_customer: c.id }).catch(() => null),
                    get(`loyalty_ledger?customer_id=eq.${c.id}&select=id,kind,points,currency,amount,note,created_at,created_by_name,invoices(invoice_no)&order=created_at.desc&limit=50`)
                ]);
                const live = invoices.filter(i => i.status !== 'void');
                return res.status(200).json({
                    customer: c, contacts, bookings, invoices, merged, stats: stats[0] || null, loyalty, points,
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
        if (b.action === 'loyalty_adjust') {
            // managers correct a balance (goodwill, mistakes); always with a reason, never below zero
            if (!OPS.includes(session.role)) throw new UserError('Only managers can adjust points.', 403);
            const pts = Math.trunc(Number(b.points) || 0);
            if (!pts || Math.abs(pts) > 100000) throw new UserError('Enter the points to add (or minus to take away).');
            if (!str(b.note, 200)) throw new UserError('Give a reason.');
            const c = (await get(`customers?id=eq.${enc(b.id)}&merged_into=is.null&select=id`))[0];
            if (!c) throw new UserError('Customer not found.', 404);
            const st = await rpc('loyalty_status', { p_customer: c.id });
            if (+st.balance + pts < 0) throw new UserError(`The customer has only ${st.balance} points.`);
            const r = await fetch(`${rest}/loyalty_ledger`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ customer_id: c.id, kind: 'adjust', points: pts, note: str(b.note, 200), created_by_name: userName }) });
            if (!r.ok) throw new UserError('Could not save.');
            return res.status(200).json({ success: true, balance: +st.balance + pts });
        }
        if (b.action === 'loyalty_settings') {
            if (!ADMIN_ROLES.includes(session.role)) throw new UserError('Only head office can change loyalty settings.', 403);
            const money = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [String(k).toUpperCase().slice(0, 3), Math.max(0, Number(v) || 0)]).filter(([k, v]) => /^[A-Z]{3}$/.test(k) && v > 0));
            const tiers = (Array.isArray(b.tiers) ? b.tiers : []).slice(0, 6).map(t => ({ name: str(t.name, 20), min: Math.max(0, Math.trunc(+t.min || 0)), bonus: Math.min(200, Math.max(0, +t.bonus || 0)) })).filter(t => t.name).sort((x, y) => x.min - y.min);
            if (!tiers.length || tiers[0].min !== 0) throw new UserError('The first tier must start at 0 points.');
            const patch = { active: Boolean(b.active), earn_rate: money(b.earn_rate), point_value: money(b.point_value), min_redeem: Math.max(1, Math.trunc(+b.min_redeem || 100)), tiers, updated_at: new Date().toISOString(), updated_by: userName };
            const r = await fetch(`${rest}/loyalty_settings?id=eq.1`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify(patch) });
            if (!r.ok) throw new UserError('Could not save.');
            return res.status(200).json({ success: true, settings: patch });
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
