// "Export manifest": the user picks which columns go in the file and in which order (drag, or ↑ ↓), then downloads it
// for Excel or prints it. The last choice is remembered on this device. Columns: lib/manifestColumns.ts
import { useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { COLUMNS, PRESETS, cell, download, labelOf, saveColumns, savedColumns, toCsv } from '../lib/manifestColumns';
import { toast } from '../lib/toast';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function ManifestExport({ open, onClose, title, fileName, meta = [], rows }: { open: boolean; onClose: () => void; title: string; fileName: string; meta?: [string, unknown][]; rows: Record<string, any>[] }) {
    const [keys, setKeys] = useState<string[]>(savedColumns);
    const [dragging, setDragging] = useState<number | null>(null);
    const unused = COLUMNS.filter(c => !keys.includes(c.key));
    const move = (from: number, to: number) => setKeys(k => { if (to < 0 || to >= k.length) return k; const n = [...k]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; });

    function exportCsv() {
        if (!keys.length) return toast(false, 'Choose at least one column.');
        saveColumns(keys);
        download(`${fileName}.csv`, toCsv(rows, keys));
        toast(true, `${rows.length} shipment(s) exported.`);
    }
    function print() {
        if (!keys.length) return toast(false, 'Choose at least one column.');
        saveColumns(keys);
        const w = window.open('', '_blank'); if (!w) return toast(false, 'Allow pop-ups to print.');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
            body{font-family:Arial,sans-serif;margin:24px;color:#111;font-size:11px}h1{font-size:17px;margin:0 0 4px}.meta{display:flex;flex-wrap:wrap;gap:6px 22px;margin:10px 0 14px}
            .meta b{display:block;font-size:9px;color:#666;text-transform:uppercase}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5px;text-align:left;vertical-align:top}
            th{background:#f3f3f3;font-size:10px}@page{size:landscape;margin:12mm}</style></head><body>
            <h1>${esc(title)}</h1><div style="color:#666">Al-Farha Cargo · printed ${esc(new Date().toLocaleString())} · ${rows.length} shipment(s)</div>
            <div class="meta">${meta.filter(([, v]) => v).map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>
            <table><thead><tr><th>#</th>${keys.map(k => `<th>${esc(labelOf(k))}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${keys.map(k => `<td>${esc(cell(r, k))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
        w.document.close();
        w.onload = () => setTimeout(() => w.print(), 300);
    }

    return <Modal id="manifestExport" open={open} onClose={onClose} panelClassName="max-w-3xl">
        <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
            <div><h3 className="text-lg font-extrabold">Export manifest</h3><p className="text-xs text-gray-400 mt-0.5">{`${title} · ${rows.length} shipment(s). Pick the columns and put them in the order you want.`}</p></div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider mr-1">Start from</span>
            {PRESETS.map(([name, k]) => <button key={name} type="button" className="btn btn-light btn-sm" onClick={() => setKeys(k)}>{name}</button>)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section>
                <p className="sd-label mb-2">{`Columns in your file · ${keys.length}`}</p>
                <ol id="mxChosen" className="space-y-1 max-h-[46vh] overflow-y-auto custom-scrollbar pr-1">
                    {keys.map((k, i) => <li key={k} data-col={k} draggable onDragStart={() => setDragging(i)} onDragEnd={() => setDragging(null)}
                        onDragOver={e => { e.preventDefault(); if (dragging !== null && dragging !== i) { move(dragging, i); setDragging(i); } }}
                        className={`flex items-center gap-2 bg-[#F8F8FA] rounded-xl px-2.5 py-1.5 cursor-grab ${dragging === i ? 'ring-2 ring-[#E86D58]' : ''}`}>
                        <span className="text-gray-300 select-none" aria-hidden>⋮⋮</span>
                        <span className="w-5 text-[10px] font-extrabold text-gray-400">{i + 1}</span>
                        <span className="flex-1 text-xs font-bold">{labelOf(k)}</span>
                        <button type="button" className="icon-btn !w-7 !h-7" aria-label={`Move ${labelOf(k)} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="chevUp" cls="w-3.5 h-3.5" /></button>
                        <button type="button" className="icon-btn !w-7 !h-7" aria-label={`Move ${labelOf(k)} down`} disabled={i === keys.length - 1} onClick={() => move(i, i + 1)}><Icon name="chevDown" cls="w-3.5 h-3.5" /></button>
                        <button type="button" className="icon-btn !w-7 !h-7" aria-label={`Remove ${labelOf(k)}`} onClick={() => setKeys(x => x.filter(y => y !== k))}><Icon name="x" cls="w-3.5 h-3.5" /></button>
                    </li>)}
                    {!keys.length && <li className="text-xs text-gray-400 py-4 text-center">Tap a column on the right to add it.</li>}
                </ol>
            </section>
            <section>
                <p className="sd-label mb-2">Add a column</p>
                <div id="mxMore" className="flex flex-wrap gap-1.5">
                    {unused.map(c => <button key={c.key} type="button" data-add={c.key} className="btn btn-light btn-sm" onClick={() => setKeys(k => [...k, c.key])}><Icon name="plus" cls="w-3 h-3" />{c.label}</button>)}
                    {!unused.length && <p className="text-xs text-gray-400">All columns are in.</p>}
                </div>
                {rows.length > 0 && keys.length > 0 && <div className="mt-4">
                    <p className="sd-label mb-2">Preview</p>
                    <div className="overflow-x-auto custom-scrollbar border border-gray-100 rounded-xl"><table className="text-[10px] whitespace-nowrap"><thead><tr>{keys.map(k => <th key={k} className="px-2 py-1.5 text-left bg-[#F8F8FA]">{labelOf(k)}</th>)}</tr></thead>
                        <tbody>{rows.slice(0, 3).map((r, i) => <tr key={i}>{keys.map(k => <td key={k} className="px-2 py-1 border-t border-gray-100 max-w-[160px] truncate">{cell(r, k) || '—'}</td>)}</tr>)}</tbody></table></div>
                </div>}
            </section>
        </div>
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
            <button type="button" className="btn btn-light" onClick={print}><Icon name="clipboard" />Print</button>
            <button type="button" id="mxCsv" className="btn btn-coral" onClick={exportCsv}><Icon name="download" />Download for Excel</button>
        </div>
    </Modal>;
}
