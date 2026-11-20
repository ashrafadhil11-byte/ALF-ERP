// File: api/_routes/summary.js — daily manager summary.
//   GET [?date=YYYY-MM-DD&branch=]   managers: their branch; head office: every branch + company total (live)
//   GET with "Authorization: Bearer <CRON_SECRET>" (Vercel Cron, 8 pm Oman): saves today's summary of every branch
//   and the company in daily_summaries — the bell then tells managers it is ready — then makes the nightly backup
//   and sends the evening AI reports (api/_lib/ai-tasks.js).
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { runBackup } from '../_lib/backup.js';
import { totalOf } from '../_lib/summary-total.js';
import { runReports } from '../_lib/ai-tasks.js';

const enc = encodeURIComponent;
const omanDay = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);
export { totalOf };

export default async function handler(req, res) {
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const day1 = async (day, branch) => {
        const r = await fetch(`${rest}/rpc/daily_summary`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ p_day: day, p_branch: branch }) });
        if (!r.ok) throw new Error(`daily_summary ${branch}: ${r.status}`);
        return r.json();
    };
    const branchesAll = () => get('branches?branch_type=eq.branch&status=neq.Dismissed&select=branch_code,branch_name&order=branch_name');

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // ---------- the evening job ----------
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization === `Bearer ${secret}`) {
        try {
            const day = omanDay();
            const branches = await branchesAll();
            const list = await Promise.all(branches.map(b => day1(day, b.branch_code)));
            const rows = [...list.map(d => ({ day, branch_code: d.branch, data: d })), { day, branch_code: null, data: totalOf(list, day) }];
            // replace today's rows (the job may run twice)
            await fetch(`${rest}/daily_summaries?day=eq.${day}`, { method: 'DELETE', headers: serviceHeaders() });
            const w = await fetch(`${rest}/daily_summaries`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
            if (!w.ok) throw new Error(`save ${w.status}`);
            // the nightly backup rides on the same job (one scheduled job instead of two)
            let backup = null;
            try { backup = await runBackup('nightly'); } catch (e) { console.error('[backup] nightly failed:', e.message); backup = { error: e.message }; }
            // and the evening AI reports people asked for (Messages → AI Assistant)
            let reports = null;
            try { reports = await runReports('evening'); } catch (e) { console.error('[ai-reports] evening failed:', e.message); reports = { error: e.message }; }
            return res.status(200).json({ success: true, day, branches: list.length, backup, reports });
        } catch (e) {
            console.error('[summary] evening job failed:', e.message);
            return res.status(500).json({ error: 'Summary job failed.' });
        }
    }

    // ---------- people ----------
    const session = await requireSession(req, res);
    if (!session) return;
    const isAdmin = ADMIN_ROLES.includes(session.role);
    if (!isAdmin && session.role !== 'branch_manager') return res.status(403).json({ error: 'The daily summary is for managers.' });
    try {
        const q = req.query || {};
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? q.date : omanDay();
        if (day > omanDay()) return res.status(400).json({ error: 'That day has not happened yet.' });
        const all = await branchesAll();
        const names = Object.fromEntries(all.map(b => [b.branch_code, b.branch_name]));
        let codes;
        if (isAdmin) codes = q.branch ? [String(q.branch).toUpperCase()] : all.map(b => b.branch_code);
        else codes = session.branch ? [session.branch] : [];
        if (!codes.length) return res.status(400).json({ error: 'Your account has no branch.' });
        const list = (await Promise.all(codes.map(c => day1(day, c)))).map(d => ({ ...d, branch_name: names[d.branch] || d.branch }));
        return res.status(200).json({ day, today: omanDay(), branches: list, total: isAdmin && list.length > 1 ? totalOf(list, day) : null, all: isAdmin ? all : [] });
    } catch (e) {
        return res.status(500).json({ error: 'Could not build the summary.', details: e.message });
    }
}
