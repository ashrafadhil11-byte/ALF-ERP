// File: api/_routes/notifications.js — the bell in the top bar.
//   GET                     { items:[{ id, kind, title, body, at, href, unread }], unread }
//   POST { action:'seen' }  marks everything up to now as read for this user
// Built from live data (no separate queue): incoming transfer manifests, exceptions (failed delivery,
// holds, returns…), customer reviews, and carrier-sync errors. Your own actions are left out.
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

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
    const [events, manifests, carrier] = await Promise.all([
        get(`tracking_events?event_at=gte.${enc(since)}&status_code=in.(${codes})${notMine}&select=id,status_code,status,remark,event_at,created_by_name,bookings!inner(awb,branch_code)${inBranch}&order=event_at.desc&limit=${LIMIT}`),
        branch || isAdmin
            ? get(`transfer_manifests?status=in.(in_transit,partial)${isAdmin && !branch ? '' : `&to_branch=eq.${enc(branch)}`}&created_at=gte.${enc(since)}&select=id,manifest_no,from_branch,to_branch,status,created_at,created_by_name,transfers(status)&order=created_at.desc&limit=20`)
            : [],
        isAdmin ? get(`bookings?carrier_error=not.is.null&updated_at=gte.${enc(since)}&select=awb,carrier,carrier_error,updated_at&order=updated_at.desc&limit=10`) : []
    ]);

    const seen = session.employee?.notif_seen_at ? new Date(session.employee.notif_seen_at).getTime() : 0;
    const items = [
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
