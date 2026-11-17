// Which boxes of a shipment? Shows every box ticked; staff untick the ones not here. Same as UI.pickBoxes.
//   const r = await pickBoxes('311000041', { title: 'Add to MAWB' })
//   → { awb, pieces: null (all boxes) | [1,2], total }   or null when cancelled / not found
// One-box shipments return straight away without asking.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { showDialog } from './dialogs';
import { toast } from './toast';

type Box = { piece_no: number; weight?: number; l?: number; w?: number; h?: number; status?: string };
type Resp = { booking: { awb: string; consignee?: string }; boxes?: Box[] };
export type Picked = { awb: string; pieces: number[] | null; total: number };

export async function pickBoxes(awb: string, { title = 'Which boxes?', confirmText = 'Continue', only = null as number[] | null } = {}): Promise<Picked | null> {
    let d: Resp;
    try { d = await api<Resp>(`/api/status?boxes=${encodeURIComponent(awb)}`); } catch (e) { toast(false, (e as Error).message); return null; }
    const all = d.boxes || [];
    const boxes = only ? all.filter(b => only.includes(b.piece_no)) : all;
    if (boxes.length <= 1) return { awb: d.booking.awb, pieces: only && boxes.length ? boxes.map(b => b.piece_no) : null, total: all.length };
    return new Promise((resolve) => {
        const close = showDialog(() => <BoxPicker d={d} all={all} boxes={boxes} title={title} confirmText={confirmText} done={(v) => { close(); resolve(v); }} />);
    });
}

function BoxPicker({ d, all, boxes, title, confirmText, done }: { d: Resp; all: Box[]; boxes: Box[]; title: string; confirmText: string; done: (v: Picked | null) => void }) {
    const [ticked, setTicked] = useState(() => new Set(boxes.map(b => b.piece_no)));
    const ok = useRef<HTMLButtonElement>(null);
    useEffect(() => { ok.current?.focus(); }, []);
    const dims = (b: Box) => b.l && b.w && b.h ? `${+b.l}×${+b.w}×${+b.h} cm` : '';
    const n = ticked.size;
    return (
        <div className="ui-modal open" onClick={(e) => { if (e.target === e.currentTarget) done(null); }}>
            <div className="panel max-w-md" role="dialog" aria-modal="true" aria-labelledby="pbTitle">
                <div className="flex items-start justify-between gap-3"><div>
                    <h3 id="pbTitle" className="text-lg font-extrabold">{title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5"><b className="font-mono">{d.booking.awb}</b> · {d.booking.consignee || ''} · {all.length} boxes. Untick boxes that are not here.</p></div>
                    <span className="pill-tag pill-dark" data-count>{n} of {boxes.length}</span></div>
                <div className="flex gap-2 mt-4">
                    <button type="button" className="btn btn-light btn-sm" onClick={() => setTicked(new Set(boxes.map(b => b.piece_no)))}>All</button>
                    <button type="button" className="btn btn-light btn-sm" onClick={() => setTicked(new Set())}>None</button>
                </div>
                <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">{boxes.map(b => (
                    <label key={b.piece_no} className="flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-4 py-2.5 cursor-pointer has-[:checked]:bg-[#FFF5F3] has-[:checked]:ring-1 has-[:checked]:ring-[#FFD0C7]">
                        <input type="checkbox" className="w-4 h-4 accent-[#E86D58]" value={b.piece_no} checked={ticked.has(b.piece_no)}
                            onChange={(e) => setTicked(t => { const x = new Set(t); if (e.target.checked) x.add(b.piece_no); else x.delete(b.piece_no); return x; })} />
                        <span className="font-extrabold text-sm w-16">Box {b.piece_no}</span>
                        <span className="text-[11px] text-gray-500 flex-1">{b.weight ? `${+b.weight} kg` : ''} {dims(b)}</span>
                        <span className="text-[10px] font-bold text-gray-400 text-right">{b.status || ''}</span>
                    </label>))}
                </div>
                <div className="flex justify-end gap-2 mt-5">
                    <button type="button" className="btn btn-light" onClick={() => done(null)}>Cancel</button>
                    <button type="button" ref={ok} className="btn btn-dark" disabled={!n} onClick={() => {
                        const sel = boxes.map(b => b.piece_no).filter(p => ticked.has(p));
                        done({ awb: d.booking.awb, pieces: sel.length === all.length ? null : sel, total: all.length });
                    }}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
}
