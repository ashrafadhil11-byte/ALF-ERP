// Regenerates admin/components/oman-places.js (browser copy) from api/_lib/oman-places.js.
// Run: node scripts/build-oman-places.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OMAN, searchOmanIn } from '../api/_lib/oman-places.js';

export const BROWSER_FILE = fileURLToPath(new URL('../admin/components/oman-places.js', import.meta.url));

export function browserSource() {
    // Keep the source list from the top of the shared module.
    const src = readFileSync(fileURLToPath(new URL('../api/_lib/oman-places.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    const header = src.slice(0, src.indexOf('const t =')).trim()
        .replace(/^\/\/ File: .*$/m, '// File: admin/components/oman-places.js — GENERATED from api/_lib/oman-places.js. Do not edit by hand;')
        .replace(/^\/\/ SINGLE SOURCE OF TRUTH\..*$/m, '// edit the shared module and run the script below.');
    return `${header}

// window.ALF_OMAN = [{ name: governorate, wilayats: [{ name: wilayat, towns: [{ name, code, alt? }] }] }]
window.ALF_OMAN = ${JSON.stringify(OMAN, null, 0).replace(/\{"name":"[^"]*","wilayats"/g, (m) => '\n    ' + m)};
// window.ALF_OMAN_SEARCH('211' | 'ruwi') → [{ postOffice, city, wilayat, state, postalCode, countryCode }]
window.ALF_OMAN_SEARCH = (q) => (${searchOmanIn.toString()})(window.ALF_OMAN, q);
`.replace(/\r\n/g, '\n'); // same output whatever line endings the checkout has
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    writeFileSync(BROWSER_FILE, browserSource());
    console.log('Wrote', BROWSER_FILE);
}
