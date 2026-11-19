// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import assistant from '../api/_routes/assistant.js';
import { runTool } from '../api/_lib/assistant.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali' };

function fake(employee, routes = {}) {
    const calls = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = decodeURIComponent(String(u));
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
        calls.push({ url, method: opts.method || 'GET', body });
        const json = (b, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.includes('/auth/v1/user')) return json({ id: employee.id, email: 'a@b.c' });
        if (url.includes(`/rest/v1/employees?id=eq.${employee.id}&select`)) return json([employee]);
        for (const [part, fn] of Object.entries(routes)) if (url.includes(part)) return json(fn(url, opts, body));
        return json([]);
    };
    return calls;
}

test('assistant: without an AI key it says how to switch it on', async () => {
    fake(STAFF);
    let r = res(); await assistant({ method: 'GET', query: {}, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.body.ready, false);
    r = res(); await assistant({ method: 'POST', query: {}, body: { question: 'how many?' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 503);
    assert.match(r.body.error, /Integrations/);
});

test('assistant tools: staff only see their branch; head office may pick one', async () => {
    let calls = fake(STAFF);
    await runTool('find_shipments', { branch: 'ALFSLL', text: 'Ali' }, { role: 'staff', branch: 'ALFSNY' });
    assert.ok(calls.at(-1).url.includes('branch_code=eq.ALFSNY') && !calls.at(-1).url.includes('ALFSLL'));
    calls = fake(STAFF, { 'bookings?awb=eq.311000001': (u) => u.includes('branch_code=eq.ALFSNY') ? [] : [{ id: 'b', awb: '311000001' }] });
    const out = await runTool('shipment_details', { awb: '311000001' }, { role: 'staff', branch: 'ALFSNY' });
    assert.match(out.error, /not found in your branch/);
    calls = fake(STAFF);
    await runTool('count_shipments', { group_by: 'status', branch: 'ALFSLL' }, { role: 'head_office', branch: null });
    assert.ok(calls.at(-1).url.includes('branch_code=eq.ALFSLL'));
    const s = await runTool('daily_summary', {}, { role: 'staff', branch: 'ALFSNY' });
    assert.match(s.error, /managers/);
});

test('assistant: a Claude tool round — reads data, then answers', async () => {
    let round = 0;
    const calls = fake(STAFF, {
        'integrations?kind=eq.ai': () => [{ id: 1, name: 'Claude', adapter: 'claude', config: { model: 'm' }, secret: { api_key: 'k' } }],
        'api.anthropic.com/v1/messages': (u, o, b) => {
            round++;
            if (round === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'count_shipments', input: { group_by: 'status' } }] };
            assert.equal(b.messages.at(-1).content[0].type, 'tool_result');
            return { content: [{ type: 'text', text: '2 shipments are in customs.' }] };
        },
        'rest/v1/bookings?': () => [{ current_status: 'Awaiting Import Customs' }, { current_status: 'Awaiting Import Customs' }]
    });
    const r = res(); await assistant({ method: 'POST', query: {}, body: { question: 'How many in customs?' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.answer, '2 shipments are in customs.');
    assert.deepEqual(r.body.tools, ['count_shipments']);
    const first = calls.find(c => c.url.includes('anthropic')).body;
    assert.ok(first.tools.length >= 5 && first.system.includes('branch ALFSNY'));
});
