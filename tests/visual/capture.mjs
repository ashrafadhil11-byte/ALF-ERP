// Screenshots every page and every popup at desktop and phone size, and runs the layout check on each.
//
//   node tests/visual/capture.mjs --out baseline                 old pages  (mock server on :5178)
//   node tests/visual/capture.mjs --out current --target new      React pages (vite dev on :5173)
//   add --frame to compare only the frame (sidebar, top bar, bottom bar): page content and popups are left out;
//   with --target new the React frame preview (/app/?as=<page>) stands in for every page.
//
// Uses the Edge or Chrome already installed (no browser download). Sample data from tests/mock/server.mjs only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PAGES, SIZES } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../web/package.json'));
const { chromium } = require('playwright-core');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const target = arg('target', 'old');
const outDir = path.join(here, arg('out', target === 'old' ? 'baseline' : 'current'));
const base = arg('base', target === 'old' ? 'http://localhost:5178' : 'http://localhost:5173');
const only = arg('page', null);
const frameOnly = process.argv.includes('--frame');
const audit = fs.readFileSync(path.join(here, 'layout-audit.js'), 'utf8').replace(/^\/\/.*$/gm, '').trim();

// Same fixed moment for every capture, so clocks, "today" and greetings match between old and new.
const FIXED_TIME = new Date('2026-11-17T07:30:00Z');   // 11:30 in Muscat
const TOKEN = 'h.eyJzdWIiOiJ1MSJ9.s';                   // mock-server sample session (not a real credential)

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!exe) { console.error('No Edge or Chrome found.'); process.exit(1); }

const pages = PAGES.filter(p => (frameOnly || (target === 'old' ? p.old : p.new)) && (!only || p.name === only));
const urlOf = (pg) => target === 'old' ? pg.old : frameOnly ? `/app/?as=${pg.name}.html` : pg.new;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const report = {};
let shots = 0;

for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await ctx.addInitScript(([t]) => {
        localStorage.setItem('cargo_auth_token', t);
        localStorage.setItem('cargo_user_role', 'super_admin');
        localStorage.setItem('cargo_user_name', 'Test User');
    }, [TOKEN]);
    for (const pg of pages) {
        const page = await ctx.newPage();
        await page.clock.setFixedTime(FIXED_TIME);
        const url = base + urlOf(pg);
        const key = `${pg.name}.${size.name}`;
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(1200);
            // close anything that opened by itself (e.g. the check-in reminder) so the page is visible
            await page.evaluate(() => document.querySelectorAll('.ui-modal.open').forEach(m => m.classList.remove('open')));
            if (frameOnly) await page.addStyleTag({ content: 'main > :not(#topbar-container) { display: none !important; }' });
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(outDir, `${key}.png`), animations: 'disabled', caret: 'hide' });
            shots++;
            // every popup on the page, one at a time
            const ids = frameOnly ? [] : await page.$$eval('.ui-modal[id]', ms => ms.map(m => m.id));
            for (const id of ids) {
                await page.evaluate((i) => document.getElementById(i).classList.add('open'), id);
                await page.waitForTimeout(500);
                await page.screenshot({ path: path.join(outDir, `${key}.popup-${id}.png`), animations: 'disabled', caret: 'hide' });
                await page.evaluate((i) => document.getElementById(i).classList.remove('open'), id);
                await page.waitForTimeout(300);
                shots++;
            }
            // frame: the interactive states too (one page is enough — the frame is the same everywhere)
            if (frameOnly && pg.name === 'activity') {
                const shot = async (name, act, undo) => {
                    await act(); await page.waitForTimeout(700);
                    await page.screenshot({ path: path.join(outDir, `${key}.state-${name}.png`), animations: 'disabled', caret: 'hide' });
                    shots++;
                    await undo(); await page.waitForTimeout(700);
                };
                const esc = () => page.keyboard.press('Escape');
                await shot('notifications', () => page.click('#notifBtn'), esc);
                await shot('profile', () => page.click('button:has(#topbarProfileAvatar)'), () => page.click('#profileDrawerPanel button:has(svg path[d^="M6 18L18 6"])'));
                if (size.name === 'desktop') await shot('search', () => page.keyboard.press('Control+k'), esc);
                else await shot('menu', () => page.click('button[aria-label="Open menu"]'), () => page.click('#sidebar-container', { position: { x: 360, y: 400 } }));
            }
            report[key] = await page.evaluate(`(${audit})()`);
        } catch (e) {
            report[key] = ['ERROR ' + e.message.split('\n')[0]];
        }
        await page.close();
        process.stdout.write(`${key}: ${report[key].join(' | ')}\n`);
    }
    await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, 'layout-report.json'), JSON.stringify(report, null, 2));
const problems = Object.entries(report).filter(([, v]) => v[0] !== 'OK');
console.log(`\n${shots} screenshots in ${path.relative(process.cwd(), outDir) || outDir}; layout check: ${problems.length ? problems.length + ' with problems' : 'all OK'}`);
process.exit(problems.length ? 1 : 0);
