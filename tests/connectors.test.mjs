// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import { callApi, connectorCatalog, testConnector } from '../api/_lib/integrations/http.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';

function fakeHttp(handler) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = String(u);
        calls.push({ url, opts });
        const { status = 200, body = {} } = handler(url, opts) || {};
        return { ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
    };
    return calls;
}
const row = (extra = {}) => ({ adapter: 'alfarhaonline', active: true, secret: { api_key: 'K' }, config: {}, ...extra });
const OK = { response: 'success', data: [{ o_unique_id: '1' }], total_box: 1, total_weight: 2 };

test('catalog lists every connector with its secret fields (no values)', () => {
    const ids = connectorCatalog().map(c => c.id);
    for (const id of ['alfarhaonline', 'smsa', 'dhl', '17track', 'aramex', 'generic_rest']) assert.ok(ids.includes(id), id);
    assert.deepEqual(connectorCatalog().find(c => c.id === 'aramex').secretFields, ['username', 'password', 'account_pin']);
});

test('alfarhaonline: POST with key header + order_no query; falls back on 5xx', async () => {
    const calls = fakeHttp(url => (url.startsWith('https://api-direct') ? { status: 502, body: 'bad gateway' } : { body: OK }));
    const d = await callApi('alfarhaonline', 'getOrder', { orderNo: "'412 0431" }, row());
    assert.equal(d.total_weight, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].opts.method, 'POST');
    assert.equal(calls[1].opts.headers['X-API-KEY'], 'K');
    assert.match(calls[1].url, /alfarhaonline\.com\/api\/order-details\?order_no=412\+0431|order_no=412%200431/);
});

test('401 error message comes through and does not try the fallback', async () => {
    const calls = fakeHttp(() => ({ status: 401, body: { status: 401, response: 'error', message: 'Unauthorized: Invalid or missing security token' } }));
    await assert.rejects(callApi('alfarhaonline', 'getOrder', { orderNo: '1' }, row()), /Unauthorized/);
    assert.equal(calls.length, 1);
});

test('missing key → clear message; env var is used when Integrations has none', async () => {
    fakeHttp(() => ({ body: OK }));
    await assert.rejects(callApi('alfarhaonline', 'getOrder', { orderNo: '1' }, row({ secret: {} })), /Missing api_key/);
    process.env.ALFARHA_ORDER_API_KEY = 'ENVKEY';
    const calls = fakeHttp(() => ({ body: OK }));
    await callApi('alfarhaonline', 'getOrder', { orderNo: '1' }, row({ secret: {} }));
    assert.equal(calls[0].opts.headers['X-API-KEY'], 'ENVKEY');
    delete process.env.ALFARHA_ORDER_API_KEY;
});

test('aramex sends escaped SOAP XML as text', async () => {
    const calls = fakeHttp(() => ({ body: '<r><TrackingResult/></r>' }));
    const r = row({ adapter: 'aramex', secret: { username: 'u', password: 'p<&', account_pin: '1' }, config: { account_number: '9' } });
    const res = await testConnector(r, { value: 'AWB1' });
    assert.equal(res.ok, true);
    assert.equal(typeof calls[0].opts.body, 'string');
    assert.match(calls[0].opts.body, /<v1:Password>p&lt;&amp;<\/v1:Password>/);
    assert.equal(calls[0].opts.headers['Content-Type'], 'text/xml; charset=utf-8');
});

test('test button needs an input value when the connector asks for one', async () => {
    await assert.rejects(testConnector(row({ adapter: 'dhl', secret: { api_key: 'k' } }), {}), /Enter a AWB/);
});
