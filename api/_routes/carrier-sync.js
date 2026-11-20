// File: api/carrier-sync.js
//   GET  — scheduled run (Vercel Cron, ~6 am Oman). Needs header Authorization: Bearer <CRON_SECRET>.
//          First sends the morning AI reports (yesterday's figures, api/_lib/ai-tasks.js), then syncs carriers.
//   POST — "Sync now" from the app: { awb? }. Managers sync their branch, admins everything.
import { requireSession, ADMIN_ROLES } from '../_lib/auth.js';
import { runCarrierSync } from '../_lib/carrier-sync.js';
import { runReports } from '../_lib/ai-tasks.js';
import { cleanOrderNo } from '../_lib/booking-map.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const secret = process.env.CRON_SECRET;
            if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            let reports = null;
            try { reports = await runReports('morning'); } catch (e) { console.error('[ai-reports] morning failed:', e.message); reports = { error: e.message }; }
            return res.status(200).json({ ...(await runCarrierSync({ limit: 60 })), reports });
        }

        if (req.method === 'POST') {
            const session = await requireSession(req, res, ['super_admin', 'head_office', 'branch_manager', 'staff']);
            if (!session) return;
            const awb = cleanOrderNo((req.body || {}).awb);
            // Staff may refresh a single shipment of their branch; full runs are for managers and admins.
            if (!awb && session.role === 'staff') return res.status(403).json({ error: 'Only managers can sync all shipments.' });
            const branch = ADMIN_ROLES.includes(session.role) ? undefined : session.branch;
            return res.status(200).json(await runCarrierSync({ awb: awb || undefined, branch, limit: awb ? 1 : 40 }));
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: 'Carrier sync failed.' });
    }
}
