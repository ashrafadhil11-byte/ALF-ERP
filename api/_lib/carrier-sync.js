// File: api/_lib/carrier-sync.js — pulls tracking from carriers and updates shipments.
// Which shipments: not archived, not closed, with a forwarding docket (set on "Handed to Forwarding Agent").
// Which carrier: carrierForAgent(fwd_agent) in connectors.js.
import CONNECTORS, { carrierForAgent } from './integrations/connectors.js';
import { callApi } from './integrations/http.js';
import { serviceHeaders } from './auth.js';

const CLOSED = ['DELIVERED', 'REVIEW_REQUESTED', 'REVIEWED', 'CANCELLED', 'RETURNED_TO_SHIPPER'];
const CONCURRENCY = 4;

/**
 * @param opts.awb    sync just this AWB
 * @param opts.branch only this branch (non-admin "Sync now")
 * @param opts.limit  max shipments per run (oldest-synced first)
 */
export async function runCarrierSync({ awb, branch, limit = 40 } = {}) {
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const filters = ['archived=is.false', 'fwd_docket=not.is.null', `current_status_code=not.in.(${CLOSED.join(',')})`];
    if (awb) filters.push(`awb=eq.${encodeURIComponent(awb)}`);
    if (branch) filters.push(`branch_code=eq.${encodeURIComponent(branch)}`);
    const br = await fetch(`${rest}/bookings?${filters.join('&')}&select=id,awb,fwd_agent,fwd_docket&order=carrier_synced_at.asc.nullsfirst&limit=${limit}`, { headers: serviceHeaders() });
    const bookings = br.ok ? await br.json() : [];

    // One Integrations lookup for all carriers.
    const ir = await fetch(`${rest}/integrations?kind=eq.carrier&select=*`, { headers: serviceHeaders() });
    const rows = Object.fromEntries((ir.ok ? await ir.json() : []).map(r => [r.adapter, r]));

    const summary = { checked: 0, updated: 0, moved: 0, skipped: 0, errors: [] };
    const perCarrier = {};

    async function syncOne(b) {
        const carrier = carrierForAgent(b.fwd_agent);
        const conn = CONNECTORS[carrier];
        const row = rows[carrier];
        if (!conn?.fetchEvents || !row?.active) {
            summary.skipped++;
            return;
        }
        summary.checked++;
        try {
            const call = (endpoint, params) => callApi(carrier, endpoint, params, row);
            const events = await conn.fetchEvents({ call }, String(b.fwd_docket).trim());
            const r = await fetch(`${rest}/rpc/apply_carrier_events`, {
                method: 'POST',
                headers: serviceHeaders(),
                body: JSON.stringify({ p_booking_id: b.id, p_carrier: carrier, p_events: events })
            });
            const out = await r.json();
            if (!r.ok) throw new Error(out.message || 'Could not save events');
            if (out.added) summary.updated++;
            summary.moved += out.moved || 0;
            perCarrier[carrier] = perCarrier[carrier] || { ok: 0, err: null };
            perCarrier[carrier].ok++;
        } catch (e) {
            const msg = String(e.message || e).slice(0, 300);
            summary.errors.push({ awb: b.awb, carrier, error: msg });
            perCarrier[carrier] = perCarrier[carrier] || { ok: 0, err: null };
            perCarrier[carrier].err = msg;
            await fetch(`${rest}/bookings?id=eq.${b.id}`, {
                method: 'PATCH',
                headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
                body: JSON.stringify({ carrier, carrier_synced_at: new Date().toISOString(), carrier_error: msg })
            });
        }
    }

    for (let i = 0; i < bookings.length; i += CONCURRENCY) {
        await Promise.all(bookings.slice(i, i + CONCURRENCY).map(syncOne));
    }

    // Health shown on the dashboard / Integrations page.
    await Promise.all(Object.entries(perCarrier).map(([carrier, s]) => fetch(`${rest}/integrations?id=eq.${rows[carrier].id}`, {
        method: 'PATCH',
        headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ last_sync_at: new Date().toISOString(), last_status: s.ok ? 'ok' : 'error', last_error: s.ok ? null : s.err })
    })));

    return { found: bookings.length, ...summary };
}
