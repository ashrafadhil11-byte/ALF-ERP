// File: api/_lib/booking-map.js — shared helper for order / AWB numbers.
// Per-API field mapping lives with each API in api/_lib/integrations/connectors.js.

/** "'412 0431 " → "4120431" (strips the sheet apostrophe, spaces; upper-case). */
export function cleanOrderNo(v) {
    return String(v || '').trim().replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
}

// Fields people can type on the shipment form (same set as alfwebapp's booking form + optional extras).
export const EDITABLE_FIELDS = {
    shipper: 'text', shipper_phone: 'text', consignee: 'text', consignee_phone: 'text', consignee_address: 'text',
    origin_city: 'text', origin_country: 'text', dest_city: 'text', dest_country: 'text', package_type: 'text',
    weight: 'number', pieces: 'int', declared_value: 'number', amount: 'number', intake_mode: 'intake',
    // full booking form (Phase A)
    dest_country_code: 'iso2', cargo_type_code: 'cargo', receiver_whatsapp: 'text', shipper_id_no: 'text',
    contents: 'text', notes: 'text', payment_method: 'text', chargeable_weight: 'number', boxes: 'boxes'
};
const properCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const PROPER = ['shipper', 'consignee', 'origin_city', 'origin_country', 'dest_city', 'dest_country'];

/**
 * Validates form input. Returns { fields, errors }. Only keys present in `input` are returned,
 * so the same function serves create (all fields) and edit (changed fields).
 */
export function cleanFields(input = {}) {
    const fields = {}, errors = [];
    for (const [k, type] of Object.entries(EDITABLE_FIELDS)) {
        if (!(k in input)) continue;
        const raw = input[k];
        const s = raw === null || raw === undefined ? '' : String(raw).trim();
        if (type === 'text') {
            if (s.length > 300) errors.push(`${k} is too long.`);
            fields[k] = s ? (PROPER.includes(k) ? properCase(s) : s) : null;
        } else if (type === 'intake') {
            fields[k] = s === 'pickup' ? 'pickup' : 'drop_off';
        } else if (type === 'iso2') {
            if (s && !/^[A-Za-z]{2}$/.test(s)) errors.push('Destination country must be a 2-letter code.');
            else fields[k] = s ? s.toUpperCase() : null;
        } else if (type === 'cargo') {
            if (s && !/^[0-9A-Za-z]{1,2}$/.test(s)) errors.push('Invalid cargo type.');
            else fields[k] = s ? s.toUpperCase() : null;
        } else if (type === 'boxes') {
            const list = Array.isArray(raw) ? raw : [];
            if (list.length > 100) { errors.push('At most 100 boxes.'); continue; }
            const boxes = [];
            for (const b of list) {
                const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 && x < 1e5 ? x : null; };
                const box = { weight: n(b && b.weight), l: n(b && b.l), w: n(b && b.w), h: n(b && b.h) };
                box.vol = box.l && box.w && box.h ? Math.round((box.l * box.w * box.h) / 5000 * 100) / 100 : null; // cm³ / 5000
                boxes.push(box);
            }
            fields[k] = boxes.length ? boxes : null;
        } else {
            if (!s) { fields[k] = null; continue; }
            const n = type === 'int' ? parseInt(s, 10) : parseFloat(s);
            if (!Number.isFinite(n) || n < 0 || (type === 'int' && n < 1) || n > 1e7) errors.push(`${k} must be a valid ${type === 'int' ? 'whole number (1 or more)' : 'number'}.`);
            else fields[k] = n;
        }
    }
    return { fields, errors };
}
