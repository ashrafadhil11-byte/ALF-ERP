// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OMAN, searchOman } from '../api/_lib/oman-places.js';
import { providersFor, lookupPostal } from '../api/_lib/postal.js';
import { browserSource, BROWSER_FILE } from '../scripts/build-oman-places.mjs';

test('Oman data: 11 governorates, every wilayat listed, codes are 3 digits', () => {
    assert.equal(OMAN.length, 11);
    const wilayats = OMAN.flatMap(g => g.wilayats);
    assert.ok(wilayats.length >= 61, `${wilayats.length} wilayats`);
    for (const w of wilayats) {
        assert.ok(w.towns.length, `${w.name} has towns`);
        for (const t of w.towns) for (const c of [t.code, ...(t.alt || [])].filter(Boolean)) assert.match(c, /^\d{3}$/, `${t.name} ${c}`);
    }
});

test('Oman provider: postal code → places', async () => {
    assert.deepEqual(providersFor('211', 'OM')[0], 'oman_local');
    const r = await lookupPostal('211', 'OM');
    assert.equal(r.provider, 'oman_local');
    const p = r.locations[0];
    assert.deepEqual([p.postOffice, p.wilayat, p.state, p.postalCode, p.countryCode], ['Salalah', 'Salalah', 'Dhofar', '211', 'OM']);
    const ruwi = (await lookupPostal('112', 'om')).locations[0];
    assert.deepEqual([ruwi.postOffice, ruwi.wilayat, ruwi.state], ['Ruwi', 'Muttrah', 'Muscat']);
    // an alternative code finds the town and reports the code that was asked for
    assert.deepEqual(searchOman('600').map(p => [p.postOffice, p.postalCode]), [['Bidbid', '600']]);
});

test('Oman provider: place name → code', async () => {
    const r = await lookupPostal('sohar', 'OM');
    assert.equal(r.locations[0].postalCode, '311');
    assert.equal(r.locations[0].state, 'Al Batinah North');
    assert.equal(searchOman('Nizwa')[0].postalCode, '611');
    assert.equal(searchOman('SUR')[0].postalCode, '411');
});

test('Oman provider: unknown code → empty, no network call', async () => {
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; return { ok: false, status: 404, json: async () => ({}), text: async () => '' }; };
    delete process.env.ZIPCODEBASE_API_KEY;
    assert.deepEqual(searchOman('999'), []);
    assert.deepEqual(searchOman('zzzz'), []);
    assert.equal(fetched, false);
});

test('browser copy admin/components/oman-places.js is in sync (run node scripts/build-oman-places.mjs)', () => {
    const src = readFileSync(BROWSER_FILE, 'utf8');
    assert.equal(src.replace(/\r\n/g, '\n'), browserSource());
    const ctx = { window: {} };
    vm.runInNewContext(src, ctx);
    assert.equal(ctx.window.ALF_OMAN.length, 11);
    assert.equal(ctx.window.ALF_OMAN_SEARCH('ruwi')[0].postalCode, '112');
});
