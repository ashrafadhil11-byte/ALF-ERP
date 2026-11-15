// File: api/_lib/postal.js — postcode / short-address lookup across every connector that has `postal`.
// Add or change a provider in integrations/connectors.js, not here.
import CONNECTORS from './integrations/connectors.js';
import { callApi } from './integrations/http.js';

/** Providers that can answer this code for this country, best first. */
export function providersFor(code, cc) {
    return Object.entries(CONNECTORS)
        .filter(([, c]) => c.postal && c.postal.covers(code, cc))
        .sort(([, a], [, b]) => a.postal.priority - b.postal.priority)
        .map(([id]) => id);
}

/**
 * @returns {{ locations: object[], provider: string|null, errors: string[] }}
 * Keyless connectors (no `secrets`) skip the Integrations lookup; keyed ones read their key from there / env.
 */
export async function lookupPostal(code, countryCode) {
    const c = String(code || '').trim().replace(/\s+/g, ' ');
    const cc = String(countryCode || '').trim().toUpperCase();
    const errors = [];
    for (const id of providersFor(c, cc)) {
        const conn = CONNECTORS[id];
        const row = conn.secrets ? undefined : null;
        const call = (endpoint, params) => callApi(id, endpoint, params, row);
        try {
            const locations = (await conn.postal.lookup({ call }, c, cc)).filter(l => l.postalCode || l.city || l.postOffice);
            if (locations.length) return { locations, provider: id, errors };
        } catch (e) {
            // 404 = "no such code" for most of these APIs — not worth reporting
            if (e.status !== 404) errors.push(`${conn.label}: ${e.message}`);
        }
    }
    return { locations: [], provider: null, errors };
}
