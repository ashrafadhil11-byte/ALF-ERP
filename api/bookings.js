// File: api/bookings.js — list / detail / import bookings from Al-Farha Online.
//   GET  ?q=&status=&branch=&limit=   list (scoped to own branch unless admin)
//   GET  ?awb=XXX                     one booking + tracking timeline
//   POST { action:'import', order_nos:[...], branch?, intake_mode? }
import { requireSession, serviceHeaders, ADMIN_ROLES } from './_lib/auth.js';
import { callApi, loadIntegration } from './_lib/integrations/http.js';
import CONNECTORS from './_lib/integrations/connectors.js';
import { cleanOrderNo } from './_lib/booking-map.js';

const MAX_IMPORT = 10; // keeps one request well inside Vercel's time limit

const enc = encodeURIComponent;

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const { SUPABASE_URL } = process.env;
    const rest = `${SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);

    try {
        if (req.method === 'GET') {
            const q = req.query || {};

            if (q.awb) {
                const awb = cleanOrderNo(q.awb);
                const r = await fetch(`${rest}/bookings?or=(awb.eq.${enc(awb)},external_ref.eq.${enc(awb)})&select=*&limit=1`, { headers: serviceHeaders() });
                const booking = (r.ok ? await r.json() : [])[0];
                if (!booking || (!isAdmin && booking.branch_code !== session.branch)) {
                    return res.status(404).json({ error: `Booking ${awb} not found.` });
                }
                const ev = await fetch(`${rest}/tracking_events?booking_id=eq.${booking.id}&select=status,status_code,location,remark,event_at,created_by_name,source&order=event_at.desc`, { headers: serviceHeaders() });
                return res.status(200).json({ booking, events: ev.ok ? await ev.json() : [] });
            }

            const branch = isAdmin ? q.branch : session.branch;
            const filters = ['archived=is.false'];
            if (branch) filters.push(`branch_code=eq.${enc(branch)}`);
            if (q.status) filters.push(`current_status_code=eq.${enc(q.status)}`);
            if (q.q) {
                // PostgREST or-filter: strip characters that would break its syntax
                const term = String(q.q).replace(/[(),*%]/g, ' ').trim();
                if (term) filters.push(`or=(awb.ilike.*${enc(term)}*,consignee.ilike.*${enc(term)}*,shipper.ilike.*${enc(term)}*,dest_country.ilike.*${enc(term)}*)`);
            }
            const limit = Math.min(200, parseInt(q.limit, 10) || 50);
            const cols = 'awb,branch_code,booked_at,shipper,consignee,dest_city,dest_country,package_type,weight,pieces,current_status,current_status_code,current_stage,intake_mode,source';
            const r = await fetch(`${rest}/bookings?${filters.join('&')}&select=${cols}&order=booked_at.desc&limit=${limit}`, { headers: serviceHeaders() });
            return res.status(200).json({ bookings: r.ok ? await r.json() : [] });
        }

        if (req.method === 'POST' && (req.body || {}).action === 'import') {
            const body = req.body;
            const orderNos = [...new Set((Array.isArray(body.order_nos) ? body.order_nos : []).map(cleanOrderNo).filter(Boolean))];
            if (!orderNos.length) return res.status(400).json({ error: 'Scan or enter at least one order number.' });
            if (orderNos.length > MAX_IMPORT) return res.status(400).json({ error: `Import at most ${MAX_IMPORT} orders per request.` });

            const branchCode = isAdmin ? body.branch : session.branch;
            if (!branchCode) return res.status(400).json({ error: isAdmin ? 'Choose the branch receiving these orders.' : 'Your account has no branch assigned.' });
            const br = await fetch(`${rest}/branches?branch_code=eq.${enc(branchCode)}&select=branch_code,branch_name,location&limit=1`, { headers: serviceHeaders() });
            const branch = (br.ok ? await br.json() : [])[0];
            if (!branch) return res.status(400).json({ error: `Branch ${branchCode} does not exist.` });

            const integration = await loadIntegration('alfarhaonline');
            if (!integration || !integration.active) return res.status(400).json({ error: 'Al-Farha Online is not active. Set it up in Integrations first.' });

            const intake = body.intake_mode === 'pickup' ? 'pickup' : 'drop_off';
            const userName = session.employee?.full_name || session.user.email;
            const results = [];
            let apiError = null;

            for (const orderNo of orderNos) {
                try {
                    let resp;
                    try {
                        resp = await callApi('alfarhaonline', 'getOrder', { orderNo }, integration);
                    } catch (e) {
                        throw new Error(e.status === 200 || /HTTP 404/.test(e.message) ? 'Order not found.' : e.message);
                    }
                    const row = CONNECTORS.alfarhaonline.toBooking(resp, orderNo, branch);
                    const r = await fetch(`${rest}/rpc/import_booking`, {
                        method: 'POST',
                        headers: serviceHeaders(),
                        body: JSON.stringify({ p_row: row, p_user_id: session.user.id, p_user_name: userName, p_intake: intake })
                    });
                    const out = await r.json();
                    if (!r.ok) throw new Error(out.message || 'Could not save booking.');
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

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
