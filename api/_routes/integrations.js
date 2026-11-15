// File: api/integrations.js — manage 3rd-party APIs (super_admin edits, head_office views).
// Secrets are write-only: GET never returns them, only which secret fields are set.
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { connectorCatalog, testConnector } from '../_lib/integrations/http.js';

const KINDS = ['order_source', 'carrier', 'notification', 'other'];
const PUBLIC_COLS = 'id,name,kind,adapter,base_url,config,active,last_sync_at,last_status,last_error,updated_at';

function toPublic(row) {
    const { secret, ...rest } = row;
    return { ...rest, secret_set: Object.keys(secret || {}).filter(k => secret[k]) };
}

export default async function handler(req, res) {
    const { SUPABASE_URL } = process.env;
    const db = `${SUPABASE_URL}/rest/v1/integrations`;
    const session = await requireSession(req, res, req.method === 'GET' ? ADMIN_ROLES : ['super_admin']);
    if (!session) return;

    try {
        if (req.method === 'GET') {
            const r = await fetch(`${db}?select=${PUBLIC_COLS},secret&order=kind,name`, { headers: serviceHeaders() });
            const rows = r.ok ? await r.json() : [];
            return res.status(200).json({ integrations: rows.map(toPublic), adapters: connectorCatalog() });
        }

        const body = req.body || {};

        // Test a saved integration: POST { action: 'test', id, input }
        if (req.method === 'POST' && body.action === 'test') {
            const r = await fetch(`${db}?id=eq.${encodeURIComponent(body.id)}&select=*`, { headers: serviceHeaders() });
            const row = (r.ok ? await r.json() : [])[0];
            if (!row) return res.status(404).json({ error: 'Integration not found.' });
            let result;
            try {
                result = await testConnector(row, body.input || {});
            } catch (e) {
                result = { ok: false, message: e.message };
            }
            await fetch(`${db}?id=eq.${encodeURIComponent(row.id)}`, {
                method: 'PATCH',
                headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
                body: JSON.stringify({
                    last_sync_at: new Date().toISOString(),
                    last_status: result.ok ? 'ok' : 'error',
                    last_error: result.ok ? null : String(result.message).slice(0, 500)
                })
            });
            return res.status(200).json(result);
        }

        // Create (POST) or update (PUT) — secret fields merge; empty values keep the stored one.
        if (req.method === 'POST' || req.method === 'PUT') {
            const { id, name, kind, adapter, base_url, config, active, secret } = body;
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
            if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid type.' });
            if (!connectorCatalog().some(c => c.id === adapter)) return res.status(400).json({ error: 'Unknown connector — add it in api/_lib/integrations/connectors.js first.' });
            if (base_url && !/^https:\/\//i.test(base_url)) return res.status(400).json({ error: 'Base URL must start with https://' });

            let storedSecret = {};
            if (req.method === 'PUT') {
                if (!id) return res.status(400).json({ error: 'ID is required.' });
                const r = await fetch(`${db}?id=eq.${encodeURIComponent(id)}&select=secret`, { headers: serviceHeaders() });
                storedSecret = ((r.ok ? await r.json() : [])[0] || {}).secret || {};
            }
            const newSecret = { ...storedSecret };
            for (const [k, v] of Object.entries(secret || {})) {
                if (typeof v === 'string' && v.trim()) newSecret[k] = v.trim();
            }

            const payload = {
                name: String(name).trim(), kind, adapter,
                base_url: base_url ? String(base_url).trim() : null,
                config: config && typeof config === 'object' ? config : {},
                active: Boolean(active),
                secret: newSecret,
                updated_at: new Date().toISOString()
            };
            const url = req.method === 'PUT' ? `${db}?id=eq.${encodeURIComponent(id)}` : db;
            const r = await fetch(url, {
                method: req.method === 'PUT' ? 'PATCH' : 'POST',
                headers: { ...serviceHeaders(), Prefer: 'return=representation' },
                body: JSON.stringify(payload)
            });
            const data = await r.json();
            if (!r.ok) {
                const msg = JSON.stringify(data).includes('integrations_name_key') ? 'An integration with this name already exists.' : 'Failed to save integration.';
                return res.status(400).json({ error: msg });
            }
            return res.status(200).json({ success: true, integration: toPublic(Array.isArray(data) ? data[0] : data) });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
