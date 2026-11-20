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

test('assistant: OpenAI-compatible uses the saved base URL; a provider 401 never signs the user out', async () => {
    const row = { id: 2, name: 'Gemini', adapter: 'openai_compat', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', config: { model: 'g' }, secret: { api_key: 'k' } };
    let calls = fake(STAFF, {
        'integrations?kind=eq.ai': () => [row],
        'generativelanguage.googleapis.com/v1beta/openai/chat/completions': () => ({ choices: [{ message: { role: 'assistant', content: 'Hello.' } }] })
    });
    let r = res(); await assistant({ method: 'POST', query: {}, body: { question: 'hi' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.answer, 'Hello.');
    assert.ok(!calls.some(c => c.url.includes('api.openai.com')));

    // Google sends errors as [{ error: { message } }]; a 401 from the AI must come back as 502, not 401
    fake(STAFF, { 'integrations?kind=eq.ai': () => [row] });
    const real = globalThis.fetch;
    globalThis.fetch = async (u, o) => String(u).includes('generativelanguage')
        ? { ok: false, status: 401, text: async () => JSON.stringify([{ error: { code: 401, message: 'API key not valid.' } }]) }
        : real(u, o);
    r = res(); await assistant({ method: 'POST', query: {}, body: { question: 'hi' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.code, 502);
    assert.match(r.body.error, /API key not valid/);
});

test('assistant: optional tool fields allow null (Groq checks strictly); null arguments are "not given"', async () => {
    let body;
    fake(STAFF, {
        'integrations?kind=eq.ai': () => [{ id: 3, name: 'Groq', adapter: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', config: { model: 'm' }, secret: { api_key: 'k' } }],
        'api.groq.com/openai/v1/chat/completions': (u, o, b) => { body = body || b; return b.messages.at(-1).role === 'tool'
            ? { choices: [{ message: { role: 'assistant', content: 'Done.' } }] }
            : { choices: [{ message: { role: 'assistant', reasoning: 'r', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'count_shipments', arguments: '{"group_by":"status","branch":null,"status":null}' } }] } }] }; }
    });
    const r = res(); await assistant({ method: 'POST', query: {}, body: { question: 'count' }, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.body.answer, 'Done.');
    const count = body.tools.find(t => t.function.name === 'count_shipments').function.parameters;
    assert.deepEqual(count.properties.branch.type, ['string', 'null']);
    assert.equal(count.properties.group_by.type, 'string');   // required stays strict
    assert.ok(!JSON.stringify(body.tools).includes('maximum'));
});
