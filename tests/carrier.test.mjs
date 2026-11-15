// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import CONNECTORS, { carrierTextToStatus, carrierForAgent } from '../api/_lib/integrations/connectors.js';
import { runCarrierSync } from '../api/_lib/carrier-sync.js';
import carrierSync from '../api/carrier-sync.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const callWith = (data) => async () => data;

test('carrier text rules', () => {
    const cases = {
        'Shipment delivered': 'DELIVERED', 'Delivery attempted - consignee not available': 'DELIVERY_FAILED',
        'Out for Delivery': 'OUT_FOR_DELIVERY', 'Customs Released': 'IMPORT_CLEARED', 'Under clearance process': 'IMPORT_CUSTOMS',
        'Held by customs': 'CUSTOMS_HOLD', 'Departed Facility in DUBAI': 'IN_TRANSIT', 'Arrived Delivery Facility': 'ARRIVED_DEST_HUB',
        'Returned to shipper': 'RETURNED_TO_SHIPPER', 'Shipment not received yet from shipper': null, 'Picked up from shipper': null
    };
    for (const [t, c] of Object.entries(cases)) assert.equal(carrierTextToStatus(t), c, t);
    assert.deepEqual(['SMSA Express', 'aramex', 'DHL', 'FedEx', ''].map(carrierForAgent), ['smsa', 'aramex', 'dhl', '17track', '17track']);
});

test('SMSA scans → events (scan codes win, ReceivedBy kept)', async () => {
    const ev = await CONNECTORS.smsa.fetchEvents({ call: callWith({ Scans: [
        { ScanDateTime: '2026-11-10T08:00:00', ScanType: 'CR', ScanDescription: 'Customs Released', City: 'Riyadh' },
        { ScanDateTime: '2026-11-11T08:00:00', ScanType: 'DL', ScanDescription: 'Delivered', City: 'Riyadh', ReceivedBy: 'Ahmed' }
    ] }) }, '1');
    assert.deepEqual(ev.map(e => e.code), ['IMPORT_CLEARED', 'DELIVERED']);
    assert.equal(ev[1].remark, 'Received by Ahmed');
});

test('DHL statusCode delivered/failure', async () => {
    const ev = await CONNECTORS.dhl.fetchEvents({ call: callWith({ shipments: [{ events: [
        { timestamp: '2026-11-10T08:00:00Z', statusCode: 'transit', description: 'Departed from facility', location: { address: { addressLocality: 'Leipzig' } } },
        { timestamp: '2026-11-12T08:00:00Z', statusCode: 'delivered', description: 'Delivered - Signed for by: R' }
    ] }] }) }, '1');
    assert.deepEqual(ev.map(e => [e.code, e.location]), [['IN_TRANSIT', 'Leipzig'], ['DELIVERED', null]]);
});

test('17Track registers unknown numbers, maps stages', async () => {
    const called = [];
    const none = await CONNECTORS['17track'].fetchEvents({ call: async (ep) => { called.push(ep); return { code: 0, data: { accepted: [] } }; } }, 'X');
    assert.deepEqual([none, called], [[], ['track', 'register']]);
    const ev = await CONNECTORS['17track'].fetchEvents({ call: callWith({ data: { accepted: [{ track_info: { tracking: { providers: [{ events: [
        { time_iso: '2026-11-12T10:00:00+05:45', stage: 'Delivered', description: 'Item delivered', location: 'Kathmandu' },
        { time_iso: '2026-11-11T10:00:00+05:45', stage: null, description: 'Out for delivery' }
    ] }] } } }] } }) }, 'X');
    assert.deepEqual(ev.map(e => e.code), ['DELIVERED', 'OUT_FOR_DELIVERY']);
});

test('Aramex XML parsed with namespaces', async () => {
    const xml = '<s:Envelope><a:TrackingResult><a:UpdateDescription>Delivered</a:UpdateDescription><a:UpdateLocation>Kathmandu</a:UpdateLocation><a:UpdateDateTime>2026-11-10T10:00:00</a:UpdateDateTime><a:Comments>R &amp; S</a:Comments></a:TrackingResult></s:Envelope>';
    const ev = await CONNECTORS.aramex.fetchEvents({ call: callWith(xml) }, '1');
    assert.deepEqual([ev[0].code, ev[0].location, ev[0].remark], ['DELIVERED', 'Kathmandu', 'R & S']);
});

function fakeDb({ bookings, integrations, carrierResponse, rpcFail }) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        calls.push({ url, opts });
        const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
        if (url.includes('/rest/v1/bookings?archived')) return json(bookings);
        if (url.includes('/rest/v1/integrations?kind=eq.carrier')) return json(integrations);
        if (url.includes('rpc/apply_carrier_events')) return rpcFail ? json({ message: 'db down' }, false, 400) : json({ added: 2, moved: 1 });
        if (url.includes('ecomapis.smsaexpress.com')) return carrierResponse;
        return json([]);
    };
    return calls;
}

test('sync: active carrier updates; inactive carrier skipped; errors recorded on the booking', async () => {
    const smsa = { id: 'i1', adapter: 'smsa', kind: 'carrier', active: true, secret: { api_key: 'k' }, config: {} };
    const ok = { ok: true, status: 200, text: async () => JSON.stringify({ Scans: [{ ScanDateTime: '2026-11-10T08:00:00Z', ScanDescription: 'Delivered' }] }) };
    let calls = fakeDb({ bookings: [{ id: 'b1', awb: 'A', fwd_agent: 'SMSA', fwd_docket: '99' }, { id: 'b2', awb: 'B', fwd_agent: 'DHL', fwd_docket: '1' }], integrations: [smsa], carrierResponse: ok });
    let r = await runCarrierSync();
    assert.deepEqual([r.found, r.checked, r.updated, r.moved, r.skipped, r.errors.length], [2, 1, 1, 1, 1, 0]);
    const rpc = JSON.parse(calls.find(c => c.url.includes('apply_carrier_events')).opts.body);
    assert.equal(rpc.p_events[0].code, 'DELIVERED');
    assert.ok(calls.find(c => c.url.includes('integrations?id=eq.i1') && JSON.parse(c.opts.body).last_status === 'ok'));
    assert.ok(calls[0].url.includes('current_status_code=not.in.(DELIVERED'));

    calls = fakeDb({ bookings: [{ id: 'b1', awb: 'A', fwd_agent: 'SMSA', fwd_docket: '99' }], integrations: [smsa], carrierResponse: { ok: false, status: 401, text: async () => '{"message":"Invalid apikey"}' } });
    r = await runCarrierSync();
    assert.match(r.errors[0].error, /Invalid apikey/);
    const patch = calls.find(c => c.url.includes('bookings?id=eq.b1'));
    assert.match(JSON.parse(patch.opts.body).carrier_error, /Invalid apikey/);
});

test('cron endpoint requires CRON_SECRET', async () => {
    const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
    delete process.env.CRON_SECRET;
    let r = res();
    await carrierSync({ method: 'GET', headers: {} }, r);
    assert.equal(r.code, 401);
    process.env.CRON_SECRET = 's3cret';
    r = res();
    await carrierSync({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, r);
    assert.equal(r.code, 401);
    fakeDb({ bookings: [], integrations: [] });
    r = res();
    await carrierSync({ method: 'GET', headers: { authorization: 'Bearer s3cret' } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.found, 0);
});
