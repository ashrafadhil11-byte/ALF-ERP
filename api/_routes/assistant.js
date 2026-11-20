// File: api/_routes/assistant.js — Farah, the AI assistant (a chat in Messages; see api/_lib/farah.js).
//   GET                                          { ready, provider, name, thread }   (thread = my Farah chat, made if needed)
//   POST { action:'reply', thread }              → { message }   Farah answers my latest message in that chat
//   POST { action:'run' | 'cancel', message, id } → { message, ok, result }   Confirm / Cancel a job card in her message
// The user's own message is sent with the normal chat API first (action 'send'). Farah reads through the same APIs as
// the pages, as this user; a confirmed job runs through the normal API too — same permissions, in the Activity Log.
// This route itself is kept out of the activity log (private chat).
import { requireSession, serviceHeaders } from '../_lib/auth.js';
import { aiProvider } from '../_lib/assistant.js';
import { ensureFarah, reply, act, FARAH } from '../_lib/farah.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const auth = req.headers?.authorization;
    const me = session.user.id;
    try {
        if (req.method === 'GET') {
            const [row] = await Promise.all([aiProvider(), ensureFarah(me, session.employee?.full_name)]);
            const t = await fetch(`${process.env.SUPABASE_URL}/rest/v1/chat_threads?direct_key=eq.${encodeURIComponent('ai:' + me)}&select=id`, { headers: serviceHeaders() }).then(r => r.ok ? r.json() : []);
            return res.status(200).json({ ready: Boolean(row), name: FARAH, thread: t[0]?.id || null, provider: row ? { name: row.name, adapter: row.adapter, model: row.config?.model || null } : null });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        if (b.action === 'reply') return res.status(200).json(await reply(session, auth, b.thread));
        if (b.action === 'run' || b.action === 'cancel') return res.status(200).json(await act(session, auth, b.message, String(b.id || ''), b.action));
        return res.status(400).json({ error: 'Unknown action.' });
    } catch (e) {
        // never 401 here: that would sign the user out of the ERP
        return res.status(e.status && e.status !== 401 && e.status < 500 ? e.status : 500).json({ error: e.message || 'Farah could not answer.' });
    }
}
