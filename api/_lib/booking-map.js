// File: api/_lib/booking-map.js — shared helper for order / AWB numbers.
// Per-API field mapping lives with each API in api/_lib/integrations/connectors.js.

/** "'412 0431 " → "4120431" (strips the sheet apostrophe, spaces; upper-case). */
export function cleanOrderNo(v) {
    return String(v || '').trim().replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
}
