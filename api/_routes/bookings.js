// File: api/bookings.js — shipments: list, detail, preview, create, edit, delete.
//   GET    ?q=&status=&branch=&limit=     list (own branch unless admin)
//   GET    ?awb=XXX                       one booking + tracking timeline
//   POST   { action:'preview', order_no, branch? }            fetch from Al-Farha Online, NOT saved — for review
//   POST   { action:'create', awb, fields, branch?, source?, external_ref?, raw? }   save one shipment
//   POST   { action:'create_many', rows:[{ awb, ...fields }], branch? }            CSV upload (after review)
//   POST   { action:'import', order_nos:[...], branch?, intake_mode? }            bulk import without review
//   PATCH  { awb, fields }                edit details (logged on the timeline)
//   DELETE ?awb=XXX                       delete (managers and admins only)
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { autoInvoice } from '../_lib/accounts.js';
import { callApi, loadIntegration } from '../_lib/integrations/http.js';
import CONNECTORS from '../_lib/integrations/connectors.js';
import { cleanOrderNo, cleanFields } from '../_lib/booking-map.js';

const MAX_IMPORT = 10;   // Al-Farha calls per request (time limit)
const MAX_CSV = 100;     // rows per CSV request
const CAN_DELETE = ['super_admin', 'head_office', 'branch_manager'];
const enc = encodeURIComponent;

