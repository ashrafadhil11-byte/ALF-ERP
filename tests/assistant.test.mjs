// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import assistant from '../api/_routes/assistant.js';
import { runTool, ask } from '../api/_lib/assistant.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
const res = () => ({ code: 200, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const STAFF = { id: 'u1', role: 'staff', branch: 'ALFSNY', full_name: 'Ali Hassan' };
const SESSION = { user: { id: 'u1' }, role: 'staff', branch: 'ALFSNY', employee: STAFF };

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

test('assistant: without an AI key — not ready, and ask() says how to switch it on', async () => {
    fake(STAFF);
    const r = res(); await assistant({ method: 'GET', query: {}, headers: { authorization: 'Bearer t' } }, r);
    assert.equal(r.body.ready, false);
    assert.equal(r.body.name, 'Farah');
    await assert.rejects(ask('how many?', [], SESSION, 'Bearer t'), (e) => e.setup && /Integrations/.test(e.message));
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
    // a typographic dash (as the AI sometimes writes it) still finds the shipment
    calls = fake(STAFF, { 'bookings?awb=eq.AFC-123456': () => [{ id: 'b', awb: 'AFC-123456' }] });
    const d = await runTool('shipment_details', { awb: 'AFC‑123456' }, { role: 'head_office', branch: null });
    assert.equal(d.shipment?.awb || d.awb || d.booking?.awb, 'AFC-123456');
});

test('assistant: a Claude tool round — reads data, then answers as Farah', async () => {
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
    const out = await ask('How many in customs?', [], SESSION, 'Bearer t', { firstToday: true });
    assert.equal(out.answer, '2 shipments are in customs.');
    assert.deepEqual(out.tools, ['count_shipments']);
    const first = calls.find(c => c.url.includes('anthropic')).body;
    assert.ok(first.tools.length >= 5);
    assert.ok(first.system.includes('You are Farah') && first.system.includes('branch ALFSNY') && first.system.includes('call the user Ali') && first.system.includes('first message to you today'));
});

test('assistant: OpenAI-compatible uses the saved base URL; provider errors keep their message', async () => {
    const row = { id: 2, name: 'Gemini', adapter: 'openai_compat', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', config: { model: 'g' }, secret: { api_key: 'k' } };
    const calls = fake(STAFF, {
        'integrations?kind=eq.ai': () => [row],
        'generativelanguage.googleapis.com/v1beta/openai/chat/completions': () => ({ choices: [{ message: { role: 'assistant', content: 'Hello.' } }] })
    });
    const out = await ask('hi', [], SESSION, 'Bearer t');
    assert.equal(out.answer, 'Hello.');
    assert.ok(!calls.some(c => c.url.includes('api.openai.com')));
    // Google sends errors as [{ error: { message } }]
    fake(STAFF, { 'integrations?kind=eq.ai': () => [row] });
    const real = globalThis.fetch;
    globalThis.fetch = async (u, o) => String(u).includes('generativelanguage')
        ? { ok: false, status: 401, text: async () => JSON.stringify([{ error: { code: 401, message: 'API key not valid.' } }]) }
        : real(u, o);
    await assert.rejects(ask('hi', [], SESSION, 'Bearer t'), /API key not valid/);
});

test('assistant: optional tool fields allow null (Groq checks strictly); null arguments are "not given"', async () => {
    let body;
    fake(STAFF, {
        'integrations?kind=eq.ai': () => [{ id: 3, name: 'Groq', adapter: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', config: { model: 'm' }, secret: { api_key: 'k' } }],
        'api.groq.com/openai/v1/chat/completions': (u, o, b) => { body = body || b; return b.messages.at(-1).role === 'tool'
            ? { choices: [{ message: { role: 'assistant', content: 'Done.' } }] }
            : { choices: [{ message: { role: 'assistant', reasoning: 'r', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'count_shipments', arguments: '{"group_by":"status","branch":null,"status":null}' } }] } }] }; }
    });
    const out = await ask('count', [], SESSION, 'Bearer t');
    assert.equal(out.answer, 'Done.');
    const count = body.tools.find(t => t.function.name === 'count_shipments').function.parameters;
    assert.deepEqual(count.properties.branch.type, ['string', 'null']);
    assert.equal(count.properties.group_by.type, 'string');   // required stays strict
    assert.ok(!JSON.stringify(body.tools).includes('maximum'));
});
