// File: api/_lib/accounts.js — rate-card pricing + automatic invoice for counter bookings.
import { serviceHeaders } from './auth.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Most specific active card wins: destination+cargo → destination+any → any+cargo → any+any. */
export function pickCard(cards, { dest, cargo }) {
    const d = String(dest || '').toUpperCase(), c = String(cargo || '');
    const live = (cards || []).filter(x => x.active !== false);
    for (const [cd, cc] of [[d, c], [d, '*'], ['*', c], ['*', '*']]) {
        const hit = live.find(x => x.dest_country_code === cd && x.cargo_type_code === cc);
        if (hit) return hit;
    }
    return null;
}

/**
 * Price for one shipment.
 *   per_kg       rate × chargeable kg            per_package  rate × pieces
 *   per_box      rate × boxes                    vol_band     band price for the chargeable kg (+ extra_per_kg above the last band)
 * The minimum charge applies to every method.
 */
export function priceFor(card, { kg = 0, pieces = 1, boxes = 1 } = {}) {
    if (!card) return null;
    const w = Math.max(0, Number(kg) || 0);
    let amount = 0, detail = '';
    if (card.method === 'per_kg') { amount = card.rate * w; detail = `${w} kg × ${card.rate}`; }
    else if (card.method === 'per_package') { amount = card.rate * (pieces || 1); detail = `${pieces || 1} pkg × ${card.rate}`; }
    else if (card.method === 'per_box') { amount = card.rate * (boxes || 1); detail = `${boxes || 1} box × ${card.rate}`; }
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
    return { amount: r3(amount), currency: card.currency, method: card.method, detail };
}

// Booking-form payment choice → invoice terms
export const PAY_MAP = { cash: 'cash', card: 'card', bank_transfer: 'bank', bank: 'bank', credit: 'credit', pay_on_delivery: 'pay_on_delivery' };

/** Invoice (and receipt when paid now) for a booking saved at the counter. Never throws — returns { invoice } or { error }. */
export async function autoInvoice({ awb, branch, fields, userName }) {
    const amount = r3(fields.amount);
    if (!(amount > 0)) return {};
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    try {
        const br = await fetch(`${rest}/bookings?awb=eq.${encodeURIComponent(awb)}&select=id`, { headers: serviceHeaders() });
        const bookingId = ((br.ok ? await br.json() : [])[0] || {}).id || null;
        const kg = fields.chargeable_weight || fields.weight;
        const r = await fetch(`${rest}/rpc/invoice_create`, {
            method: 'POST', headers: serviceHeaders(),
            body: JSON.stringify({
                p_branch: branch.branch_code, p_booking_id: bookingId, p_awb: awb,
                p_customer_name: fields.shipper || null, p_customer_phone: fields.shipper_phone || null,
                p_currency: branch.currency || 'OMR',
                p_lines: [{ description: `Freight ${awb}${fields.dest_country ? ' to ' + fields.dest_country : ''}${kg ? ` · ${kg} kg` : ''}`, qty: 1, rate: amount }],
                p_tax_rate: +branch.tax_rate || 0,
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
