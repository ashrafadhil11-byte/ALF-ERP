// File: api/_lib/accounts.js — rate-card pricing + automatic invoice for counter bookings.
import { serviceHeaders } from './auth.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const VOL_DIVISOR = 5000;   // cm³ → volumetric kg

/**
 * Most specific active card wins. Commodity first (e.g. Electronics), then the general card:
 *   dest+cargo → dest+any cargo → any dest+cargo → any+any   (for the commodity, then for '*')
 */
export function pickCard(cards, { dest, cargo, commodity }) {
    const d = String(dest || '').toUpperCase(), c = String(cargo || ''), m = String(commodity || '').toUpperCase();
    const live = (cards || []).filter(x => x.active !== false);
    for (const cm of [...(m && m !== 'GEN' && m !== '*' ? [m] : []), '*']) {
        for (const [cd, cc] of [[d, c], [d, '*'], ['*', c], ['*', '*']]) {
            const hit = live.find(x => x.dest_country_code === cd && x.cargo_type_code === cc && String(x.commodity || '*').toUpperCase() === cm);
            if (hit) return hit;
        }
    }
    return null;
}

/** Smallest defined size the box fits in (dimensions compared largest-to-largest, so orientation doesn't matter). */
export function fitSize(sizes, box) {
    const b = [box.l, box.w, box.h].map(Number).sort((x, y) => y - x);
    if (b.some(v => !(v > 0))) return null;
    return [...(sizes || [])]
        .map(s => ({ ...s, dims: [s.l, s.w, s.h].map(Number).sort((x, y) => y - x) }))
        .filter(s => s.dims.every((v, i) => v >= b[i]))
        .sort((x, y) => x.dims[0] * x.dims[1] * x.dims[2] - y.dims[0] * y.dims[1] * y.dims[2])[0] || null;
}

/**
 * Price for one group of boxes.
 *   per_kg       rate × chargeable kg            per_package  rate × pieces
 *   per_box      rate × boxes                    vol_band     band price for the chargeable kg (+ extra_per_kg above the last band)
 *   per_cbm      rate × cubic metres (L×W×H cm ÷ 1,000,000)
 *   box_size     each box priced by the smallest size it fits ("per dimension")
 *   doc_slab     documents: first slab (e.g. 0.5 kg) at a fixed price + each extra step — actual weight, no volumetric
 * The minimum charge applies to every method.
 */
export function priceFor(card, { kg = 0, pieces = 1, boxes = 1, dims = [], actualKg } = {}) {
    if (!card) return null;
    const w = Math.max(0, Number(kg) || 0);
    let amount = 0, detail = '', unmatched = 0;
    if (card.method === 'per_kg') { amount = card.rate * w; detail = `${w} kg × ${card.rate}`; }
    else if (card.method === 'per_package') { amount = card.rate * (pieces || 1); detail = `${pieces || 1} pkg × ${card.rate}`; }
    else if (card.method === 'per_box') { amount = card.rate * (boxes || 1); detail = `${boxes || 1} box × ${card.rate}`; }
    else if (card.method === 'per_cbm') {
        const cbm = r3(dims.reduce((s, d) => s + ((+d.l || 0) * (+d.w || 0) * (+d.h || 0)) / 1e6, 0));
        amount = card.rate * cbm; detail = `${cbm} CBM × ${card.rate}`;
        if (dims.some(d => !(d.l > 0 && d.w > 0 && d.h > 0))) unmatched = dims.filter(d => !(d.l > 0 && d.w > 0 && d.h > 0)).length;
    }
    else if (card.method === 'box_size') {
        const names = [];
        dims.forEach(d => { const s = fitSize(card.sizes, d); if (s) { amount += +s.price; names.push(s.name); } else unmatched++; });
        const count = names.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {});
        detail = Object.entries(count).map(([n, c]) => `${c} × ${n}`).join(', ') || 'no box sizes matched';
    }
    else if (card.method === 'doc_slab') {
        const s = card.slab || {}, baseKg = +s.base_kg || 0, base = +s.base_price || 0, stepKg = +s.step_kg || 0, step = +s.step_price || 0;
        const aw = Math.max(0, Number(actualKg ?? kg) || 0);
        const extraSteps = aw > baseKg && stepKg > 0 ? Math.ceil(Math.round((aw - baseKg) / stepKg * 1e6) / 1e6) : 0;
        amount = base + extraSteps * step;
        detail = extraSteps ? `${aw} kg: first ${baseKg} kg ${base} + ${extraSteps} × ${stepKg} kg × ${step}` : `${aw} kg: up to ${baseKg} kg`;
    }
    else if (card.method === 'vol_band') {
        const bands = [...(card.bands || [])].map(b => ({ upto: +b.upto, price: +b.price })).filter(b => b.upto > 0).sort((a, b) => a.upto - b.upto);
        const band = bands.find(b => w <= b.upto);
        if (band) { amount = band.price; detail = `up to ${band.upto} kg`; }
        else if (bands.length) {
            const last = bands[bands.length - 1];
            amount = last.price + (w - last.upto) * (+card.extra_per_kg || 0);
            detail = `${last.upto} kg band + ${r3(w - last.upto)} kg × ${card.extra_per_kg || 0}`;
        }
    }
    const min = +card.min_charge || 0;
    if (amount < min) { amount = min; detail = `minimum charge`; }
    return { amount: r3(amount), currency: card.currency, method: card.method, detail, unmatched };
}

