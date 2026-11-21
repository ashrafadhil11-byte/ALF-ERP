// Packing list per box — optional, made for items coming in one by one (personal effects, mixed in each box):
// pick the box, type "3 shirts" + Enter or tap a chip (tap again = one more), fix with − / +, "Next box".
// Every line is saved at once. Print gives a list per box with the shipper's declaration.
// Open it from anywhere with openPacking(awb); <PackingHost /> sits in AppFrame. Data: /api/packing
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

type Item = { id: number; piece_no: number; item: string; qty: number; value?: number | null; created_by_name?: string | null };
type Data = { shipment: { awb: string; shipper?: string; consignee?: string; dest_city?: string; dest_country?: string; pieces?: number; branch_code?: string }; boxes: number[]; items: Item[]; common: string[] };

/** "3 shirts" → 3 × Shirts · "shirts x3" / "shirts ×3" → 3 × Shirts · "shirts" → 1 × Shirts */
export function parseEntry(text: string): { qty: number; item: string } | null {
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t) return null;
    let m = /^(\d+(?:\.\d+)?)\s*(?:x|×|pcs?|nos?\.?)?\s+(.+)$/i.exec(t);
    if (m) return { qty: +m[1], item: m[2] };
    m = /^(.+?)\s*(?:x|×|-)\s*(\d+(?:\.\d+)?)$/i.exec(t);
    if (m) return { qty: +m[2], item: m[1] };
    return { qty: 1, item: t };
}

export const openPacking = (awb: string) => window.dispatchEvent(new CustomEvent('alf:packing', { detail: awb }));

