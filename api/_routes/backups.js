// File: api/_routes/backups.js — backups you keep (super admin only).
//   GET                      the backup files (newest first) + how many are kept
//   GET ?download=<name>     a 5-minute download link for one file
//   POST { action:'run' }    make a backup now
// The nightly backup runs with the evening job (api/_routes/summary.js).
import { requireSession } from '../_lib/auth.js';
import { isSuperAdmin } from '../_lib/pin.js';
import { KEEP, listBackups, runBackup, signBackup } from '../_lib/backup.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    if (!isSuperAdmin(session)) return res.status(403).json({ error: 'Backups are for the super admin.' });
    try {
        if (req.method === 'GET') {
            const q = req.query || {};
            if (q.download) {
                const url = await signBackup(String(q.download));
                if (!url) return res.status(404).json({ error: 'Backup not found.' });
                return res.status(200).json({ url });
            }
            return res.status(200).json({ backups: await listBackups(), keep: KEEP });
        }
        if (req.method === 'POST' && (req.body || {}).action === 'run') {
            const out = await runBackup(session.employee?.full_name || session.user.email);
            return res.status(200).json({ success: true, ...out });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        console.error('[backups]', e.message);
        return res.status(500).json({ error: 'Backup failed.', details: e.message });
    }
}
