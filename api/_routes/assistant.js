// File: api/_routes/assistant.js — "Ask the ERP" (AI assistant).
//   GET                                      { ready, provider }   (ready = an AI integration with a key is active)
//   POST { question, history?: [{ role, content }] }  → { answer, tools }
// Read-only and limited to what the user may see — see api/_lib/assistant.js. Questions are not copied to the activity log.
import { requireSession } from '../_lib/auth.js';
import { aiProvider, ask } from '../_lib/assistant.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    try {
        if (req.method === 'GET') {
            const row = await aiProvider();
            return res.status(200).json({ ready: Boolean(row), provider: row ? { name: row.name, adapter: row.adapter, model: row.config?.model || null } : null });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const q = String(req.body?.question || '').trim().slice(0, 1000);
        if (!q) return res.status(400).json({ error: 'Ask a question.' });
        return res.status(200).json(await ask(q, req.body?.history, session));
    } catch (e) {
        return res.status(e.status || 502).json({ error: e.status === 503 ? e.message : `The AI could not answer: ${e.message}` });
    }
}
