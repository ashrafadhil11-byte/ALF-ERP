// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import { providersFor, lookupPostal } from '../api/_lib/postal.js';
import postalRoute from '../api/_routes/postal-lookup.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fake(routes) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        calls.push({ url, headers: opts.headers || {} });
        for (const [part, fn] of Object.entries(routes)) {
            if (url.includes(part)) { const [status, body] = fn(url); return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }; }
        }
        return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
    };
    return calls;
}

test('providersFor: right provider per country, best first', () => {
    assert.deepEqual(providersFor('670561', 'IN').slice(0, 1), ['india_post']);
    assert.deepEqual(providersFor('SW1A 1AA', 'GB').slice(0, 1), ['postcodes_io']);
    assert.deepEqual(providersFor('RAAA2919', 'SA').slice(0, 1), ['saudi_address']);
    assert.deepEqual(providersFor('12345', 'SA').slice(0, 1), ['saudi_address']);
    assert.deepEqual(providersFor('10001', 'US').slice(0, 1), ['zippopotam']);
    assert.deepEqual(providersFor('211', 'OM'), ['zipcodebase']);
    assert.deepEqual(providersFor('RAAA2919', 'SA'), ['saudi_address']);
    assert.ok(!providersFor('RAA2919', 'SA').includes('saudi_address'));
});

test('Canada: only the first 3 characters are sent, full code kept', async () => {
    const calls = fake({ 'zippopotam.us/ca/M5V': () => [200, { 'post code': 'M5V', places: [{ 'place name': 'Downtown Toronto (CN Tower)', state: 'Ontario', 'state abbreviation': 'ON', latitude: '43.6', longitude: '-79.4' }] }] });
    const r = await lookupPostal('m5v 3l9', 'CA');
    assert.equal(r.provider, 'zippopotam');
    assert.deepEqual([r.locations[0].city, r.locations[0].state, r.locations[0].postalCode], ['Downtown Toronto', 'Ontario', 'M5V 3L9']);
    assert.ok(calls[0].url.endsWith('/ca/M5V'));
});

test('Saudi short address: key from Integrations, address fields mapped', async () => {
    const calls = fake({
        '/rest/v1/integrations': () => [200, [{ adapter: 'saudi_address', secret: { api_key: 'k1' }, config: {} }]],
        'NationalAddressByShortAddress': () => [200, { Addresses: [{ BuildingNumber: '2919', Street: 'King Fahd Rd', District: 'Al Olaya', City: 'Riyadh', RegionName: 'Riyadh Region', PostCode: '12214', AdditionalNumber: '7788', Latitude: '24.7', Longitude: '46.6' }] }]
    });
    const r = await lookupPostal('raaa2919', 'SA');
    const a = r.locations[0];
    assert.deepEqual([a.building, a.street, a.postOffice, a.city, a.postalCode, a.additionalNumber, a.shortAddress], ['2919', 'King Fahd Rd', 'Al Olaya', 'Riyadh', '12214', '7788', 'RAAA2919']);
    const sa = calls.find(c => c.url.includes('NationalAddressByShortAddress'));
    assert.match(sa.url, /shortaddress=RAAA2919/);
    assert.equal(sa.headers['Ocp-Apim-Subscription-Key'], 'k1');
});

test('Saudi without a key: no result, error says to add the key', async () => {
    delete process.env.SAUDI_ADDRESS_API_KEY; delete process.env.ZIPCODEBASE_API_KEY;
    fake({ '/rest/v1/integrations': () => [200, []] });
    const r = await lookupPostal('RAAA2919', 'SA');
    assert.equal(r.locations.length, 0);
    assert.match(r.errors.join(' '), /Saudi National Address.*Missing api_key/);
});

test('404 from a provider is "no match", falls through quietly', async () => {
    fake({ 'zippopotam.us': () => [404, {}], '/rest/v1/integrations': () => [200, []] });
    const r = await lookupPostal('99999', 'US');
    assert.equal(r.locations.length, 0);
    assert.ok(!r.errors.some(e => /Zippopotam/.test(e)));
});

test('route: needs sign-in and a sensible code', async () => {
    const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
    fake({ '/auth/v1/user': () => [401, {}] });
    let r = res();
    await postalRoute({ method: 'GET', query: { code: '10001', countryCode: 'US' }, headers: {} }, r);
    assert.equal(r.code, 401);
    fake({ '/auth/v1/user': () => [200, { id: 'u1' }], '/rest/v1/employees': () => [200, [{ role: 'staff' }]] });
    r = res();
    await postalRoute({ method: 'GET', query: { code: 'x' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 400);
});
