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
    delivery: [
        ['select-two', async (p) => { const boxes = p.locator('#readyRows [data-sel]'); await boxes.nth(0).check(); if (await boxes.count() > 1) await boxes.nth(1).check(); }],
        ['search', async (p) => { await p.type('#pickInput', 'sal'); }],
        ['dispatch-form', async (p) => { await p.fill('#pickInput', ''); await p.dispatchEvent('#pickInput', 'input'); await p.click('#selSend'); }],
        ['dispatch-agent', async (p) => { await p.click('[data-mode="agent"]'); await p.click('#dAgent'); await p.type('#dAgent', 'aram'); }],
        ['dispatch-agent-picked', async (p) => { await p.keyboard.press('Enter'); await p.fill('#dRef', 'AX-77'); }],
        ['dispatched', async (p) => { await p.click('#dispatchBtn'); }],
        ['out-tab', async (p) => { await p.click('[data-tab="out"]'); }],
        ['pod', async (p) => { await p.click('#outCards [data-outcome="delivered"]'); }],
        ['pod-signed', async (p) => {
            const b = await p.locator('#sigPad').boundingBox();
            await p.mouse.move(b.x + 30, b.y + 60); await p.mouse.down(); await p.mouse.move(b.x + 120, b.y + 30, { steps: 8 }); await p.mouse.move(b.x + 220, b.y + 90, { steps: 8 }); await p.mouse.up();
            await p.fill('#pIdNo', '998877');
        }],
        ['pod-saved', async (p) => { await p.click('#podBtn'); await p.waitForTimeout(800); }],
        ['failed-form', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); const f = p.locator('#outCards [data-outcome="failed"]'); if (await f.count()) await f.first().click(); }],
        ['done-tab', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.click('[data-tab="done"]'); }],
        ['collected', async (p) => { await p.click('[data-tab="ready"]'); await p.waitForTimeout(300); const c = p.locator('[data-collect]'); if (await c.count()) await c.first().click(); }]
    ],
    'create-user': [
        ['filter-all-staff', async (p) => { await p.selectOption('#activeFilter', ''); await p.selectOption('#roleFilter', 'staff'); }],
        ['search', async (p) => { await p.selectOption('#roleFilter', ''); await p.fill('#search', 'sara'); }],
        ['row-menu', async (p) => { await p.fill('#search', ''); await p.waitForTimeout(200); await p.click('#rows tr:nth-child(2) button[aria-label^="Actions"]'); }],
        ['edit', async (p) => { await p.click('.row-menu button:has-text("Edit user")'); }],
        ['edit-warehouse-on', async (p) => { await p.fill('#e_contact', '91112233'); await p.check('#e_wh'); await p.click('#e_off [data-dow="6"]'); await p.fill('#e_brStart', '13:00'); await p.fill('#e_brEnd', '14:00'); }],
        ['edit-role-change-asks', async (p) => { await p.selectOption('#e_role', 'head_office'); await p.click('#editForm button.btn-dark'); }],
        ['edit-saved', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['create-form', async (p) => { await p.click('button:has-text("Add User")'); await p.waitForTimeout(300); await p.selectOption('#c_role', 'branch_manager'); }],
        ['create-fill', async (p) => { await p.fill('#c_fullName', 'Noor Al Harthy'); await p.fill('#c_contact', '91234567'); await p.fill('#c_email', 'noor@example.com'); await p.fill('#c_username', 'nalharthy'); await p.fill('#c_password', 'Temp-pass-123'); await p.selectOption('#c_branch', { index: 1 }); }],
        ['create-confirm', async (p) => { await p.click('#createBtn'); }],
        ['create-done', async (p) => { await p.click('[data-confirm] [data-v="1"]'); await p.waitForTimeout(1200); }],
        ['deactivate-asks', async (p) => { await p.click('#rows tr:nth-child(2) button[aria-label^="Actions"]'); await p.waitForTimeout(200); await p.click('.row-menu button.danger'); }]
    ],
    warehouse: [
        ['pin-mismatch', async (p) => { await p.fill('#gPin', '1234'); await p.fill('#gPin2', '1235'); await p.click('#gBtn'); }],
        ['set-pin', async (p) => { await p.fill('#gPin', '1234'); await p.fill('#gPin2', '1234'); await p.click('#gBtn'); }],
        ['send-form', async (p) => { await p.click('[data-send]'); }],
        ['send-edit-close-asks', async (p) => { await p.fill('#sLines [data-q]', '3'); await p.mouse.click(8, 400); }],
        ['send-go', async (p) => { await p.click('[data-confirm] [data-v="0"]'); await p.waitForTimeout(300); await p.click('#sGo'); }],
        ['stock', async (p) => { await p.click('[data-tab="stock"]'); }],
        ['price-save', async (p) => { await p.fill('[data-item="1"] [data-price]', '0.800'); await p.click('[data-item="1"] [data-save]'); }],
        ['new-item', async (p) => { await p.click('#newItem'); await p.waitForTimeout(300); await p.fill('#iSku', 'TAPE-B'); await p.fill('#iName', 'Brown tape'); await p.fill('#iPrice', '0.4'); await p.click('#itemForm button.btn-coral'); }],
        ['purchases', async (p) => { await p.click('[data-tab="purchases"]'); }],
        ['buy-form', async (p) => { await p.click('#newBuy'); await p.waitForTimeout(300); await p.click('#bAdd'); await p.fill('#bLines [data-bl]:nth-child(1) [data-qty]', '10'); await p.fill('#bLines [data-bl]:nth-child(1) [data-cost]', '0.5'); await p.fill('#bRef', 'MP-9'); }],
        ['buy-save', async (p) => { await p.click('#buyForm button.btn-coral'); }],
        ['change-pin', async (p) => { await p.click('#changePinBtn'); }],
        ['change-cancel', async (p) => { await p.click('#gCancel'); }],
        ['lock', async (p) => { await p.click('#lockBtn'); }]
    ],
    attendance: [
        ['month-back', async (p) => { await p.click('#mPrev'); }],
        ['leave-form', async (p) => { await p.click('#askLeave'); await p.waitForTimeout(300); await p.fill('#lFrom', '2026-11-20'); await p.dispatchEvent('#lFrom', 'change'); await p.fill('#lReason', 'Family visit'); }],
        ['leave-send', async (p) => { await p.click('#leaveForm button.btn-coral'); }],
        ['today', async (p) => { await p.click('[data-tab="today"]'); }],
        ['correct', async (p) => { await p.click('[data-fix="day:0"]'); await p.waitForTimeout(300); await p.fill('#fxReason', 'Phone battery died'); }],
        ['correct-save', async (p) => { await p.click('#fixForm button.btn-coral'); }],
        ['report', async (p) => { await p.click('[data-tab="report"]'); }],
        ['leave-tab', async (p) => { await p.click('[data-tab="leave"]'); }],
        ['approve', async (p) => { const b = p.locator('[data-decide^="approved"]').first(); if (await b.count()) await b.click(); }],
        ['shifts', async (p) => { await p.click('[data-tab="shifts"]'); }],
        ['shift-edit', async (p) => { await p.click('[data-shift="0"]'); await p.waitForTimeout(300); await p.click('#shOff [data-dow="6"]'); }],
        ['shift-save', async (p) => { await p.click('#shiftForm button.btn-coral'); }],
        ['back-to-me-break', async (p) => { await p.click('[data-tab="me"]'); await p.waitForTimeout(800); const b = p.locator('#breakBtn'); if (await b.count()) await b.click(); }]
    ],
    'super-dashboard': [
        ['scrolled-middle', async (p) => { await p.evaluate(() => { document.querySelector('.dash-scroll').scrollTop = 600; }); }],
        ['scrolled-bottom', async (p) => { await p.evaluate(() => { const s = document.querySelector('.dash-scroll'); s.scrollTop = s.scrollHeight; }); }],
        ['customize', async (p) => { await p.evaluate(() => { document.querySelector('.dash-scroll').scrollTop = 0; }); await p.click('#editLayoutBtn'); }],
        ['resize-pill', async (p) => { await p.click('[data-widget-id="global-shipments"] button:has-text("2×3")'); }],
        ['catalog', async (p) => { await p.click('#editLayoutBtn'); await p.click('button[title="Add or remove widgets"]'); }],
        ['catalog-remove', async (p) => { await p.click('#widget-catalog-list > div:nth-child(2) button'); }],
        ['search-bookings', async (p) => { await p.click('#widget-modal button:has-text("Done")'); await p.evaluate(() => { const s = document.querySelector('.dash-scroll'); s.scrollTop = s.scrollHeight; }); await p.type('input[placeholder^="Search AWB, consignee"]', 'afc'); }]
    ],
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
