// Manifest export: the columns a user can pick (and order) and the file for Excel (CSV) or print.
// Rows are shipments as the consolidation / transfer APIs return them (with receiver_parts, packing…).
type Row = Record<string, any>;
export type Column = { key: string; label: string; get: (r: Row) => string | number | null | undefined; num?: boolean };

const parts = (r: Row) => (r.receiver_parts && typeof r.receiver_parts === 'object' ? r.receiver_parts : {}) as Record<string, string>;
const day = (v?: string) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const COLUMNS: Column[] = [
    { key: 'awb', label: 'AWB', get: r => r.awb },
    { key: 'shipper', label: 'Shipper name', get: r => r.shipper },
    { key: 'shipper_phone', label: 'Shipper phone', get: r => r.shipper_phone },
    { key: 'shipper_id', label: 'Shipper ID no.', get: r => r.shipper_id_no },
    { key: 'consignee', label: 'Receiver name', get: r => r.consignee },
    { key: 'consignee_phone', label: 'Receiver phone', get: r => r.consignee_phone },
    { key: 'whatsapp', label: 'Receiver WhatsApp', get: r => r.receiver_whatsapp },
    { key: 'address', label: 'Receiver address', get: r => r.consignee_address || [parts(r).house, parts(r).street, parts(r).landmark].filter(Boolean).join(', ') },
    { key: 'city', label: 'City', get: r => r.dest_city },
    { key: 'state', label: 'State', get: r => parts(r).state },
    { key: 'pin', label: 'PIN / postal code', get: r => parts(r).pin },
    { key: 'country', label: 'Country', get: r => r.dest_country },
    { key: 'origin', label: 'Origin city', get: r => r.origin_city },
    { key: 'pieces', label: 'Pieces', get: r => r.pieces, num: true },
    { key: 'weight', label: 'Weight (kg)', get: r => r.weight, num: true },
    { key: 'chargeable', label: 'Chargeable (kg)', get: r => r.chargeable_weight, num: true },
    { key: 'type', label: 'Package type', get: r => r.package_type },
    { key: 'contents', label: 'Contents', get: r => r.contents },
    { key: 'packing', label: 'Packing list', get: r => r.packing },
    { key: 'value', label: 'Declared value', get: r => r.declared_value, num: true },
    { key: 'branch', label: 'Branch', get: r => r.branch_code },
    { key: 'booked', label: 'Booked on', get: r => day(r.booked_at) },
    { key: 'status', label: 'Status', get: r => r.current_status }
];
const BY = Object.fromEntries(COLUMNS.map(c => [c.key, c]));

export const PRESETS: [string, string[]][] = [
    ['Standard', ['awb', 'shipper', 'shipper_phone', 'consignee', 'consignee_phone', 'city', 'state', 'country', 'pieces', 'weight']],
    ['Delivery', ['awb', 'consignee', 'consignee_phone', 'whatsapp', 'address', 'city', 'state', 'pin', 'pieces']],
    ['Customs', ['awb', 'shipper', 'shipper_id', 'consignee', 'address', 'country', 'pieces', 'weight', 'contents', 'packing', 'value']]
];

const KEY = 'alf_manifest_columns';
export function savedColumns(): string[] {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(v) && v.length && v.every(k => BY[k])) return v; } catch { /* first time / private mode */ }
    return PRESETS[0][1];
}
export function saveColumns(keys: string[]) { try { localStorage.setItem(KEY, JSON.stringify(keys)); } catch { /* private mode */ } }

export const cell = (r: Row, key: string) => { const v = BY[key]?.get(r); return v === null || v === undefined ? '' : String(v); };
export const labelOf = (key: string) => BY[key]?.label || key;

/** CSV that Excel opens correctly (UTF-8 mark for Arabic / Malayalam names, quoted fields, Windows line ends);
 *  a "#" column first and a totals line for pieces / weights */
export function toCsv(rows: Row[], keys: string[]): string {
    // a cell starting with = + - @ would run as a formula in Excel: a leading space keeps it text (phones "+968…" stay readable)
    const q = (v: string) => { const s = /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? ' ' + v : v; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['#', ...keys.map(labelOf)].map(q).join(',')];
    rows.forEach((r, i) => lines.push([String(i + 1), ...keys.map(k => cell(r, k))].map(q).join(',')));
    if (keys.some(k => BY[k]?.num)) {
        const total = (k: string) => Math.round(rows.reduce((s, r) => s + (Number(BY[k].get(r)) || 0), 0) * 100) / 100;
        lines.push(['Total', ...keys.map(k => BY[k]?.num && k !== 'value' ? String(total(k)) : '')].map(q).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
}

export function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