/**
 * Freight for a whole shipment: boxes are grouped by commodity (General, Electronics …) and each group
 * is priced with its own card. boxes: [{ weight, l, w, h, commodity }]
 * → { amount, currency, lines:[{ commodity, description, amount }], missing:[commodities with no card], unmatched }
 */
export function quoteShipment(cards, { dest, cargo, boxes = [], commodityNames = {} }) {
    const groups = {};
    boxes.forEach(b => { const c = String(b.commodity || 'GEN').toUpperCase(); (groups[c] ||= []).push(b); });
    const lines = [], missing = [];
    let currency = null, unmatched = 0;
    for (const [com, list] of Object.entries(groups)) {
        const card = pickCard(cards, { dest, cargo, commodity: com });
        const name = commodityNames[com] || (com === 'GEN' ? 'General' : com);
        if (!card) { missing.push(name); continue; }
        const actual = list.reduce((s, b) => s + (+b.weight || 0), 0);
        const vol = list.reduce((s, b) => s + ((+b.l || 0) * (+b.w || 0) * (+b.h || 0)) / VOL_DIVISOR, 0);
        const kg = Math.round(Math.max(actual, vol) * 100) / 100;
        const p = priceFor(card, { kg, actualKg: Math.round(actual * 100) / 100, pieces: list.length, boxes: list.length, dims: list });
        currency = card.currency;
        unmatched += p.unmatched || 0;
        lines.push({ commodity: com, description: `Freight${Object.keys(groups).length > 1 || com !== 'GEN' ? ' · ' + name : ''} (${p.detail})`, amount: p.amount });
    }
    return { amount: r3(lines.reduce((s, l) => s + l.amount, 0)), currency, lines, missing, unmatched };
}

/**
 * Extra charge price for this shipment: among items with the same name, the most specific one wins
 * (cargo + destination → cargo → destination → any). Returns null when the charge doesn't apply.
 */
export function matchCharge(items, { name, cargo, dest }) {
    const c = String(cargo || ''), d = String(dest || '').toUpperCase();
    const same = (items || []).filter(x => x.active !== false && x.name === name);
    for (const [cc, dd] of [[c, d], [c, '*'], ['*', d], ['*', '*']]) {
        const hit = same.find(x => (x.cargo_type_code || '*') === cc && (x.dest_country_code || '*') === dd);
        if (hit) return hit;
    }
    return null;
}

// Booking-form payment choice → invoice terms
export const PAY_MAP = { cash: 'cash', card: 'card', bank_transfer: 'bank', bank: 'bank', credit: 'credit', pay_on_delivery: 'pay_on_delivery' };
const KINDS = ['freight', 'package', 'charge', 'material'];

/** Clean invoice lines coming from a page. */
export function cleanLines(lines) {
    return (Array.isArray(lines) ? lines : []).slice(0, 60).map(l => ({
        kind: KINDS.includes(l.kind) ? l.kind : 'freight',
        description: String(l.description || '').trim().slice(0, 200),
        qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
        rate: Number(l.rate) >= 0 ? Math.round(Number(l.rate) * 1000) / 1000 : 0,
        product_id: l.product_id ? Number(l.product_id) : null
    })).filter(l => l.rate > 0);
}

/**
 * Invoice (and receipt when paid now) for a booking saved at the counter. Never throws — returns { invoice } or { error }.
 * lines: itemised charges from the booking form; without them one freight line for fields.amount is used.
 */
export async function autoInvoice({ awb, branch, fields, userName, lines }) {
    const kg = fields.chargeable_weight || fields.weight;
    let items = cleanLines(lines);
    if (!items.length) {
        const amount = r3(fields.amount);
        if (!(amount > 0)) return {};
        items = [{ kind: 'freight', description: `Freight ${awb}${fields.dest_country ? ' to ' + fields.dest_country : ''}${kg ? ` · ${kg} kg` : ''}`, qty: 1, rate: amount }];
    }
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    try {
        const br = await fetch(`${rest}/bookings?awb=eq.${encodeURIComponent(awb)}&select=id`, { headers: serviceHeaders() });
        const bookingId = ((br.ok ? await br.json() : [])[0] || {}).id || null;
        const r = await fetch(`${rest}/rpc/invoice_create`, {
            method: 'POST', headers: serviceHeaders(),
            body: JSON.stringify({
                p_branch: branch.branch_code, p_booking_id: bookingId, p_awb: awb,
                p_customer_name: fields.shipper || null, p_customer_phone: fields.shipper_phone || null,
                p_currency: branch.currency || 'OMR', p_lines: items, p_tax_rate: +branch.tax_rate || 0,
                p_pay_method: PAY_MAP[fields.payment_method] || 'credit',
                p_due_days: 30, p_notes: null, p_user_name: userName
            })
        });
        const out = await r.json().catch(() => ({}));
        return r.ok ? { invoice: out } : { error: out.message || 'Invoice not created.' };
    } catch (e) {
        return { error: e.message };
    }
}