class UserError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const userName = session.employee?.full_name || session.user.email;

    const findBooking = async (awb) => {
        const a = cleanOrderNo(awb);
        const r = await fetch(`${rest}/bookings?or=(awb.eq.${enc(a)},external_ref.eq.${enc(a)})&select=*&limit=1`, { headers: serviceHeaders() });
        const b = (r.ok ? await r.json() : [])[0];
        if (!b || (!isAdmin && b.branch_code !== session.branch)) throw new UserError(`Shipment ${a} not found.`, 404);
        return b;
    };
    const loadBranch = async (requested) => {
        const code = isAdmin ? requested : session.branch;
        if (!code) throw new UserError(isAdmin ? 'Choose the branch for this shipment.' : 'Your account has no branch assigned.');
        const r = await fetch(`${rest}/branches?branch_code=eq.${enc(code)}&select=branch_code,branch_name,branch_type,location,currency,tax_rate&limit=1`, { headers: serviceHeaders() });
        const branch = (r.ok ? await r.json() : [])[0];
        if (!branch) throw new UserError(`Branch ${code} does not exist.`);
        return branch;
    };
    const saveRow = async (row, intake) => {
        const r = await fetch(`${rest}/rpc/import_booking`, {
            method: 'POST',
            headers: serviceHeaders(),
            body: JSON.stringify({ p_row: row, p_user_id: session.user.id, p_user_name: userName, p_intake: intake })
        });
        const out = await r.json();
        if (!r.ok) throw new UserError(out.message || 'Could not save shipment.');
        return out;
    };
    const existing = async (awb, ref) => {
        const ors = [`awb.eq.${enc(awb)}`, ref && `external_ref.eq.${enc(ref)}`].filter(Boolean).join(',');
        const r = await fetch(`${rest}/bookings?or=(${ors})&select=awb&limit=1`, { headers: serviceHeaders() });
        return (r.ok ? await r.json() : [])[0] || null;
    };
    const fetchOrder = async (integration, orderNo) => {
        try {
            return await callApi('alfarhaonline', 'getOrder', { orderNo }, integration);
        } catch (e) {
            throw new UserError(e.status === 200 || /HTTP 404/.test(e.message) ? `Order ${orderNo} not found in Al-Farha Online.` : e.message);
        }
    };
    const activeAlfarha = async () => {
        const integration = await loadIntegration('alfarhaonline');
        if (!integration || !integration.active) throw new UserError('Al-Farha Online is not active. Set it up in Integrations first.');
        return integration;
    };

    try {
        // ---------------- READ ----------------
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.awb) {
                const booking = await findBooking(q.awb);
                const ev = await fetch(`${rest}/tracking_events?booking_id=eq.${booking.id}&select=status,status_code,location,remark,event_at,created_by_name,source&order=event_at.desc`, { headers: serviceHeaders() });
                return res.status(200).json({ booking, events: ev.ok ? await ev.json() : [], can_delete: CAN_DELETE.includes(session.role) });
            }
            const branch = isAdmin ? q.branch : session.branch;
            const filters = ['archived=is.false'];
            if (branch) filters.push(`branch_code=eq.${enc(branch)}`);
            if (q.status) filters.push(`current_status_code=eq.${enc(q.status)}`);
            if (q.q) {
                const term = String(q.q).replace(/[(),*%]/g, ' ').trim(); // keep PostgREST or-syntax intact
                if (term) filters.push(`or=(awb.ilike.*${enc(term)}*,consignee.ilike.*${enc(term)}*,shipper.ilike.*${enc(term)}*,dest_country.ilike.*${enc(term)}*)`);
            }
            const limit = Math.min(200, parseInt(q.limit, 10) || 50);
            const cols = 'awb,branch_code,booked_at,shipper,shipper_phone,consignee,dest_city,dest_country,package_type,weight,pieces,current_status,current_status_code,current_stage,intake_mode,source';
            const r = await fetch(`${rest}/bookings?${filters.join('&')}&select=${cols}&order=booked_at.desc&limit=${limit}`, { headers: serviceHeaders() });
            return res.status(200).json({ bookings: r.ok ? await r.json() : [] });
        }

        const body = req.body || {};

        // ---------------- PREVIEW (fetch, don't save) ----------------
        if (req.method === 'POST' && body.action === 'preview') {
            const orderNo = cleanOrderNo(body.order_no);
            if (!orderNo) throw new UserError('Enter an order number.');
            const branch = await loadBranch(body.branch);
            const integration = await activeAlfarha();
            const row = CONNECTORS.alfarhaonline.toBooking(await fetchOrder(integration, orderNo), orderNo, branch);
            const dup = await existing(row.awb, row.external_ref);
            return res.status(200).json({ row, exists: dup ? dup.awb : null });
        }

        // ---------------- CREATE ONE (manual, or reviewed Al-Farha order) ----------------
        if (req.method === 'POST' && body.action === 'create') {
            const { fields, errors } = cleanFields(body.fields || {});
            if (errors.length) throw new UserError(errors.join(' '));
            if (!fields.shipper || !fields.consignee) throw new UserError('Shipper and consignee are required.');
            const branch = await loadBranch(body.branch);
            const fromApi = body.source === 'alfarhaonline';

            // Full booking form: reference D B C NNNNNN generated in the database (imports keep their own number).
            let awb = cleanOrderNo(body.awb);
            if (body.auto_ref && !fromApi) {
                if (!fields.dest_country_code) throw new UserError('Choose the destination country.');
                if (!fields.cargo_type_code) throw new UserError('Choose the cargo type.');
                const r = await fetch(`${rest}/rpc/next_booking_ref`, {
                    method: 'POST',
                    headers: serviceHeaders(),
                    body: JSON.stringify({ p_branch_code: branch.branch_code, p_country_code: fields.dest_country_code, p_cargo_code: fields.cargo_type_code })
                });
                const out = await r.json();
                if (!r.ok) throw new UserError(out.message || 'Could not create the booking reference.');
                awb = out;
            }
            if (!awb || awb.length > 40) throw new UserError('Booking ID / AWB is required (max 40 characters).');
            const ref = fromApi ? cleanOrderNo(body.external_ref) || awb : null;
            const dup = await existing(awb, ref);
            if (dup) throw new UserError(`Shipment ${dup.awb} already exists — open it to edit instead.`, 409);
            const out = await saveRow({
                ...fields, awb, external_ref: ref, branch_code: branch.branch_code,
                origin_city: fields.origin_city || branch.location || branch.branch_name,
                source: fromApi ? 'alfarhaonline' : 'manual',
                raw: fromApi && body.raw && typeof body.raw === 'object' ? body.raw : null
            }, fields.intake_mode);
            // Counter bookings with a charge get an invoice (+ receipt when paid now). Imports are paid online.
            // receiver address parts → the customer's saved receivers (to refill the form next time)
            if (body.receiver_parts && typeof body.receiver_parts === 'object') {
                const parts = Object.fromEntries(Object.entries(body.receiver_parts).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), String(v ?? '').slice(0, 200)]));
                await fetch(`${rest}/bookings?awb=eq.${enc(out.awb || awb)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ receiver_parts: parts }) }).catch(() => {});
            }
            const acc = fromApi ? {} : await autoInvoice({ awb: out.awb || awb, branch, fields, userName, lines: body.charge_lines });
            return res.status(200).json({ ...out, invoice: acc.invoice || null, invoice_error: acc.error || null });
        }

        // ---------------- CREATE MANY (CSV, after review) ----------------
        if (req.method === 'POST' && body.action === 'create_many') {
            const rows = Array.isArray(body.rows) ? body.rows : [];
            if (!rows.length) throw new UserError('No rows to save.');
            if (rows.length > MAX_CSV) throw new UserError(`At most ${MAX_CSV} rows per upload.`);
            const branch = await loadBranch(body.branch);
            const results = [];
            for (const input of rows) {
                const awb = cleanOrderNo(input.awb);
                try {
                    if (!awb) throw new UserError('Missing Booking ID.');
                    const { fields, errors } = cleanFields(input);
                    if (errors.length) throw new UserError(errors.join(' '));
                    if (await existing(awb)) throw new UserError('Already exists.');
                    const out = await saveRow({ ...fields, awb, branch_code: branch.branch_code, origin_city: fields.origin_city || branch.location, source: 'manual' }, fields.intake_mode);
                    results.push({ awb, result: out.result });
                } catch (e) {
                    results.push({ awb: awb || '—', result: 'error', error: e.message });
                }
            }
            return res.status(200).json({ results });
        }

        // ---------------- BULK IMPORT FROM AL-FARHA (no review) ----------------
        if (req.method === 'POST' && body.action === 'import') {
            const orderNos = [...new Set((Array.isArray(body.order_nos) ? body.order_nos : []).map(cleanOrderNo).filter(Boolean))];
            if (!orderNos.length) throw new UserError('Scan or enter at least one order number.');
            if (orderNos.length > MAX_IMPORT) throw new UserError(`Import at most ${MAX_IMPORT} orders per request.`);
            const branch = await loadBranch(body.branch);
            const integration = await activeAlfarha();
            const intake = body.intake_mode === 'pickup' ? 'pickup' : 'drop_off';
            const results = [];
            let apiError = null;
            for (const orderNo of orderNos) {
                try {
                    const row = CONNECTORS.alfarhaonline.toBooking(await fetchOrder(integration, orderNo), orderNo, branch);
                    const out = await saveRow(row, intake);
                    results.push({ order_no: orderNo, ...out, consignee: row.consignee, dest_country: row.dest_country, weight: row.weight, pieces: row.pieces });
                } catch (e) {
                    apiError = e.message;
                    results.push({ order_no: orderNo, result: 'error', error: e.message });
                }
            }
            const anyOk = results.some(r => r.result !== 'error');
            await fetch(`${rest}/integrations?id=eq.${integration.id}`, {
                method: 'PATCH',
                headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
                body: JSON.stringify({ last_sync_at: new Date().toISOString(), last_status: anyOk ? 'ok' : 'error', last_error: anyOk ? null : apiError })
            });
            return res.status(200).json({ results });
        }

        // ---------------- EDIT ----------------
        if (req.method === 'PATCH') {
            const b = await findBooking(body.awb);
            const { fields, errors } = cleanFields(body.fields || {});
            if (errors.length) throw new UserError(errors.join(' '));
            if ('shipper' in fields && !fields.shipper) throw new UserError('Shipper cannot be empty.');
            if ('consignee' in fields && !fields.consignee) throw new UserError('Consignee cannot be empty.');
            if (isAdmin && body.branch_code && body.branch_code !== b.branch_code) {
                const br = await loadBranch(body.branch_code);
                if (br.branch_type && br.branch_type !== 'branch') throw new UserError('A shipment belongs to a branch, not to the warehouse or Main Office.');
                // a booking moved by an admin now belongs to that branch (its boxes follow; costs and revenue go there)
                fields.branch_code = br.branch_code;
                fields.booked_branch = br.branch_code;
            }

            const norm = (v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
            const changed = Object.keys(fields).filter(k => norm(fields[k]) !== norm(b[k]));
            if (!changed.length) return res.status(200).json({ success: true, changed: [] });
            const patch = Object.fromEntries(changed.map(k => [k, fields[k]]));
            patch.updated_at = new Date().toISOString();
            const r = await fetch(`${rest}/bookings?id=eq.${b.id}`, { method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
            if (!r.ok) throw new UserError('Could not save changes.');

            const label = (k) => k.replace(/_/g, ' ');
            const show = (v) => (v == null ? "—" : typeof v === "object" ? `${Array.isArray(v) ? v.length + " box(es)" : "updated"}` : v);
            const remark = changed.map(k => `${label(k)}: ${show(b[k])} → ${show(fields[k])}`).join("; ").slice(0, 900);
            await fetch(`${rest}/tracking_events`, {
                method: 'POST',
                headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
                body: JSON.stringify({ booking_id: b.id, status: 'Details updated', remark, created_by: session.user.id, created_by_name: userName, branch_code: session.branch || b.branch_code, source: 'manual' })
            });
            return res.status(200).json({ success: true, changed });
        }

        // ---------------- DELETE ----------------
        if (req.method === 'DELETE') {
            if (!CAN_DELETE.includes(session.role)) throw new UserError('Only managers and admins can delete shipments. Cancel it instead.', 403);
            const b = await findBooking((req.query || {}).awb);
            const r = await fetch(`${rest}/bookings?id=eq.${b.id}`, { method: 'DELETE', headers: { ...serviceHeaders(), Prefer: 'return=minimal' } });
            if (!r.ok) throw new UserError('Could not delete — it may be part of a consolidation.');
            return res.status(200).json({ success: true, deleted: b.awb });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
