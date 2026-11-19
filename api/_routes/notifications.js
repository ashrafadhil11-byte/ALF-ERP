// File: api/_routes/notifications.js — the bell in the top bar.
//   GET                     { items:[{ id, kind, title, body, at, href, unread }], unread }
//   POST { action:'seen' }  marks everything up to now as read for this user
// Built from live data (no separate queue): incoming transfer manifests, exceptions (failed delivery,
// holds, returns…), customer reviews, carrier-sync errors, and the requests between locations:
//   cash sent → the receiving location; cash received → the sender; payment requests → Main Office,
//   paid / rejected → the branch; material requests → the warehouse, dispatched / rejected → the branch,
//   received → the warehouse; cargo manifest received → the sender; a shared agent bill → each branch.
// Your own actions are left out.
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { canMainOffice } from '../_lib/pin.js';

const enc = encodeURIComponent;
const DAYS = 7;
const LIMIT = 40;

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const me = session.user.id;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };

    if (req.method === 'POST') {
        if ((req.body || {}).action !== 'seen') return res.status(400).json({ error: 'Unknown action.' });
        await fetch(`${rest}/employees?id=eq.${enc(me)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ notif_seen_at: new Date().toISOString() }) });
        return res.status(200).json({ success: true });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const since = new Date(Date.now() - DAYS * 864e5).toISOString();
    const branch = session.branch;
    const inBranch = isAdmin || !branch ? '' : `&bookings.branch_code=eq.${enc(branch)}`;
    const notMine = `&or=(created_by.is.null,created_by.neq.${enc(me)})`;

    const exceptionCodes = (await get('statuses?is_exception=is.true&select=code')).map(s => s.code).filter(c => c !== 'CANCELLED');
    const codes = [...exceptionCodes, 'REVIEWED'].join(',');
    // the locations this user acts for: their branch, Main Office (cashiers / super admin), their warehouse
    const emp = session.employee || {};
    const myName = emp.full_name || session.user.email;
    const mo = canMainOffice(session) ? (await get('branches?branch_type=eq.main_office&select=branch_code'))[0]?.branch_code || null : null;
    const wh = emp.is_warehouse && emp.warehouse_code ? emp.warehouse_code : null;
    const locs = [...new Set([branch, mo, wh].filter(Boolean))];
    const inLocs = (col) => locs.length ? `&${col}=in.(${locs.map(enc).join(',')})` : null;
    const none = async () => [];
    const pageFor = (code) => code === mo ? 'main-office.html' : 'accounts.html';
    const money = (cur, v) => `${cur || ''} ${(+v || 0).toFixed(3)}`.trim();

    const isManager = isAdmin || session.role === 'branch_manager';
    const [cashIn, cashDone, reqNew, reqDone, matNew, matSent, matGot, cargoDone, shares, pkMine, pkNew, sums] = await Promise.all([
        inLocs('to_branch') ? get(`cash_transfers?status=eq.sent&sent_at=gte.${enc(since)}${inLocs('to_branch')}&select=id,transfer_no,from_branch,to_branch,currency,amount,sent_at,sent_by_name,reference&order=sent_at.desc&limit=20`) : none(),
        inLocs('from_branch') ? get(`cash_transfers?status=eq.received&received_at=gte.${enc(since)}${inLocs('from_branch')}&select=id,transfer_no,from_branch,to_branch,currency,amount,received_amount,received_at,received_by_name&order=received_at.desc&limit=20`) : none(),
        mo ? get(`payment_requests?status=eq.requested&requested_at=gte.${enc(since)}&select=id,request_no,branch_code,currency,amount,payee,reason,requested_at,requested_by_name&order=requested_at.desc&limit=20`) : none(),
        branch ? get(`payment_requests?status=in.(paid,rejected)&decided_at=gte.${enc(since)}&branch_code=eq.${enc(branch)}&select=id,request_no,status,currency,amount,payee,decided_at,decided_by_name,reject_reason&order=decided_at.desc&limit=20`) : none(),
        wh ? get(`stock_requests?status=eq.requested&requested_at=gte.${enc(since)}&warehouse=eq.${enc(wh)}&select=id,request_no,branch_code,requested_at,requested_by,lines&order=requested_at.desc&limit=20`) : none(),
        branch ? get(`stock_requests?status=in.(dispatched,rejected)&branch_code=eq.${enc(branch)}&requested_at=gte.${enc(new Date(Date.now() - 30 * 864e5).toISOString())}&select=id,request_no,warehouse,status,dispatched_at,dispatched_by,requested_at,reject_reason,total,currency&order=requested_at.desc&limit=20`) : none(),
        wh ? get(`stock_requests?status=eq.received&received_at=gte.${enc(since)}&warehouse=eq.${enc(wh)}&select=id,request_no,branch_code,received_at,received_by&order=received_at.desc&limit=20`) : none(),
        inLocs('from_branch') ? get(`transfer_manifests?status=in.(received,partial)&received_at=gte.${enc(since)}${inLocs('from_branch')}&select=id,manifest_no,to_branch,status,received_at,received_by_name,transfers(status,missing_pieces)&order=received_at.desc&limit=20`) : none(),
        branch ? get(`cost_bill_shares?branch_code=eq.${enc(branch)}&select=amount,cost_bills!inner(id,bill_no,branch_code,cost_type,currency,created_at,created_by_name,status)&cost_bills.created_at=gte.${enc(since)}&cost_bills.status=neq.void&limit=20`) : none(),
        // pickups: a driver hears about the ones given to them; managers about new requests in their branch
        emp.is_driver ? get(`pickup_requests?driver_id=eq.${enc(me)}&status=eq.assigned&assigned_at=gte.${enc(since)}&select=id,pickup_no,customer_name,address,city,pickup_date,slot,assigned_at&order=assigned_at.desc&limit=20`) : none(),
        isManager && (branch || isAdmin) ? get(`pickup_requests?status=eq.requested&created_at=gte.${enc(since)}${isAdmin && !branch ? '' : `&branch_code=eq.${enc(branch)}`}&select=id,pickup_no,branch_code,customer_name,city,pickup_date,slot,created_at,created_by_name&order=created_at.desc&limit=20`) : none(),
        // the evening summary: managers get their branch, head office the company total
        isManager && (isAdmin || branch) ? get(`daily_summaries?created_at=gte.${enc(since)}&${isAdmin ? 'branch_code=is.null' : `branch_code=eq.${enc(branch)}`}&select=id,day,branch_code,data,created_at&order=day.desc&limit=7`) : none()
    ]);
    const mine = (who) => Boolean(who) && who === myName;
    const recent = (iso) => iso && iso >= since;
    const SLOTS = { morning: 'morning', afternoon: 'afternoon', evening: 'evening', any: 'any time' };
    const between = [
        ...sums.map(x => {
            const d = x.data || {}, got = Object.entries(d.received || {}).reduce((m, [k, v]) => { const c = k.split(' ')[0]; m[c] = (m[c] || 0) + +v; return m; }, {});
            const late = d.branch ? (!d.cash_closed && (d.bookings || Object.keys(d.received || {}).length) ? 'cash not closed' : '') : (d.cash_not_closed || []).length ? `cash not closed: ${d.cash_not_closed.join(', ')}` : '';
            return {
                id: `ds-${x.id}`, kind: late ? 'warn' : 'done', at: x.created_at, href: `summary.html?date=${x.day}`,
                title: `Daily summary · ${x.day}${x.branch_code ? ' · ' + x.branch_code : ''}`,
                body: [`${d.bookings || 0} bookings`, ...Object.entries(got).map(([c, v]) => `${c} ${v.toFixed(3)} received`), d.exceptions ? `${d.exceptions} exceptions` : '', late].filter(Boolean).join(' · ')
            };
        }),
        ...pkMine.map(p => ({
            id: `pk-${p.id}`, kind: 'inbound', at: p.assigned_at, href: 'pickups.html',
            title: `Pickup for you · ${p.customer_name}`, body: [p.pickup_no, p.pickup_date, SLOTS[p.slot], [p.address, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
        })),
        ...pkNew.filter(p => !mine(p.created_by_name)).map(p => ({
            id: `pn-${p.id}`, kind: 'request', at: p.created_at, href: 'pickups.html',
            title: `New pickup request · ${p.customer_name}`, body: [p.pickup_no, p.branch_code, p.pickup_date, SLOTS[p.slot], 'assign a driver'].filter(Boolean).join(' · ')
        })),
        ...cashIn.filter(t => !mine(t.sent_by_name)).map(t => ({
            id: `cs-${t.id}`, kind: 'cash', at: t.sent_at, href: `${pageFor(t.to_branch)}?tab=${t.to_branch === mo ? 'approvals' : 'money'}`,
            title: `Cash on the way · ${money(t.currency, t.amount)} from ${t.from_branch}`,
            body: [t.transfer_no, t.reference, t.sent_by_name && 'sent by ' + t.sent_by_name, 'confirm when you count it'].filter(Boolean).join(' · ')
        })),
        ...cashDone.filter(t => !mine(t.received_by_name)).map(t => {
            const diff = Math.round(((+t.received_amount || 0) - (+t.amount || 0)) * 1000) / 1000;
            return {
                id: `cr-${t.id}`, kind: diff ? 'warn' : 'done', at: t.received_at, href: `${pageFor(t.from_branch)}?tab=${t.from_branch === mo ? 'transfers' : 'money'}`,
                title: `${t.to_branch} confirmed your cash · ${money(t.currency, t.received_amount)}`,
                body: [t.transfer_no, diff < 0 ? `short ${money(t.currency, -diff)}` : diff > 0 ? `over ${money(t.currency, diff)}` : 'full amount', t.received_by_name].filter(Boolean).join(' · ')
            };
        }),
        ...reqNew.filter(r => !mine(r.requested_by_name)).map(r => ({
            id: `pq-${r.id}`, kind: 'request', at: r.requested_at, href: 'main-office.html?tab=approvals',
            title: `Payment request · ${r.branch_code} · ${money(r.currency, r.amount)}`,
            body: [r.request_no, r.payee, r.reason, r.requested_by_name].filter(Boolean).join(' · ')
        })),
        ...reqDone.filter(r => !mine(r.decided_by_name)).map(r => ({
            id: `pd-${r.id}`, kind: r.status === 'paid' ? 'done' : 'warn', at: r.decided_at, href: 'accounts.html?tab=money',
            title: r.status === 'paid' ? `Main Office paid ${r.request_no} · ${money(r.currency, r.amount)}` : `Main Office rejected ${r.request_no}`,
            body: [r.payee, r.status === 'rejected' && r.reject_reason, r.decided_by_name].filter(Boolean).join(' · ')
        })),
        ...matNew.filter(r => !mine(r.requested_by)).map(r => ({
            id: `mq-${r.id}`, kind: 'request', at: r.requested_at, href: 'warehouse.html',
            title: `Material request from ${r.branch_code}`,
            body: [r.request_no, (r.lines || []).slice(0, 3).map(l => `${l.qty_requested} ${l.name || ''}`.trim()).join(', '), r.requested_by].filter(Boolean).join(' · ')
        })),
        ...matSent.filter(r => !mine(r.dispatched_by) && recent(r.dispatched_at || r.requested_at)).map(r => ({
            id: `ms-${r.id}`, kind: r.status === 'dispatched' ? 'inbound' : 'warn', at: r.dispatched_at || r.requested_at, href: 'accounts.html?tab=inventory',
            title: r.status === 'dispatched' ? `Materials on the way from ${r.warehouse}` : `Warehouse rejected ${r.request_no}`,
            body: r.status === 'dispatched' ? [r.request_no, money(r.currency, r.total), 'confirm receipt when they arrive'].join(' · ') : (r.reject_reason || '')
        })),
        ...matGot.filter(r => !mine(r.received_by)).map(r => ({
            id: `mr-${r.id}`, kind: 'done', at: r.received_at, href: 'warehouse.html',
            title: `${r.branch_code} confirmed receipt of ${r.request_no}`, body: r.received_by || ''
        })),
        ...cargoDone.filter(m => !mine(m.received_by_name)).map(m => {
            const missing = (m.transfers || []).filter(t => t.missing_pieces).length, left = (m.transfers || []).filter(t => t.status === 'pending').length;
            return {
                id: `md-${m.id}`, kind: missing ? 'warn' : 'done', at: m.received_at, href: 'consolidation.html?tab=outbound',
                title: `${m.to_branch} received ${m.manifest_no}`,
                body: [missing ? `${missing} shipment${missing === 1 ? '' : 's'} with missing boxes` : '', left ? `${left} still on the way` : '', m.received_by_name].filter(Boolean).join(' · ')
            };
        }),
        ...shares.filter(x => x.cost_bills && x.cost_bills.branch_code !== branch && !mine(x.cost_bills.created_by_name)).map(x => ({
            id: `sh-${x.cost_bills.id}`, kind: 'cash', at: x.cost_bills.created_at, href: 'accounts.html?tab=costs',
            title: `Your share of ${x.cost_bills.bill_no} · ${money(x.cost_bills.currency, x.amount)}`,
            body: `${x.cost_bills.cost_type} bill shared by ${x.cost_bills.branch_code} — booked as your cost, owed to Main Office`
        }))
    ];

    const [events, manifests, carrier] = await Promise.all([
        get(`tracking_events?event_at=gte.${enc(since)}&status_code=in.(${codes})${notMine}&select=id,status_code,status,remark,event_at,created_by_name,bookings!inner(awb,branch_code)${inBranch}&order=event_at.desc&limit=${LIMIT}`),
        branch || isAdmin
            ? get(`transfer_manifests?status=in.(in_transit,partial)${isAdmin && !branch ? '' : `&to_branch=eq.${enc(branch)}`}&created_at=gte.${enc(since)}&select=id,manifest_no,from_branch,to_branch,status,created_at,created_by_name,transfers(status)&order=created_at.desc&limit=20`)
            : [],
        isAdmin ? get(`bookings?carrier_error=not.is.null&updated_at=gte.${enc(since)}&select=awb,carrier,carrier_error,updated_at&order=updated_at.desc&limit=10`) : []
    ]);

    const seen = session.employee?.notif_seen_at ? new Date(session.employee.notif_seen_at).getTime() : 0;
    const items = [
        ...between,
        ...manifests.map(m => {
            const left = (m.transfers || []).filter(t => t.status === 'pending').length;
            return {
                id: `tr-${m.id}`, kind: 'inbound', at: m.created_at, href: 'consolidation.html?tab=inbound',
                title: `${left} shipment${left === 1 ? '' : 's'} coming from ${m.from_branch}`,
                body: `${m.manifest_no}${m.status === 'partial' ? ' · partly received' : ''}${m.created_by_name ? ' · sent by ' + m.created_by_name : ''}`
            };
        }),
        ...events.map(e => ({
            id: `ev-${e.id}`, kind: e.status_code === 'REVIEWED' ? 'review' : 'exception', at: e.event_at,
            href: `shipments.html?awb=${enc(e.bookings.awb)}`,
            title: e.status_code === 'REVIEWED' ? `New review · ${e.bookings.awb}` : `${e.status} · ${e.bookings.awb}`,
            body: [e.remark, e.created_by_name].filter(Boolean).join(' · ')
        })),
        ...carrier.map(c => ({
            id: `cr-${c.awb}`, kind: 'carrier', at: c.updated_at, href: `shipments.html?awb=${enc(c.awb)}`,
            title: `Carrier sync problem · ${c.awb}`, body: `${(c.carrier || '').toUpperCase()} ${c.carrier_error}`.trim()
        }))
    ]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, LIMIT)
        .map(n => ({ ...n, unread: new Date(n.at).getTime() > seen }));

    return res.status(200).json({ items, unread: items.filter(n => n.unread).length });
}
