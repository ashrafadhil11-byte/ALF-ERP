// Printable manifest (transfer, MAWB, container, bag) in a new window — same document as the old pages' printManifest().
import { toast } from './toast';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function printManifest(title: string, meta: [string, unknown][], items: any[], sign = false) {
    const w = window.open('', '_blank'); if (!w) return toast(false, 'Allow pop-ups to print.');
    const pcs = items.reduce((s, i) => s + (+i.pieces || 0), 0), kg = Math.round(items.reduce((s, i) => s + (+i.weight || 0), 0) * 100) / 100;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
                body{font-family:Arial,sans-serif;margin:28px;color:#111;font-size:12px}h1{font-size:18px;margin:0 0 4px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin:12px 0 16px}
                .meta b{display:block;font-size:10px;color:#666;text-transform:uppercase}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#f3f3f3;font-size:11px}
                tfoot td{font-weight:bold}.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}.sign div{border-top:1px solid #333;padding-top:6px}</style></head><body>
                <h1>${esc(title)}</h1><div style="color:#666">Al-Farha Cargo · printed ${esc(new Date().toLocaleString())}</div>
                <div class="meta">${meta.filter(([, v]) => v).map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>
                <table><thead><tr><th>#</th><th>AWB</th><th>Shipper</th><th>Consignee</th><th>Destination</th><th>Pcs</th><th>Kg</th><th>Status</th></tr></thead><tbody>
                ${items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.awb)}</td><td>${esc(i.shipper || '')}</td><td>${esc(i.consignee || '')}</td><td>${esc([i.dest_city, i.dest_country].filter(Boolean).join(', '))}</td><td>${esc(i.pieces ?? '')}</td><td>${esc(i.weight ?? '')}</td><td>${esc(i.current_status || '')}</td></tr>`).join('')}
                </tbody><tfoot><tr><td colspan="5">${items.length} shipment(s)</td><td>${pcs}</td><td>${kg}</td><td></td></tr></tfoot></table>
                ${sign ? '<div class="sign"><div>Sent by (name / sign)</div><div>Received by (name / sign)</div></div>' : ''}</body></html>`);
    w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);
}