export function PackingHost() {
    const [awb, setAwb] = useState<string | null>(null);
    useEffect(() => {
        const on = (e: Event) => { const a = (e as CustomEvent<string>).detail; if (a) setAwb(a); };
        window.addEventListener('alf:packing', on);
        return () => window.removeEventListener('alf:packing', on);
    }, []);
    return awb ? <PackingList awb={awb} onClose={() => setAwb(null)} /> : null;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function PackingList({ awb, onClose }: { awb: string; onClose: () => void }) {
    const [d, setD] = useState<Data | null>(null);
    const [err, setErr] = useState('');
    const [box, setBox] = useState(1);
    const [text, setText] = useState('');
    const [withValue, setWithValue] = useState(false);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        api<Data>(`/api/packing?awb=${encodeURIComponent(awb)}`)
            .then(r => { setD(r); setBox(r.boxes[0] || 1); setWithValue(r.items.some(i => i.value != null)); setTimeout(() => input.current?.focus(), 60); })
            .catch(e => setErr((e as Error).message));
    }, [awb]);

    const inBox = useMemo(() => (d?.items || []).filter(i => i.piece_no === box), [d, box]);
    const count = (n: number) => (d?.items || []).filter(i => i.piece_no === n).reduce((s, i) => s + +i.qty, 0);
    const put = (row: Item) => setD(x => x ? { ...x, items: x.items.some(i => i.id === row.id) ? x.items.map(i => i.id === row.id ? row : i) : [...x.items, row] } : x);

    async function add(entry: { qty: number; item: string }, val?: string) {
        if (!d || busy) return;
        setBusy(true);
        try {
            const r = await api<{ item: Item }>('/api/packing', { method: 'POST', body: { action: 'add', awb: d.shipment.awb, piece_no: box, item: entry.item, qty: entry.qty, value: val || undefined } });
            put(r.item);
        } catch (e) { toast(false, (e as Error).message); }
        finally { setBusy(false); }
    }
    async function submit(e?: React.FormEvent) {
        e?.preventDefault();
        const p = parseEntry(text);
        if (!p) return;
        await add(p, withValue ? value : undefined);
        setText(''); setValue(''); input.current?.focus();
    }
    async function setQty(i: Item, qty: number) {
        if (qty <= 0) return remove(i);
        put({ ...i, qty });
        try { put((await api<{ item: Item }>('/api/packing', { method: 'POST', body: { action: 'qty', id: i.id, qty } })).item); }
        catch (e) { put(i); toast(false, (e as Error).message); }
    }
    async function setVal(i: Item, v: string) {
        if (String(i.value ?? '') === v) return;
        try { put((await api<{ item: Item }>('/api/packing', { method: 'POST', body: { action: 'edit', id: i.id, value: v } })).item); }
        catch (e) { toast(false, (e as Error).message); }
    }
    async function remove(i: Item) {
        setD(x => x ? { ...x, items: x.items.filter(y => y.id !== i.id) } : x);
        try { await api('/api/packing', { method: 'POST', body: { action: 'delete', id: i.id } }); }
        catch (e) { put(i); toast(false, (e as Error).message); }
    }
    const nextBox = () => { if (!d) return; const k = d.boxes.indexOf(box); setBox(d.boxes[(k + 1) % d.boxes.length]); setTimeout(() => input.current?.focus(), 30); };

    function print() {
        if (!d) return;
        const s = d.shipment;
        const w = window.open('', '_blank'); if (!w) return toast(false, 'Allow pop-ups to print.');
        const vals = d.items.some(i => i.value != null);
        const boxes = d.boxes.filter(n => count(n) > 0);
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Packing list ${esc(s.awb)}</title><style>
            body{font-family:Arial,sans-serif;margin:28px;color:#111;font-size:12px}h1{font-size:18px;margin:0}.top{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin:12px 0 16px}
            .top b{display:block;font-size:10px;color:#666;text-transform:uppercase}h2{font-size:13px;margin:16px 0 6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
            th{background:#f3f3f3;font-size:11px}td.n{text-align:right;width:70px}.box{break-inside:avoid}.decl{margin-top:28px;font-size:11px;color:#333}.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.sign div{border-top:1px solid #333;padding-top:6px}</style></head><body>
            <h1>Packing list — ${esc(s.awb)}</h1><div style="color:#666">Al-Farha Cargo · personal effects · printed ${esc(new Date().toLocaleString())}</div>
            <div class="top"><div><b>Shipper</b>${esc(s.shipper)}</div><div><b>Receiver</b>${esc(s.consignee)}</div><div><b>Destination</b>${esc([s.dest_city, s.dest_country].filter(Boolean).join(', '))}</div>
            <div><b>Boxes</b>${esc(d.boxes.length)}</div><div><b>Items</b>${esc(d.items.reduce((t, i) => t + +i.qty, 0))}</div><div><b>Branch</b>${esc(s.branch_code)}</div></div>
            ${boxes.map(n => `<div class="box"><h2>Box ${n} of ${d.boxes.length}</h2><table><thead><tr><th>#</th><th>Item</th><th>Qty</th>${vals ? '<th>Value</th>' : ''}</tr></thead><tbody>
                ${d.items.filter(i => i.piece_no === n).map((i, k) => `<tr><td style="width:28px">${k + 1}</td><td>${esc(i.item)}</td><td class="n">${esc(+i.qty)}</td>${vals ? `<td class="n">${i.value != null ? esc(i.value) : ''}</td>` : ''}</tr>`).join('')}
                </tbody></table></div>`).join('')}
            <p class="decl">I declare that these boxes contain my used personal effects and household goods as listed above, not for sale, and no prohibited or dangerous items.</p>
            <div class="sign"><div>Shipper's signature / date</div><div>Checked by (Al-Farha Cargo)</div></div></body></html>`);
        w.document.close();
        w.onload = () => setTimeout(() => w.print(), 300);
    }

    const total = (d?.items || []).reduce((s, i) => s + +i.qty, 0);
    return <Modal id="packingList" open onClose={onClose} panelClassName="max-w-2xl">
        <div className="flex justify-between items-start pb-3 border-b border-gray-100 gap-4">
            <div className="min-w-0"><h3 className="text-lg font-extrabold">{`Packing list · ${d?.shipment.awb || awb}`}</h3>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{d ? `${d.shipment.shipper || '—'} → ${d.shipment.consignee || '—'}${d.shipment.dest_country ? ', ' + d.shipment.dest_country : ''} · ${total} item${total === 1 ? '' : 's'} in ${d.boxes.length} box${d.boxes.length === 1 ? '' : 'es'}` : 'Loading…'}</p></div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {err ? <p className="text-sm text-[#D55C48] py-6">{err}</p> : !d ? <div className="h-48 animate-pulse bg-[#F8F8FA] rounded-2xl mt-4" /> : <>
            {/* boxes */}
            <div id="plBoxes" className="flex gap-1.5 overflow-x-auto custom-scrollbar py-3" role="tablist">
                {d.boxes.map(n => <button key={n} type="button" role="tab" aria-selected={n === box} data-box={n} onClick={() => { setBox(n); input.current?.focus(); }}
                    className={`flex-shrink-0 rounded-xl px-3 py-2 text-xs font-extrabold border ${n === box ? 'bg-[#111827] text-white border-[#111827]' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                    {`Box ${n}`}<span className={`ml-1.5 text-[10px] ${n === box ? 'text-white/60' : count(n) ? 'text-emerald-600' : 'text-gray-300'}`}>{count(n) ? `· ${count(n)}` : '· empty'}</span></button>)}
            </div>
            {/* quick entry */}
            <form id="plAdd" onSubmit={submit} className="flex gap-2">
                <input ref={input} id="plInput" list="plCommon" className="field flex-1" value={text} onChange={e => setText(e.target.value)} maxLength={130} autoComplete="off"
                    placeholder={`Box ${box}: type an item — e.g. "3 shirts" — and press Enter`} aria-label={`Add an item to box ${box}`} />
                {withValue && <input className="field !w-24 text-right" type="number" min="0" step="any" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" aria-label="Value" />}
                <button type="submit" className="btn btn-coral" disabled={!text.trim() || busy}><Icon name="plus" />Add</button>
                <datalist id="plCommon">{d.common.map(c => <option key={c} value={c} />)}</datalist>
            </form>
            <div id="plChips" className="flex flex-wrap gap-1.5 mt-2.5">
                {d.common.slice(0, 18).map(c => <button key={c} type="button" disabled={busy} onClick={() => add({ qty: 1, item: c })} className="rounded-full bg-[#F8F8FA] hover:bg-[#FFF5F3] hover:text-[#D55C48] px-3 py-1 text-[11px] font-bold text-gray-600">{`+ ${c}`}</button>)}
            </div>
            {/* the box */}
            <ul id="plItems" className="mt-4 divide-y divide-gray-100 border border-gray-100 rounded-2xl min-h-[120px] max-h-[38vh] overflow-y-auto custom-scrollbar">
                {inBox.length ? inBox.map(i => <li key={i.id} data-line={i.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 min-w-0 text-sm font-bold truncate">{i.item}</span>
                    {withValue && <input className="field !py-1 !w-20 text-right text-xs" type="number" min="0" step="any" defaultValue={i.value ?? ''} placeholder="Value" aria-label={`Value of ${i.item}`} onBlur={e => setVal(i, e.target.value)} />}
                    <button type="button" className="icon-btn !w-7 !h-7" aria-label={`One less ${i.item}`} onClick={() => setQty(i, +i.qty - 1)}>−</button>
                    <span className="w-8 text-center text-sm font-extrabold tabular-nums">{+i.qty}</span>
                    <button type="button" className="icon-btn !w-7 !h-7" aria-label={`One more ${i.item}`} onClick={() => setQty(i, +i.qty + 1)}>+</button>
                    <button type="button" className="icon-btn !w-7 !h-7" aria-label={`Remove ${i.item}`} onClick={() => remove(i)}><Icon name="trash" cls="w-3.5 h-3.5" /></button>
                </li>) : <li className="text-center text-xs text-gray-400 py-10">{`Box ${box} is empty. Type an item above or tap one of the quick items.`}</li>}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
                <label className="flex items-center gap-2 text-xs font-bold text-gray-500"><input type="checkbox" checked={withValue} onChange={e => setWithValue(e.target.checked)} />Add values (for customs)</label>
                <div className="flex gap-2">
                    <button type="button" className="btn btn-light" onClick={print} disabled={!total}><Icon name="clipboard" />Print</button>
                    {d.boxes.length > 1 && <button type="button" id="plNext" className="btn btn-dark" onClick={nextBox}>Next box<Icon name="arrowRight" /></button>}
                    <button type="button" className="btn btn-coral" onClick={onClose}><Icon name="check" />Done</button>
                </div>
            </div>
        </>}
    </Modal>;
}
