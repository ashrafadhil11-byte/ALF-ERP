// Compares tests/visual/current/*.png with tests/visual/baseline/*.png and writes red-highlight diffs to tests/visual/diff/.
//   node tests/visual/compare.mjs [--max 0.5] [--base baseline --cur current --diff diff]      max = % of pixels allowed to differ per screenshot (default 0.5)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../web/package.json'));
const { PNG } = require('pngjs');
const pixelmatch = (await import(pathToFileURL(require.resolve('pixelmatch')).href)).default;

const i = process.argv.indexOf('--max');
const MAX = i > 0 ? Number(process.argv[i + 1]) : 0.5;
const opt = (k, d) => { const j = process.argv.indexOf('--' + k); return j > 0 ? process.argv[j + 1] : d; };
const dirs = { base: path.join(here, opt('base', 'baseline')), cur: path.join(here, opt('cur', 'current')), diff: path.join(here, opt('diff', 'diff')) };
fs.mkdirSync(dirs.diff, { recursive: true });

const files = fs.existsSync(dirs.cur) ? fs.readdirSync(dirs.cur).filter(f => f.endsWith('.png')) : [];
if (!files.length) { console.error('Nothing in tests/visual/current — run capture.mjs --target new first.'); process.exit(1); }
let failed = 0;
for (const f of files.sort()) {
    const bp = path.join(dirs.base, f);
    if (!fs.existsSync(bp)) { console.log(`NEW      ${f} (no baseline)`); failed++; continue; }
    const a = PNG.sync.read(fs.readFileSync(bp)), b = PNG.sync.read(fs.readFileSync(path.join(dirs.cur, f)));
    if (a.width !== b.width || a.height !== b.height) { console.log(`SIZE     ${f} ${a.width}x${a.height} vs ${b.width}x${b.height}`); failed++; continue; }
    const out = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
    const pct = (100 * n) / (a.width * a.height);
    const ok = pct <= MAX;
    if (!ok) { fs.writeFileSync(path.join(dirs.diff, f), PNG.sync.write(out)); failed++; }
    console.log(`${ok ? 'SAME    ' : 'DIFFERS '} ${f} ${pct.toFixed(2)}%`);
}
console.log(`\n${files.length - failed}/${files.length} match (allowed difference ${MAX}% of pixels).`);
process.exit(failed ? 1 : 0);
