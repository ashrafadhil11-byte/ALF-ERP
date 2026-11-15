// File: api/carrier-sync.js
//   GET  — scheduled run (Vercel Cron). Needs header Authorization: Bearer <CRON_SECRET>.
//   POST — "Sync now" from the app: { awb? }. Managers sync their branch, admins everything.
import { requireSession, ADMIN_ROLES } from './_lib/auth.js';
import { runCarrierSync } from './_lib/carrier-sync.js';
import { cleanOrderNo } from './_lib/booking-map.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const secret = process.env.CRON_SECRET;
            if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            return res.status(200).json(await runCarrierSync({ limit: 60 }));
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
