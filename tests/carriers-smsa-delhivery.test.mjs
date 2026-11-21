// Run: node --test tests/
// SMSA (reply wrapped twice when asked for JSON; scan times with their own zone) and Delhivery B2B (LR, no key).
import test from 'node:test';
import assert from 'node:assert';
import CONNECTORS, { carrierForAgent, zonedIso } from '../api/_lib/integrations/connectors.js';
import { callApi } from '../api/_lib/integrations/http.js';
import { runCarrierSync } from '../api/_lib/carrier-sync.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const SMSA_REPLY = { AWB: '291747438437', Reference: '0620402', Scans: [
    { City: 'BathaBorder GW', ScanType: 'BTRI', ScanDescription: 'Shipment departed at the border - In Transit to destination', ScanDateTime: '2026-11-20T18:45:00', ScanTimeZone: '+03:00' },
    { City: 'Muscat St', ScanType: 'PU', ScanDescription: 'Shipment Picked up from the shipper', ScanDateTime: '2026-11-18T12:48:00', ScanTimeZone: '+04:00' }] };
const DELHIVERY_REPLY = { status: 'DELIVERED', location: 'Chiplun_Walope_D (Maharashtra)', timestamp: '2026-11-02T16:44:28.002000', lrnum: '321920692', origin_city: 'Navi mumbai',
    scan_remark: 'Shipment Delivered', mwbn: '57796210023192', pickup_date: '2026-10-29T13:55:41', manifested_date: '2026-10-27T13:26:19.954000', delivered_date: '2026-11-02T16:44:28.002000',
    estimated_date: '2026-11-02T23:59:59', origin_branch: 'Mumbai_Talojamidc_L (Maharashtra)' };
const reply = (status, text, type = 'application/json; charset=utf-8') => { const calls = []; globalThis.fetch = async (u, o) => { calls.push({ url: String(u), headers: o?.headers }); return new Response(text, { status, headers: { 'content-type': type } }); }; return calls; };
const smsaRow = { adapter: 'smsa', config: {}, secret: { api_key: 'K' } };
const events = (id, row, docket) => CONNECTORS[id].fetchEvents({ call: (e, p) => callApi(id, e, p, row) }, docket);

test('SMSA: the reply wrapped twice is read; each scan keeps its own time zone', async () => {
    const calls = reply(200, JSON.stringify(JSON.stringify(SMSA_REPLY)));        // "\"{\\\"AWB\\\"…}\"" as SMSA sends it
    const ev = await events('smsa', smsaRow, '291747438437');
    assert.equal(calls[0].headers.apikey, 'K');
    assert.equal(ev.length, 2);
    assert.equal(ev[0].at, '2026-11-20T15:45:00.000Z');                         // 18:45 at the Saudi border (+03:00)
    assert.equal(ev[1].at, '2026-11-18T08:48:00.000Z');                         // 12:48 in Muscat (+04:00)
    assert.equal(ev[0].code, 'IN_TRANSIT');
    reply(200, JSON.stringify(SMSA_REPLY), 'text/plain; charset=utf-8');           // the plain form still works
    assert.equal((await events('smsa', smsaRow, '291747438437')).length, 2);
});

test('SMSA: a reply without scans is an error to show, not "nothing new"', async () => {
    reply(200, JSON.stringify({ message: 'AWB not found' }));
    await assert.rejects(events('smsa', smsaRow, '1'), /SMSA reply not understood: AWB not found/);
    reply(200, JSON.stringify({ AWB: '1', Scans: [] }));                            // no scans yet is fine
    assert.deepEqual(await events('smsa', smsaRow, '1'), []);
});

test('zonedIso: adds the zone only when the time has none', () => {
    assert.equal(zonedIso('2026-11-20T18:45:00', '+0300'), '2026-11-20T15:45:00.000Z');
    assert.equal(zonedIso('2026-11-20T18:45:00Z', '+03:00'), '2026-11-20T18:45:00.000Z');
    assert.equal(zonedIso('', '+03:00'), null);
});

test('Delhivery: LR tracking without a key — manifested, picked up and the latest status (India time)', async () => {
    assert.equal(carrierForAgent('Delhivery B2B'), 'delhivery');
    const calls = reply(200, JSON.stringify(DELHIVERY_REPLY), '');
    const ev = await events('delhivery', null, ' 321920692 ');
    assert.equal(calls[0].url, 'https://btob.api.delhivery.com/v2/track/321920692');
    assert.deepEqual(ev.map(e => [e.at, e.code]), [
        ['2026-10-27T07:56:19.954Z', null], ['2026-10-29T08:25:41.000Z', null], ['2026-11-02T11:14:28.002Z', 'DELIVERED']]);
    assert.equal(ev[2].description, 'Shipment Delivered');
    assert.equal(ev[2].location, 'Chiplun Walope D (Maharashtra)');
    assert.match(ev[0].remark, /57796210023192/);
    reply(200, JSON.stringify({ ...DELHIVERY_REPLY, status: 'IN_TRANSIT', scan_remark: 'Dispatched', delivered_date: null, timestamp: '2026-10-31T10:00:00' }), '');
    const moving = await events('delhivery', null, '321920692');
    assert.equal(moving.at(-1).code, 'IN_TRANSIT');
    assert.equal(moving.at(-1).remark, 'Expected 2026-11-02');
});

test('Delhivery: an unknown LR says so plainly', async () => {
    reply(404, '{}', '');
    await assert.rejects(events('delhivery', null, '999000111'), /Delhivery does not know LR 999000111/);
});

test('carrier sync: Delhivery runs with no Integrations row; its events are saved', async () => {
    const saved = [];
    globalThis.fetch = async (u, o = {}) => {
        const url = decodeURIComponent(String(u));
        const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('/rest/v1/bookings?')) return json([{ id: 'b1', awb: '0620500', fwd_agent: 'DELHIVERY', fwd_docket: '321920692' }]);
        if (url.includes('/rest/v1/integrations?kind=eq.carrier')) return json([]);          // nothing set up
        if (url.includes('btob.api.delhivery.com')) return json(DELHIVERY_REPLY);
        if (url.includes('/rpc/apply_carrier_events')) { saved.push(JSON.parse(o.body)); return json({ added: 3, moved: 1 }); }
        return json([]);
    };
    const out = await runCarrierSync({ limit: 5 });
    assert.equal(out.checked, 1); assert.equal(out.skipped, 0); assert.deepEqual(out.errors, []);
    assert.equal(saved[0].p_carrier, 'delhivery');
    assert.equal(saved[0].p_events.length, 3);
});
