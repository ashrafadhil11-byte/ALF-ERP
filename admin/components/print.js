// File: admin/components/print.js — shipping label (100×150 mm, Code 128 barcode) and customer receipt.
// Usage: ALF_PRINT.label(booking, branch) / ALF_PRINT.receipt(booking, branch)
window.ALF_PRINT = (() => {
    const BARCODE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const date = (iso) => new Date(iso || Date.now()).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    // OMR, KWD and BHD use 3 decimals (baisa / fils); other currencies 2
    const money = (v, cur) => {
        if (v == null || v === '') return '—';
        const d = ['OMR', 'KWD', 'BHD'].includes(cur) ? 3 : 2;
        return `${cur || ''} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`.trim();
    };

    function open(title, size, body) {
        const w = window.open('', '_blank', 'width=720,height=900');
        if (!w) { alert('Allow pop-ups for this site to print.'); return; }
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
            <style>
                @page { size: ${size}; margin: 0; }
                * { box-sizing: border-box; }
                body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .sheet { padding: 5mm; }
                .row { display: flex; gap: 3mm; } .col { flex: 1; min-width: 0; }
                .box { border: 1.5px solid #111827; border-radius: 2mm; padding: 2.5mm 3mm; }
                .lbl { font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #6B7280; }
                .big { font-size: 15pt; font-weight: 800; } .mid { font-size: 10pt; font-weight: 700; } .sm { font-size: 8pt; }
                .dark { background: #111827; color: #fff; border-color: #111827; } .dark .lbl { color: #9CA3AF; }
                table { width: 100%; border-collapse: collapse; font-size: 9pt; } td, th { padding: 1.5mm 0; text-align: left; } th { font-size: 7pt; color: #6B7280; text-transform: uppercase; }
                .right { text-align: right; } .line { border-top: 1px dashed #9CA3AF; margin: 3mm 0; }
                svg.bc { width: 100%; height: 22mm; }
            </style></head><body>${body}
            <script src="${BARCODE_SRC}"><\/script>
            <script>
                document.querySelectorAll('svg.bc').forEach(function (el) {
                    try { JsBarcode(el, el.dataset.code, { format: 'CODE128', displayValue: true, fontSize: 14, margin: 0, height: 60 }); } catch (e) {}
                });
                setTimeout(function () { window.focus(); window.print(); }, 350);
            <\/script></body></html>`);
        w.document.close();
    }

    function label(b, branch = {}) {
        open(`Label ${b.awb}`, '100mm 150mm', `
            <div class="sheet" style="width:100mm;height:150mm;display:flex;flex-direction:column;gap:3mm">
                <div class="row" style="align-items:center">
                    <div class="col"><div class="mid">AL-FARHA CARGO</div><div class="sm">${esc(branch.branch_name || '')} · ${esc(branch.phone_number || '')}</div></div>
                    <div class="box dark" style="text-align:center;padding:1.5mm 3mm"><div class="lbl">Cargo</div><div class="mid">${esc(b.cargo_name || b.package_type || '')}</div></div>
                </div>
                <svg class="bc" data-code="${esc(b.awb)}"></svg>
                <div class="box">
                    <div class="lbl">To</div>
                    <div class="big">${esc(b.consignee || '')}</div>
                    <div class="mid">${esc(b.consignee_phone || '')}${b.receiver_whatsapp && b.receiver_whatsapp !== b.consignee_phone ? ' · WA ' + esc(b.receiver_whatsapp) : ''}</div>
                    <div class="sm" style="margin-top:1mm">${esc(b.consignee_address || '')}</div>
                    <div class="mid" style="margin-top:1mm">${esc([b.dest_city, b.dest_country].filter(Boolean).join(', '))}</div>
                </div>
                <div class="box">
                    <div class="lbl">From</div>
                    <div class="mid">${esc(b.shipper || '')} · ${esc(b.shipper_phone || '')}</div>
                    <div class="sm">${esc([b.origin_city, b.origin_country].filter(Boolean).join(', '))}</div>
                </div>
                <div class="row" style="margin-top:auto">
                    <div class="box col"><div class="lbl">Pieces</div><div class="big">${esc(b.pieces ?? 1)}</div></div>
                    <div class="box col"><div class="lbl">Weight</div><div class="big">${esc(b.chargeable_weight ?? b.weight ?? '—')} kg</div></div>
                    <div class="box col"><div class="lbl">Booked</div><div class="mid">${esc(date(b.booked_at).split(',')[0])}</div></div>
                </div>
            </div>`);
    }

    function receipt(b, branch = {}) {
        const cur = branch.currency || 'OMR';
        const boxes = Array.isArray(b.boxes) ? b.boxes : [];
        open(`Receipt ${b.awb}`, '80mm auto', `
            <div class="sheet" style="width:80mm">
                <div style="text-align:center">
                    <div class="mid">AL-FARHA CARGO</div>
                    <div class="sm">${esc(branch.branch_name || '')}</div>
                    <div class="sm">${esc(branch.address || '')}</div>
                    <div class="sm">${esc(branch.phone_number || '')}</div>
                </div>
                <div class="line"></div>
                <div style="text-align:center"><div class="lbl">Booking reference</div><svg class="bc" data-code="${esc(b.awb)}"></svg></div>
                <table>
                    <tr><td class="lbl">Date</td><td class="right sm">${esc(date(b.booked_at))}</td></tr>
                    <tr><td class="lbl">Sender</td><td class="right sm">${esc(b.shipper || '')}<br>${esc(b.shipper_phone || '')}</td></tr>
                    <tr><td class="lbl">Receiver</td><td class="right sm">${esc(b.consignee || '')}<br>${esc([b.dest_city, b.dest_country].filter(Boolean).join(', '))}</td></tr>
                    <tr><td class="lbl">Cargo</td><td class="right sm">${esc(b.cargo_name || b.package_type || '')}</td></tr>
                    <tr><td class="lbl">Contents</td><td class="right sm">${esc(b.contents || '—')}</td></tr>
                </table>
                <div class="line"></div>
                <table>
                    <tr><th>Box</th><th class="right">Kg</th><th class="right">L×W×H</th><th class="right">Vol</th></tr>
                    ${boxes.map((x, i) => `<tr><td>${i + 1}</td><td class="right">${esc(x.weight ?? '')}</td><td class="right">${x.l ? `${esc(x.l)}×${esc(x.w)}×${esc(x.h)}` : '—'}</td><td class="right">${esc(x.vol ?? '—')}</td></tr>`).join('')
                      || `<tr><td>${esc(b.pieces ?? 1)} pcs</td><td class="right">${esc(b.weight ?? '')}</td><td class="right">—</td><td class="right">—</td></tr>`}
                    <tr><td class="lbl">Chargeable</td><td></td><td></td><td class="right mid">${esc(b.chargeable_weight ?? b.weight ?? '—')} kg</td></tr>
                </table>
                <div class="line"></div>
                <table>
                    <tr><td class="lbl">Declared value</td><td class="right">${esc(money(b.declared_value, cur))}</td></tr>
                    <tr><td class="mid">Total</td><td class="right big">${esc(money(b.amount, cur))}</td></tr>
                    <tr><td class="lbl">Payment</td><td class="right sm">${esc(b.payment_method || '—')}</td></tr>
                </table>
                <div class="line"></div>
                <p class="sm" style="text-align:center;margin:0">Track your shipment with reference <b>${esc(b.awb)}</b>.<br>Thank you for choosing Al-Farha Cargo.</p>
            </div>`);
    }

    return { label, receipt };
})();
