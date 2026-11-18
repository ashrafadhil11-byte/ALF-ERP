// Runs the same clicks and typing on the old page and on its React version, taking a screenshot after each step,
// so the two can be compared with compare.mjs. Selectors are the element ids both versions share.
//
//   node tests/visual/flows.mjs --target old --out flows-old     (mock server on :5178)
//   node tests/visual/flows.mjs --target new --out flows-new     (vite dev on :5173)
//   node tests/visual/compare.mjs --base flows-old --cur flows-new --diff flows-diff
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PAGES } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../web/package.json'));
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const target = arg('target', 'old');
const outDir = path.join(here, arg('out', `flows-${target}`));
const base = target === 'old' ? 'http://localhost:5178' : 'http://localhost:5173';
const only = arg('page', null);

// Each flow: [page name, [step name, action(page)] …]. A screenshot follows every step.
const FLOWS = {
    activity: [
        ['row-detail', async (p) => { await p.click('#rows tr[data-i="0"]'); }],
        ['failed-filter', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.check('#fFailed'); }]
    ],
    customers: [
        ['profile', async (p) => { await p.click('#rows tr[data-c]'); }],
        ['edit-then-close-asks', async (p) => { await p.fill('#fNotes', ''); await p.type('#fNotes', 'Calls after 5 pm'); await p.mouse.click(8, 400); }],
        ['keep-editing', async (p) => { await p.click('[data-confirm] [data-v="0"]'); }],
        ['merge-search', async (p) => { await p.click('#mergeBtn'); await p.waitForTimeout(200); await p.type('#mSearch', 'al'); await p.waitForTimeout(700); }],
        ['save', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.fill('#fTags', 'VIP, corporate'); await p.click('#pForm button:has-text("Save details")'); await p.waitForTimeout(800); }]
    ],
    crm: [
        ['pick-customer', async (p) => { await p.click('#list .cust'); }],
        ['booked-template', async (p) => { await p.click('[data-tpl="booked"]'); await p.type('#awb', 'AFC-849208'); }],
        ['search', async (p) => { await p.type('#q', 'zz-nobody'); await p.waitForTimeout(700); }]
    ],
    'status-update': [
        ['scan-awb', async (p) => { await p.fill('#scanInput', 'AFC-849208'); await p.press('#scanInput', 'Enter'); await p.waitForTimeout(800); }],
        ['boxes-ok', async (p) => { if (await p.locator('.ui-modal.open [aria-labelledby="pbTitle"], .ui-modal.open #pbTitle').count()) await p.click('.ui-modal.open .btn-dark'); }],
        ['milestone-with-agent', async (p) => {
            const v = await p.$eval('#statusSelect', (s) => [...s.options].find(o => /assign/i.test(o.text))?.value || [...s.options].find(o => o.value)?.value);
            await p.selectOption('#statusSelect', v);
        }],
        ['bad-awb', async (p) => { await p.fill('#scanInput', 'NOPE-0000'); await p.press('#scanInput', 'Enter'); await p.waitForTimeout(800); }],
        ['submit', async (p) => {
            if (await p.locator('.ui-modal.open .btn-dark').count()) await p.click('.ui-modal.open .btn-dark');
            for (const el of await p.$$('[data-extra]')) await el.fill((await el.getAttribute('data-extra')) === 'fwd_docket' ? '290012345' : 'SMSA');
            await p.fill('#remark', 'Handed at counter');
            await p.click('#updateBtn'); await p.waitForTimeout(300); await p.click('[data-confirm] [data-v="1"]'); await p.waitForTimeout(800);
        }]
    ],
    integrations: [
        ['edit-form', async (p) => { await p.click('#list button:has-text("Edit")'); }],
        ['add-form', async (p) => { await p.click('#formModal button:has-text("Cancel")'); await p.waitForTimeout(300); await p.click('#addBtn'); }],
        ['save-new', async (p) => { await p.fill('#fName', 'Test Carrier'); await p.fill('#fUrl', 'https://api.example.com'); await p.check('#fActive'); await p.click('#saveBtn'); await p.waitForTimeout(800); }]
    ]
};

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
    localStorage.setItem('cargo_auth_token', 'h.eyJzdWIiOiJ1MSJ9.s');
    localStorage.setItem('cargo_user_role', 'super_admin');
    localStorage.setItem('cargo_user_name', 'Test User');
});
let fails = 0;
for (const [name, steps] of Object.entries(FLOWS)) {
    if (only && name !== only) continue;
    const pg = PAGES.find(x => x.name === name);
    const url = base + (target === 'old' ? pg.old : pg.new);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const writes = [];   // what the page sends to the server (compared old vs new)
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.method() !== 'GET') { let body; try { body = r.postDataJSON(); } catch { body = r.postData(); } writes.push({ method: r.method(), path: u.pathname + u.search, body }); } });
    await page.clock.setFixedTime(new Date('2026-11-17T07:30:00Z'));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { document.getElementById('checkinPop')?.querySelector('[data-snooze]')?.click(); });
    for (const [step, act] of steps) {
        try {
            await act(page);
            await page.waitForTimeout(900);
            await page.screenshot({ path: path.join(outDir, `${name}.${step}.png`), animations: 'disabled', caret: 'hide' });
            console.log(`${name} · ${step}: ok`);
        } catch (e) { fails++; console.log(`${name} · ${step}: FAILED ${e.message.split('\n')[0]}`); }
    }
    if (errors.length) { fails++; console.log(`${name}: page errors: ${errors.join(' / ')}`); }
    fs.writeFileSync(path.join(outDir, `${name}.requests.json`), JSON.stringify(writes, null, 2));
    await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
