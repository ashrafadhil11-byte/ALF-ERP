// File: api/_routes/assistant.js — "Ask the ERP" (AI assistant).
//   GET                                      { ready, provider }   (ready = an AI integration with a key is active)
//   POST { question, history?: [{ role, content }] }  → { answer, tools, actions }
//        actions = jobs the AI PREPARED (status update, pickup, message, report): shown as cards, nothing changed yet
//   POST { action:'run', proposal: { kind, payload } } → { ok, message }   the user tapped Confirm on a card
// The AI reads through the same APIs as the pages, as this user (see api/_lib/assistant.js); a confirmed job goes
// through the same API too, so it has the same permissions and is written to the Activity Log as that user.
// Questions themselves are not copied to the activity log.
import { requireSession } from '../_lib/auth.js';
import { aiProvider, ask } from '../_lib/assistant.js';
import { runProposal } from '../_lib/ai-tasks.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const auth = req.headers?.authorization;
    try {
        if (req.method === 'GET') {
            const row = await aiProvider();
            return res.status(200).json({ ready: Boolean(row), provider: row ? { name: row.name, adapter: row.adapter, model: row.config?.model || null } : null });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        if (req.body?.action === 'run') {
            try { return res.status(200).json(await runProposal(req.body.proposal, session, auth)); }
            // the job's own refusal (not allowed, not found…): never 401, which would sign the user out
            catch (e) { return res.status(e.status && e.status !== 401 ? e.status : 400).json({ error: e.message }); }
        }
        const q = String(req.body?.question || '').trim().slice(0, 1000);
        if (!q) return res.status(400).json({ error: 'Ask a question.' });
        return res.status(200).json(await ask(q, req.body?.history, session, auth));
    } catch (e) {
        // never pass the AI provider's own status on: its 401 ("wrong key") would sign the user out of the ERP
        if (e.setup) return res.status(503).json({ error: e.message });
        const busy = e.status === 429 || e.status === 503;
        return res.status(502).json({ error: busy ? 'The AI is busy right now — please ask again in a minute.' : `The AI could not answer: ${e.message}` });
    }
}
