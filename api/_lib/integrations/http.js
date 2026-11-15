// File: api/_lib/integrations/http.js — the engine that runs any connector from connectors.js.
// You normally never edit this file; edit connectors.js instead.
import CONNECTORS from './connectors.js';
import { serviceHeaders } from '../auth.js';

export class ApiError extends Error {
    constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

const TIMEOUT_MS = 8000;

/** Loads the Integrations row for a connector (base URL / keys / settings saved from the admin page). */
export async function loadIntegration(connectorId) {
    const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/integrations?adapter=eq.${encodeURIComponent(connectorId)}&select=*&order=active.desc&limit=1`,
        { headers: serviceHeaders() }
    );
    return (r.ok ? await r.json() : [])[0] || null;
}

/** Secrets saved in Integrations win; otherwise the env var named in the connector (Vercel settings). */
function resolveSecrets(conn, row) {
    const out = {};
    for (const [name, envVar] of Object.entries(conn.secrets || {})) {
        out[name] = row?.secret?.[name] || (envVar ? process.env[envVar] : undefined);
    }
    return out;
}

/**
 * Calls one endpoint of one connector.
 *   await callApi('alfarhaonline', 'getOrder', { orderNo: '4120431' })
 * @param row optional Integrations row (pass it when you already loaded it)
 */
export async function callApi(connectorId, endpointName, params = {}, row) {
    const conn = CONNECTORS[connectorId];
    if (!conn) throw new ApiError(`Unknown connector "${connectorId}".`);
    const ep = conn.endpoints?.[endpointName];
    if (!ep) throw new ApiError(`Connector "${connectorId}" has no endpoint "${endpointName}".`);

    if (row === undefined) row = await loadIntegration(connectorId);
    const secrets = resolveSecrets(conn, row);
    const config = { ...(conn.config || {}), ...(row?.config || {}) };
    const ctx = { params, secrets, config };

    const missing = (conn.requiredSecrets || Object.keys(conn.secrets || {})).filter(k => !secrets[k]);
    if (missing.length) throw new ApiError(`Missing ${missing.join(', ')} — add it in Integrations or Vercel env.`);

    const bases = [row?.base_url || conn.baseUrl, ...(conn.fallbackUrls || [])].filter(Boolean);
    if (!bases.length) throw new ApiError('No base URL configured.');

    const path = typeof ep.path === 'function' ? ep.path(ctx) : ep.path || '';
    const query = ep.query ? ep.query(ctx) : null;
    const rawBody = ep.body ? ep.body(ctx) : undefined;
    const isText = typeof rawBody === 'string';
    const headers = {
        Accept: 'application/json',
        ...(rawBody !== undefined && !isText ? { 'Content-Type': 'application/json' } : {}),
        ...(conn.headers ? conn.headers(ctx) : {}),
        ...(ep.headers ? ep.headers(ctx) : {})
    };

    let lastError;
    for (const base of bases) {
        const url = new URL(base.replace(/\/$/, '') + path);
        if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ep.timeoutMs || TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: ep.method || 'GET',
                headers,
                body: rawBody === undefined ? undefined : isText ? rawBody : JSON.stringify(rawBody),
                signal: ctrl.signal
            });
            const text = await res.text();
            let data = text;
            try { data = JSON.parse(text); } catch (e) { /* XML / plain text stays a string */ }

            const ok = ep.isOk ? ep.isOk(data, res) : res.ok;
            if (ok) return ep.parse ? ep.parse(data, ctx) : data;

            const msg = (data && typeof data === 'object' && (data.message || data.error)) || `HTTP ${res.status}`;
            lastError = new ApiError(String(msg), res.status, data);
            if (res.status && res.status < 500 && res.status !== 404) break; // auth / bad request: other URLs won't help
        } catch (e) {
            lastError = e.name === 'AbortError' ? new ApiError(`Timed out after ${(ep.timeoutMs || TIMEOUT_MS) / 1000}s (${url.host}).`) : e;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError;
}

/** What the Integrations page needs to draw the form (no secrets). */
export function connectorCatalog() {
    return Object.entries(CONNECTORS).map(([id, c]) => ({
        id,
        label: c.label,
        kinds: c.kinds || ['other'],
        secretFields: Object.keys(c.secrets || {}),
        configFields: Object.keys(c.config || {}),
        testInput: c.testInput || null,
        ready: Boolean(c.test)
    }));
}

/** Runs a connector's test (used by the Test button in Integrations). */
export async function testConnector(row, input = {}) {
    const conn = CONNECTORS[row.adapter];
    if (!conn?.test) throw new ApiError(`Connector "${row.adapter}" has no test yet.`);
    if (conn.testInput && !String(input.value || '').trim()) throw new ApiError(`Enter a ${conn.testInput} to test with.`);
    const call = (endpoint, params) => callApi(row.adapter, endpoint, params, row);
    return conn.test({ call, input, row });
}
