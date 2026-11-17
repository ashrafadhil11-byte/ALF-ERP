// Countries, dial codes, states and cities — same sources and rules as admin/components/ui.js.
// Country list: admin/components/countries.js (window.ALF_COUNTRIES). Oman: admin/components/oman-places.js (window.ALF_OMAN).
// Other countries' states / cities: countriesnow.space, cached for the browser session.

export type Country = { c: string; n: string; d: string };
export type Item = { value: string; label: string; sub?: string; img?: string; dial?: string; postalCode?: string; wilayat?: string; custom?: boolean };
type OmanTown = { name: string; code: string };
type OmanGov = { name: string; wilayats: { name: string; towns: OmanTown[] }[] };

declare global {
    interface Window { ALF_COUNTRIES?: Country[]; ALF_OMAN?: OmanGov[]; ALF_OMAN_SEARCH?: (q: string) => any[] }
}

export const countries = (): Country[] => window.ALF_COUNTRIES || [];
export const flagUrl = (cc: string) => `https://flagcdn.com/w40/${String(cc).toLowerCase()}.png`;
export const countryItems = (): Item[] => countries().map(c => ({ value: c.c, label: c.n, sub: `${c.c} · ${c.d}`, img: flagUrl(c.c), dial: c.d }));

const geoCache: Record<string, any> = {};
async function geo(url: string) {
    if (url in geoCache) return geoCache[url];
    try { const ss = sessionStorage.getItem('geo:' + url); if (ss) return (geoCache[url] = JSON.parse(ss)); } catch { /* ignore */ }
    const r = await fetch(url).then(x => x.json()).catch(() => null);
    const data = r && !r.error ? r.data : null;
    geoCache[url] = data;
    try { if (data) sessionStorage.setItem('geo:' + url, JSON.stringify(data)); } catch { /* ignore */ }
    return data;
}
const GEO = 'https://countriesnow.space/api/v0.1/countries';

const omanGov = (state: string) => (window.ALF_OMAN || []).find(g => g.name.toLowerCase() === String(state || '').replace(/ Governorate$/i, '').toLowerCase());

export async function statesOf(iso2: string): Promise<Item[]> {
    if (iso2 === 'OM' && window.ALF_OMAN) return window.ALF_OMAN.map(g => ({ value: g.name, label: g.name, sub: `${g.wilayats.length} wilayats` }));
    return ((await geo(`${GEO}/states/q?iso2=${encodeURIComponent(iso2)}`))?.states || [])
        .map((s: any) => ({ value: s.name, label: s.name.replace(/ (Governorate|Region|Province|District)$/i, ''), sub: s.state_code || '' }));
}

export async function citiesOf(countryName: string, state: string): Promise<Item[]> {
    if (countryName === 'Oman' && window.ALF_OMAN) {
        const g = omanGov(state);
        if (g) return g.wilayats.flatMap(w => w.towns.map(t => ({
            value: t.name, label: t.name, sub: [t.name !== w.name && w.name, t.code].filter(Boolean).join(' · '), postalCode: t.code, wilayat: w.name
        })));
    }
    return ((await geo(`${GEO}/state/cities/q?country=${encodeURIComponent(countryName)}&state=${encodeURIComponent(state)}`)) || [])
        .map((c: string) => ({ value: c, label: c }));
}

/** Every city of a country (Oman from the built-in list). */
export async function citiesOfCountry(countryName: string): Promise<Item[]> {
    if (!countryName) return [];
    if (countryName === 'Oman' && window.ALF_OMAN) {
        return window.ALF_OMAN.flatMap(g => g.wilayats.flatMap(w => w.towns.map(t => ({
            value: t.name, label: t.name, sub: [w.name !== t.name && w.name, g.name, t.code].filter(Boolean).join(' · '), postalCode: t.code
        }))));
    }
    return ((await geo(`${GEO}/cities/q?country=${encodeURIComponent(countryName)}`)) || []).map((c: string) => ({ value: c, label: c }));
}

// ---------- phone numbers ----------
/** Main country for dial codes several countries share (+1 → US, +44 → GB …). */
export const DIAL_PREF: Record<string, string> = { '+1': 'US', '+44': 'GB', '+7': 'RU', '+61': 'AU', '+39': 'IT', '+47': 'NO', '+358': 'FI', '+212': 'MA', '+262': 'RE', '+590': 'GP', '+599': 'CW', '+290': 'SH' };

/** '+91 98765 43210' / '0091…' → { cc: 'IN', dial: '+91', national: '9876543210' }; no prefix → { cc: null, national } */
export function splitPhone(full: string, prefer?: string): { cc: string | null; dial: string | null; national: string } {
    const s = String(full || '').trim().replace(/^00/, '+');
    if (!s.startsWith('+')) return { cc: null, dial: null, national: s.replace(/[^\d]/g, '') };
    const digits = s.replace(/[^\d]/g, ''), C = countries();
    for (let n = 4; n >= 1; n--) {
        const dial = '+' + digits.slice(0, n), hits = C.filter(c => c.d === dial);
        if (hits.length) return { cc: (hits.find(c => c.c === prefer) || hits.find(c => c.c === DIAL_PREF[dial]) || hits[0]).c, dial, national: digits.slice(n) };
    }
    return { cc: null, dial: null, national: digits };
}

export const dialOf = (cc: string) => (countries().find(x => x.c === cc) || ({} as Country)).d || '+';

/** Local part as stored: digits only, trunk 0 dropped (except Italy). */
export const nationalDigits = (raw: string, cc: string) => {
    let n = raw.replace(/\D/g, '');
    if (cc !== 'IT') n = n.replace(/^0+/, '');
    return n;
};
/** '+968 91234567', or '' when empty. */
export const fullPhone = (raw: string, cc: string) => { const n = nationalDigits(raw, cc); return n ? `${dialOf(cc)} ${n}` : ''; };
export const phoneValid = (raw: string, cc: string) => { const n = nationalDigits(raw, cc); return !n || (n.length >= 6 && n.length <= 14); };
