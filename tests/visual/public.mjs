// Public pages (sign-in, customer tracking): screenshots at desktop and phone size, plus a few steps, old vs new.
//   node tests/visual/public.mjs --out pub-old              old pages (mock server on :5178)
//   node tests/visual/public.mjs --out pub-new --target new React pages (vite dev on :5173)
//   then: node tests/visual/compare.mjs --base pub-old --cur pub-new
// Each run also saves public.requests.json (what the pages send to the server).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SIZES } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../web/package.json'));
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const target = arg('target', 'old');
const outDir = path.join(here, arg('out', `pub-${target}`));
const base = target === 'old' ? 'http://localhost:5178' : 'http://localhost:5173';
const P = target === 'old' ? { login: '/login.html', track: '/track.html' } : { login: '/app/login', track: '/app/track' };

const SHOTS = [
    ['login', P.login],
    ['track-empty', P.track],
    ['track', P.track + '?awb=AFC-849190'],
    ['track-review', P.track + '?awb=AFC-849190&r=' + 'a'.repeat(32)]
];
const STEPS = [
    ['login-eye', P.login, async (p) => { await p.fill('#username', 'bad'); await p.fill('#password', 'secret1'); await p.click('#togglePassword'); }],
    ['login-error', null, async (p) => { await p.click('#submitBtn'); }],
    ['login-eye-off', null, async (p) => { await p.click('#togglePassword'); }],
    ['login-ok', null, async (p) => { await p.fill('#username', 'admin'); await p.click('#submitBtn'); await p.waitForTimeout(600); return 'nav'; }],
    ['track-type', P.track + '?r=' + 'b'.repeat(32), async (p) => { await p.fill('#awb', 'afc 849 190'); await p.click('#f button'); }],
    ['track-stars', null, async (p) => { await p.click('[data-n="4"]'); await p.fill('#comment', 'Fast and friendly'); }],
    ['track-send', null, async (p) => { await p.click('#sendReview'); }]
];

// ALF_BROWSER=chrome uses Chrome when Edge will not start headless (e.g. an Edge update waiting for a restart)
const exe = [...(process.env.ALF_BROWSER === 'chrome' ? [] : ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
let fails = 0;
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
const ready = async (page) => { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(700); };

for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, reducedMotion: 'reduce' });
    for (const [name, url] of SHOTS) {
        const page = await ctx.newPage();
        await page.clock.setFixedTime(new Date('2026-11-17T07:30:00Z'));
        try { await page.goto(base + url); await ready(page); await shot(page, `${name}.${size.name}`); console.log(`${name}.${size.name}: ok`); }
        catch (e) { fails++; console.log(`${name}.${size.name}: FAILED ${e.message.split('\n')[0]}`); }
        await page.close();
    }
    await ctx.close();
}

// steps (desktop), recording what is sent to the server
const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-11-17T07:30:00Z'));
const writes = [], stored = [];
page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.method() !== 'GET') { let body; try { body = r.postDataJSON(); } catch { body = r.postData(); } writes.push({ method: r.method(), path: u.pathname + u.search, body }); } });
page.on('dialog', d => d.dismiss());
for (const [name, url, act] of STEPS) {
    try {
        if (url) { await page.goto(base + url); await ready(page); }
        const r = await act(page);
        if (r === 'nav') {   // signed in: record where it went and what it kept, not the dashboard itself
            stored.push({ to: new URL(page.url()).pathname, token: await page.evaluate(() => localStorage.getItem('cargo_auth_token')), role: await page.evaluate(() => localStorage.getItem('cargo_user_role')), wh: await page.evaluate(() => localStorage.getItem('cargo_is_warehouse')) });
            console.log(`${name}: ok`); continue;
        }
        await page.waitForTimeout(700);
        await shot(page, `step-${name}`);
        console.log(`${name}: ok`);
    } catch (e) { fails++; console.log(`${name}: FAILED ${e.message.split('\n')[0]}`); }
}
fs.writeFileSync(path.join(outDir, 'public.requests.json'), JSON.stringify({ writes, stored }, null, 2));
await browser.close();
process.exit(fails ? 1 : 0);
