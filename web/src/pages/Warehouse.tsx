// Warehouse — same page as admin/warehouse.html. PIN gate (set / enter / change; unlocked 30 min in this tab),
// then Requests (send / reject branch requests), Stock (prices, reorder levels, counts, new items) and Purchases.
// Data: /api/warehouse with the unlock token in the x-warehouse-token header.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { toast } from '../lib/toast';
import './warehouse.css';

const THREE = ['OMR', 'BHD', 'KWD'];
const KEY = 'alf_wh_token';
const day = (v?: string) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = (v?: string) => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
type Tok = { token: string; expires_at: string };
type Mode = 'enter' | 'set' | 'change';
type Tab = 'requests' | 'cargo' | 'stock' | 'purchases';

function Table({ heads, children, empty }: { heads: [string, ('right' | undefined)?][]; children: ReactNode[]; empty: string }) {
    return (
        <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden"><table className="rtable w-full text-xs">
            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                {heads.map(([h, a], i) => <th key={i} className={`p-3 ${i === 0 ? 'pl-4' : ''} ${i === heads.length - 1 ? 'pr-4' : ''} font-extrabold ${a === 'right' ? 'text-right' : ''}`}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">{children.length ? children : <tr><td colSpan={heads.length} className="p-10 text-center text-gray-400">{empty}</td></tr>}</tbody></table></div>
    );
}
function CloseX() {
    const dismiss = useDismiss();
    return <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>;
}

export function Warehouse() {
    const [cur, setCur] = useState('OMR');
    const dp = () => THREE.includes(cur) ? 3 : 2;
    const money = (v: unknown, c = cur) => { const d = THREE.includes(c) ? 3 : 2; return `${c} ${(+(v as number) || 0).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}`; };

    // ---------- unlock token (this tab only; locks itself when it runs out) ----------
    const tok = useRef<Tok | null>((() => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } })());
    const valid = () => !!tok.current && new Date(tok.current.expires_at) > new Date();
    const [status, setStatus] = useState<any>(null);
    const [phase, setPhase] = useState<'loading' | 'error' | 'noaccess' | 'gate' | 'work'>('loading');
    const [loadErr, setLoadErr] = useState('');
    const [mode, setMode] = useState<Mode>('enter');
    const [pins, setPins] = useState({ cur: '', pin: '', pin2: '' });
    const [gBusy, setGBusy] = useState(false);
    const [left, setLeft] = useState('');
    const [whPick, setWhPick] = useState('');   // super admin: which warehouse to open
    const gCur = useRef<HTMLInputElement>(null), gPin = useRef<HTMLInputElement>(null);

    const [tab, setTab] = useState<Tab>('requests');
    const [view, setView] = useState<{ tab: Tab; d: any; n: number } | null>(null);
    const [paneErr, setPaneErr] = useState<string | null>(null);
    const [reqCount, setReqCount] = useState('');
    const data = useRef<{ requests?: any; stock?: any; purchases?: any }>({});

    const lock = (msg?: string) => {
        tok.current = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
        gate('enter'); if (msg) toast(false, msg);
    };
    const wh = <T = any,>(path: string, opts: { method?: string; body?: unknown } = {}) =>
        api<T>(path, { ...opts, headers: { 'x-warehouse-token': tok.current?.token || '' } }).catch(err => {
            if ((err as ApiError).status === 423 && valid()) lock('Locked — enter your PIN again.');
            throw err;
        });

    function gate(m: Mode) {
        setMode(m); setPins({ cur: '', pin: '', pin2: '' }); setPhase('gate');
        setTimeout(() => (m === 'change' ? gCur.current : gPin.current)?.focus(), 50);
    }
    const tickRef = useRef<() => void>(() => {});
    tickRef.current = () => {
        if (phase !== 'work' && phase !== 'gate') return;
        if (!tok.current) return;
        if (!valid()) return lock('Warehouse locked after 30 minutes.');
        const s = Math.max(0, Math.round((+new Date(tok.current.expires_at) - Date.now()) / 1000));
        setLeft(`Unlocked · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    useEffect(() => { const t = setInterval(() => tickRef.current(), 1000); return () => clearInterval(t); }, []);
    // locks when the operator leaves the page open and walks away from it
    useEffect(() => {
        const vis = () => { if (!document.hidden && tok.current && !valid()) lock('Warehouse locked.'); };
        document.addEventListener('visibilitychange', vis);
        return () => document.removeEventListener('visibilitychange', vis);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function open() { setPhase('work'); tickRef.current(); show(tab); }

    useEffect(() => {
        (async () => {
            let st: any;
            try { st = await api('/api/warehouse?view=status'); } catch (e) { setLoadErr((e as Error).message); setPhase('error'); return; }
            setStatus(st); setCur(st.currency || 'OMR'); setWhPick(st.warehouse || '');
            try { localStorage.setItem('cargo_is_warehouse', st.access ? '1' : ''); } catch { /* ignore */ }
            if (!st.access) { setPhase('noaccess'); return; }
            if (!st.has_pin) return gate('set');
            if (valid()) return open();
            gate('enter');
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function submitGate(e: React.FormEvent) {
        e.preventDefault();
        const pin = pins.pin.trim();
        if (!/^\d{4,6}$/.test(pin)) return toast(false, 'PIN is 4 to 6 digits.');
        if (mode !== 'enter' && pin !== pins.pin2.trim()) return toast(false, 'The two PINs do not match.');
        setGBusy(true);
        try {
            const where = status?.warehouses?.length ? { warehouse: whPick } : {};
            const out = await api<Tok>('/api/warehouse', { method: 'POST', body: mode === 'enter' ? { action: 'unlock', pin, ...where } : { action: 'set_pin', pin, current_pin: mode === 'change' ? pins.cur.trim() : undefined, ...where } });
            tok.current = { token: out.token, expires_at: out.expires_at };
            try { sessionStorage.setItem(KEY, JSON.stringify(tok.current)); } catch { /* private mode */ }
            if (mode !== 'enter') toast(true, 'PIN saved.');
            setStatus((s: any) => {
                const w = (s.warehouses || []).find((x: any) => x.branch_code === whPick);
                return { ...s, has_pin: true, ...(w ? { warehouse: w.branch_code, warehouse_name: w.branch_name, currency: w.currency } : {}) };
            });
            if (status?.warehouses?.length) setCur((status.warehouses.find((x: any) => x.branch_code === whPick) || {}).currency || 'OMR');
            open();
        } catch (err) {
            toast(false, (err as Error).message); setPins(p => ({ ...p, pin: '' }));
            if ((err as ApiError).status === 423) { setStatus((s: any) => ({ ...s, locked_until: new Date(Date.now() + 15 * 60e3).toISOString() })); gate('enter'); }
        } finally { setGBusy(false); }
    }

    // ---------- tabs ----------
    async function show(t: Tab = tab) {
        try {
            let d: any;
            if (t === 'requests') {
                d = await wh('/api/warehouse?view=requests'); data.current.requests = d;
                const waiting = d.requests.filter((r: any) => r.status === 'requested').length;
                setReqCount(waiting ? `· ${waiting}` : '');
            } else if (t === 'cargo') {
                d = await wh('/api/warehouse?view=cargo');
            } else if (t === 'stock') {
                d = await wh('/api/warehouse?view=stock'); data.current.stock = d; setCur(c => d.currency || c);
            } else {
                d = await wh('/api/warehouse?view=purchases'); data.current.purchases = d;
                if (!data.current.stock) data.current.stock = await wh('/api/warehouse?view=stock');
            }
            setPaneErr(null); setView(v => ({ tab: t, d, n: (v?.n || 0) + 1 }));
        } catch (e) {
            if ((e as ApiError).status !== 423) { setPaneErr((e as Error).message); setView(v => ({ tab: t, d: null, n: (v?.n || 0) + 1 })); }
        }
    }
    const pick = (t: Tab) => { setTab(t); show(t); };

    // ---------- send a request ----------
    const [sending, setSending] = useState<any>(null);
    const [sendOpen, setSendOpen] = useState(false);
    const [sendLines, setSendLines] = useState<{ q: string; p: string }[]>([]);
    const [sBusy, setSBusy] = useState(false);
    const openSend = (r: any) => {
        const stock = data.current.requests.stock;
        setSending(r);
        setSendLines((r.lines || []).map((l: any) => {
            const st = stock.find((s: any) => s.product_id === l.product_id) || {};
            const have = +st.qty || 0, price = l.unit_price ?? st.sell_price ?? 0;
            return { q: String(Math.min(+l.qty_requested, have)), p: (+price).toFixed(dp()) };
        }));
        setSendOpen(true);
    };
    const sendTotal = sendLines.reduce((t, l) => t + (+l.q || 0) * (+l.p || 0), 0);
    const doSend = async () => {
        const lines = sendLines.map((x, i) => ({ product_id: sending.lines[i].product_id, qty: +x.q || 0, unit_price: +x.p || 0 }));
        if (!lines.some(l => l.qty > 0)) return toast(false, 'Nothing to send.');
        setSBusy(true);
        try { await wh('/api/warehouse', { method: 'POST', body: { action: 'dispatch', id: sending.id, lines } }); setSendOpen(false); toast(true, `${sending.request_no} sent to ${sending.branch_code}.`); show(); }
        catch (err) { toast(false, (err as Error).message); } finally { setSBusy(false); }
    };
    const reject = async (req: any) => {
        const reason = prompt(`Reject ${req.request_no} from ${req.branch_code}? Reason (shown to the branch):`, '');
        if (reason === null) return;
        try { await wh('/api/warehouse', { method: 'POST', body: { action: 'reject', id: req.id, reason } }); toast(true, 'Rejected.'); show(); } catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- stock ----------
    const savePrice = async (item: any, row: HTMLElement) => {
        try { await wh('/api/warehouse', { method: 'POST', body: { action: 'price', product_id: item.id, sell_price: (row.querySelector('[data-price]') as HTMLInputElement).value, reorder_level: (row.querySelector('[data-reorder]') as HTMLInputElement).value } }); toast(true, `${item.name} saved.`); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const count = async (item: any) => {
        const v = prompt(`Counted ${item.name} on the shelf (system says ${item.qty} ${item.unit}):`, String(item.qty));
        if (v === null || v.trim() === '') return;
        const note = Number(v) !== item.qty ? (prompt('Reason for the difference (optional):', '') || '') : '';
        try { await wh('/api/warehouse', { method: 'POST', body: { action: 'count', product_id: item.id, counted: Number(v), note } }); toast(true, 'Stock count saved.'); show(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const [itemOpen, setItemOpen] = useState(false);
    const [it, setIt] = useState({ sku: '', unit: 'pcs', name: '', price: '' });
    const saveItem = async (e: React.FormEvent) => {
        e.preventDefault();
        try { await wh('/api/warehouse', { method: 'POST', body: { action: 'item', sku: it.sku, name: it.name, unit: it.unit, sell_price: it.price } }); setItemOpen(false); toast(true, 'Item added.'); show(); }
        catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- purchases ----------
    const [buyOpen, setBuyOpen] = useState(false);
    const [buy, setBuy] = useState({ supplier: '', pay: 'cash', ref: '' });
    const [bLines, setBLines] = useState<{ k: number; prod: string; qty: string; cost: string }[]>([]);
    const bKey = useRef(0);
    const newLine = () => ({ k: ++bKey.current, prod: String(data.current.stock?.items[0]?.id ?? ''), qty: '', cost: '' });
    const openBuy = () => {
        if (!data.current.stock.items.length) return toast(false, 'Add a stock item first (Packing materials tab → New item).');
        setBuy({ supplier: '', pay: 'cash', ref: '' }); setBLines([newLine()]); setBuyOpen(true);
    };
    const buyTotal = bLines.reduce((t, l) => t + (+l.qty || 0) * (+l.cost || 0), 0);
    const saveBuy = async (e: React.FormEvent) => {
        e.preventDefault();
        const lines = bLines.map(r => {
            const id = +r.prod; const item = data.current.stock.items.find((i: any) => i.id === id);
            return { product_id: id, description: item?.name || '', qty: +r.qty || 0, unit_cost: +r.cost || 0 };
        }).filter(l => l.qty > 0);
        if (!lines.length) return toast(false, 'Enter a quantity.');
        try {
            const out = await wh<{ purchase_no?: string }>('/api/warehouse', { method: 'POST', body: { action: 'purchase', supplier_id: buy.supplier || null, pay_method: buy.pay, bill_ref: buy.ref, lines } });
            setBuyOpen(false); toast(true, `${out.purchase_no || 'Purchase'} saved — stock updated.`); data.current.stock = null; show();
        } catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- panes ----------
    const SPR: Record<string, string> = { requested: 'pill-amber', dispatched: 'pill-dark', received: 'pill-green', rejected: 'pill-coral', cancelled: 'pill-gray' };
    const SPP: Record<string, string> = { paid: 'pill-green', partial: 'pill-amber', unpaid: 'pill-coral', void: 'pill-gray' };
    const TY: Record<string, string> = { purchase: 'Purchase', sale: 'Sale', transfer_out: 'Sent', transfer_in: 'Received', adjust: 'Count', void: 'Void' };
    function Requests(d: any) {
        return <Table heads={[['Request'], ['Branch'], ['Items'], ['Total', 'right'], ['Status'], ['']]} empty="No requests from branches yet.">
            {d.requests.map((r: any) => (
                <tr key={r.id} className={r.status === 'requested' ? 'bg-[#FFFBF5]' : ''}>
                    <td className="p-3 pl-4 font-extrabold font-mono" data-label="Request">{r.request_no}<span className="block text-[10px] text-gray-400 font-sans">{`${when(r.requested_at)} · ${r.requested_by || ''}`}</span></td>
                    <td className="p-3 font-extrabold" data-label="Branch">{r.branch_code}</td>
                    <td className="p-3" data-label="Items">{(r.lines || []).map((l: any) => `${l.qty_sent != null ? `${+l.qty_sent}/${+l.qty_requested}` : +l.qty_requested} × ${l.name}`).join(', ')}{r.notes && <span className="block text-[10px] text-gray-400">{r.notes}</span>}{r.reject_reason && <span className="block text-[10px] text-[#D55C48]">{r.reject_reason}</span>}</td>
                    <td className="p-3 text-right money" data-label="Total">{+r.total ? money(r.total, r.currency || cur) : '—'}</td>
                    <td className="p-3" data-label="Status"><span className={`pill-tag ${SPR[r.status]}`}>{r.status}</span>{r.dispatched_at && <span className="block text-[10px] text-gray-400">{`sent ${when(r.dispatched_at)}`}</span>}</td>
                    <td className="p-3 pr-4 text-right whitespace-nowrap" data-label="">{r.status === 'requested' && <><button type="button" className="btn btn-dark btn-sm" data-send={r.id} onClick={() => openSend(r)}>Send</button>{' '}<button type="button" className="btn btn-light btn-sm" data-reject={r.id} onClick={() => reject(r)}>Reject</button></>}</td></tr>
            ))}
        </Table>;
    }
    function Cargo(d: any) {
        const boxes = d.cargo.reduce((n: number, c: any) => n + (c.boxes || []).length, 0);
        const kg = d.cargo.reduce((n: number, c: any) => n + (+c.weight || 0), 0), cbm = d.cargo.reduce((n: number, c: any) => n + (+c.cbm || 0), 0);
        const coming = d.incoming.reduce((n: number, m: any) => n + (m.transfers || []).filter((t: any) => t.status === 'pending').reduce((k: number, t: any) => k + (t.pieces ? t.pieces.length : +t.bookings?.pieces || 1), 0), 0);
        return <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {([['Shipments', String(d.cargo.length)], ['Boxes', String(boxes)], ['Weight', `${Math.round(kg * 100) / 100} kg`], ['Coming in', `${coming} box${coming === 1 ? '' : 'es'}`]] as [string, string][]).map(([l, v]) =>
                    <div key={l} className="bg-[#F8F8FA] rounded-2xl px-4 py-3"><p className="sd-label">{l}</p><p className="text-lg font-extrabold tabular-nums">{v}</p></div>)}
            </div>
            <p className="text-xs text-gray-500 mb-3">{`Customer cargo in the warehouse${cbm ? ` · ${Math.round(cbm * 1000) / 1000} CBM` : ''}. Packing materials are on their own tab. Receive or send cargo on `}<a className="font-bold underline" href="/app/consolidation">Consolidation &amp; Bulk</a>.</p>
            <Table heads={[['Shipment'], ['Receiver'], ['Destination'], ['Boxes here', 'right'], ['Weight', 'right'], ['Status'], ['Since']]} empty="No cargo in the warehouse.">
                {d.cargo.map((c: any) => (
                    <tr key={c.awb}><td className="p-3 pl-4 font-mono font-bold" data-label="Shipment">{c.awb}</td>
                        <td className="p-3" data-label="Receiver">{c.consignee || '—'}</td>
                        <td className="p-3" data-label="Destination">{[c.dest_city, c.dest_country].filter(Boolean).join(', ') || '—'}</td>
                        <td className="p-3 text-right font-extrabold" data-label="Boxes here">{(c.boxes || []).length < c.boxes_total ? `${(c.boxes || []).length} of ${c.boxes_total}` : c.boxes_total}{(c.boxes || []).length < c.boxes_total && <span className="block text-[10px] text-gray-400 font-medium">{`box ${c.boxes.join(', ')}`}</span>}</td>
                        <td className="p-3 text-right" data-label="Weight">{`${+c.weight || 0} kg`}</td>
                        <td className="p-3" data-label="Status">{c.current_status || ''}</td>
                        <td className="p-3 pr-4" data-label="Since">{when(c.since)}</td></tr>
                ))}
            </Table>
        </>;
    }
    function Stock(d: any) {
        const value = d.items.reduce((t: number, i: any) => t + i.qty * i.avg_cost, 0);
        return <>
            <div className="flex flex-wrap justify-between items-center gap-3 mb-3"><p className="text-xs text-gray-500">Stock value at cost <b className="money text-gray-900">{money(value)}</b></p>
                <button type="button" id="newItem" className="btn btn-dark btn-sm" onClick={() => { setIt({ sku: '', unit: 'pcs', name: '', price: '' }); setItemOpen(true); }}><Icon name="plus" />New item</button></div>
            <Table heads={[['Item'], ['In stock', 'right'], ['Avg cost', 'right'], ['Price to branches'], ['Reorder at'], ['']]} empty="No stock items yet. Add one, then make a purchase.">
                {d.items.map((i: any) => {
                    const low = i.reorder_level && i.qty <= i.reorder_level;
                    return (
                        <tr key={i.id} className={low ? 'low' : ''} data-item={i.id}>
                            <td className="p-3 pl-4" data-label="Item"><b>{i.name}</b><span className="block text-[10px] text-gray-400 font-mono">{i.sku}</span></td>
                            <td className="p-3 text-right font-extrabold" data-label="In stock">{i.qty + ' '}<span className="text-[10px] text-gray-400 font-medium">{i.unit}</span>{low ? <span className="block text-[10px] text-[#D55C48]">reorder</span> : null}</td>
                            <td className="p-3 text-right money" data-label="Avg cost">{money(i.avg_cost)}</td>
                            <td className="p-3" data-label="Price to branches"><input type="number" min="0" step="0.001" className="field !py-1.5 !w-28 text-right" data-price defaultValue={(+i.sell_price).toFixed(dp())} aria-label={`Price to branches for ${i.name}`} /></td>
                            <td className="p-3" data-label="Reorder at"><input type="number" min="0" step="any" className="field !py-1.5 !w-20 text-right" data-reorder defaultValue={i.reorder_level || ''} aria-label={`Reorder level for ${i.name}`} /></td>
                            <td className="p-3 pr-4 text-right whitespace-nowrap" data-label=""><button type="button" className="btn btn-light btn-sm" data-save onClick={(e) => savePrice(i, e.currentTarget.closest('tr')!)}>Save</button>{' '}<button type="button" className="btn btn-light btn-sm" data-count onClick={() => count(i)}>Count</button></td></tr>
                    );
                })}
            </Table>
            <p className="sd-label mt-6 mb-2">Latest movements</p>
            <Table heads={[['When'], ['Item'], ['Type'], ['Qty', 'right'], ['Reference']]} empty="No movements yet.">
                {d.moves.map((m: any, k: number) => (
                    <tr key={k}><td className="p-3 pl-4" data-label="When">{when(m.created_at)}</td><td className="p-3" data-label="Item">{m.products?.name || ''}</td>
                        <td className="p-3" data-label="Type">{TY[m.kind] || m.kind}</td>
                        <td className={`p-3 text-right font-extrabold ${+m.qty < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Qty">{`${+m.qty > 0 ? '+' : ''}${+m.qty}`}</td>
                        <td className="p-3 pr-4" data-label="Reference">{m.note || ''}<span className="block text-[10px] text-gray-400">{m.created_by_name || ''}</span></td></tr>
                ))}
            </Table>
        </>;
    }
    function Purchases(d: any) {
        return <>
            <div className="flex justify-end mb-3"><button type="button" id="newBuy" className="btn btn-dark btn-sm" onClick={openBuy}><Icon name="plus" />New purchase</button></div>
            <Table heads={[['Purchase'], ['Supplier'], ['Items'], ['Total', 'right'], ['Status']]} empty="No purchases yet.">
                {d.purchases.map((p: any) => (
                    <tr key={p.id}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Purchase">{p.purchase_no}<span className="block text-[10px] text-gray-400 font-sans">{day(p.purchase_date) + (p.bill_ref ? ' · bill ' + p.bill_ref : '')}</span></td>
                        <td className="p-3" data-label="Supplier">{p.suppliers?.name || 'Cash purchase'}</td>
                        <td className="p-3" data-label="Items">{(p.lines || []).map((l: any) => `${+l.qty} × ${l.description}`).join(', ')}</td>
                        <td className="p-3 text-right money" data-label="Total">{money(p.total, p.currency)}</td>
                        <td className="p-3 pr-4" data-label="Status"><span className={`pill-tag ${SPP[p.status]}`}>{p.status}</span>{+p.balance && p.status !== 'void' ? <span className="block text-[10px] text-[#D55C48]">{`${money(p.balance, p.currency)} due`}</span> : null}</td></tr>
                ))}
            </Table>
        </>;
    }

    const name = status?.warehouse_name ? `${status.warehouse_name} (${status.warehouse})` : status?.warehouse;
    const gTitle = phase === 'loading' ? 'Loading…' : phase === 'error' ? 'Could not load' : phase === 'noaccess' ? 'Warehouse operators only'
        : mode === 'set' ? 'Set your warehouse PIN' : mode === 'change' ? 'Change your PIN' : `Unlock ${name || 'warehouse'}`;
    const gText = phase === 'loading' ? '' : phase === 'error' ? loadErr : phase === 'noaccess' ? 'Ask super admin or head office to turn on "Warehouse operator" for your account in Staff & Users.'
        : mode === 'set' ? 'Pick 4–6 digits only you know. You will enter it each time you open the warehouse — this stops accidental changes.'
            : mode === 'change' ? 'Enter your current PIN, then the new one twice.'
                : status?.locked_until ? `Too many wrong PINs — try again after ${new Date(status.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`
                    : 'Enter your warehouse PIN. It stays unlocked for 30 minutes in this tab.';
    const showForm = phase === 'gate';
    const working = phase === 'work';
    const changingFromWork = phase === 'gate' && mode === 'change';

    const popups = <>
        <Modal id="sendModal" open={sendOpen} onClose={() => setSendOpen(false)} panelClassName="max-w-xl">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 id="sTitle" className="text-lg font-extrabold">{sending ? `Send ${sending.request_no}` : 'Send'}</h3><p id="sSub" className="text-xs text-gray-400 mt-0.5">{sending ? `To ${sending.branch_code} · stock leaves the warehouse, branch owes the total (internal invoice)` : ''}</p></div>
                <CloseX />
            </div>
            <div id="sLines" className="my-5 space-y-2 overflow-y-auto custom-scrollbar">
                {sending && (sending.lines || []).map((l: any, i: number) => {
                    const st = data.current.requests.stock.find((s: any) => s.product_id === l.product_id) || {};
                    const have = +st.qty || 0;
                    return (
                        <div key={i} className="grid grid-cols-12 gap-2 items-center bg-[#F8F8FA] rounded-2xl p-3" data-line={i}>
                            <div className="col-span-12 sm:col-span-5 text-xs"><b>{l.name}</b><span className={`block text-[10px] ${have < +l.qty_requested ? 'text-[#D55C48] font-bold' : 'text-gray-400'}`}>{`asked ${+l.qty_requested} · in stock ${have} ${l.unit || ''}`}</span></div>
                            <label className="col-span-6 sm:col-span-3"><span className="sr-only">Qty to send</span><input type="number" min="0" step="any" className="field !py-2" data-q value={sendLines[i]?.q ?? ''} onChange={e => setSendLines(ls => ls.map((x, j) => j === i ? { ...x, q: e.target.value } : x))} /></label>
                            <label className="col-span-6 sm:col-span-4"><span className="sr-only">Price each</span><input type="number" min="0" step="0.001" className="field !py-2" data-p value={sendLines[i]?.p ?? ''} onChange={e => setSendLines(ls => ls.map((x, j) => j === i ? { ...x, p: e.target.value } : x))} /></label></div>
                    );
                })}
            </div>
            <div className="flex justify-between items-center gap-3 pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-500">Total to branch <b id="sTotal" className="money text-gray-900">{sending ? money(sendTotal) : ''}</b></span>
                <button type="button" id="sGo" className="btn btn-coral" disabled={sBusy} onClick={doSend}>Send to branch</button>
            </div>
        </Modal>

        <Modal id="buyModal" open={buyOpen} onClose={() => setBuyOpen(false)} panelClassName="max-w-2xl">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 className="text-lg font-extrabold">Purchase into the warehouse</h3><p className="text-xs text-gray-400 mt-0.5">Stock goes up at the cost you paid.</p></div>
                <CloseX />
            </div>
            <form id="buyForm" className="my-5 space-y-3 overflow-y-auto custom-scrollbar" onSubmit={saveBuy}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className="ui-label" htmlFor="bSupplier">Supplier</label><select id="bSupplier" className="field" value={buy.supplier} onChange={e => setBuy({ ...buy, supplier: e.target.value })}>
                        {buyOpen && <><option value="">— Cash purchase (no supplier) —</option>{(data.current.purchases?.suppliers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</>}
                    </select></div>
                    <div><label className="ui-label" htmlFor="bPay">Paid by</label><select id="bPay" className="field" value={buy.pay} onChange={e => setBuy({ ...buy, pay: e.target.value })}><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="credit">On credit (pay later)</option></select></div>
                    <div><label className="ui-label" htmlFor="bRef">Supplier bill no.</label><input id="bRef" className="field" value={buy.ref} onChange={e => setBuy({ ...buy, ref: e.target.value })} /></div>
                </div>
                <div id="bLines" className="space-y-2">
                    {bLines.map(l => (
                        <div key={l.k} className="grid grid-cols-12 gap-2 items-center bg-[#F8F8FA] rounded-2xl p-2" data-bl>
                            <select className="field !py-2 col-span-12 sm:col-span-6" data-prod aria-label="Item" value={l.prod} onChange={e => setBLines(ls => ls.map(x => x.k === l.k ? { ...x, prod: e.target.value } : x))}>
                                {(data.current.stock?.items || []).map((i: any) => <option key={i.id} value={i.id}>{`${i.name} (${i.unit})`}</option>)}
                            </select>
                            <input type="number" min="0" step="any" className="field !py-2 col-span-4 sm:col-span-2" data-qty placeholder="Qty" aria-label="Qty" value={l.qty} onChange={e => setBLines(ls => ls.map(x => x.k === l.k ? { ...x, qty: e.target.value } : x))} />
                            <input type="number" min="0" step="0.001" className="field !py-2 col-span-6 sm:col-span-3" data-cost placeholder="Cost each" aria-label="Cost each" value={l.cost} onChange={e => setBLines(ls => ls.map(x => x.k === l.k ? { ...x, cost: e.target.value } : x))} />
                            <button type="button" className="icon-btn col-span-2 sm:col-span-1 justify-self-end" data-del aria-label="Remove line" onClick={() => setBLines(ls => ls.length > 1 ? ls.filter(x => x.k !== l.k) : ls)}><Icon name="x" cls="w-3 h-3" /></button></div>
                    ))}
                </div>
                <button type="button" id="bAdd" className="btn btn-light btn-sm" onClick={() => setBLines(ls => [...ls, newLine()])}><Icon name="plus" />Add item</button>
                <div className="flex justify-between items-center gap-3 pt-4 border-t border-gray-100">
                    <span className="text-xs text-gray-500">Total <b id="bTotal" className="money text-gray-900">{buyOpen ? money(buyTotal) : ''}</b></span>
                    <button className="btn btn-coral">Save purchase</button>
                </div>
            </form>
        </Modal>

        <Modal id="itemModal" open={itemOpen} onClose={() => setItemOpen(false)} panelClassName="max-w-md">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <h3 className="text-lg font-extrabold">New stock item</h3>
                <CloseX />
            </div>
            <form id="itemForm" className="my-5 grid grid-cols-2 gap-3" onSubmit={saveItem}>
                <div><label className="ui-label" htmlFor="iSku">Item code</label><input id="iSku" className="field" placeholder="CTN-L" required value={it.sku} onChange={e => setIt({ ...it, sku: e.target.value })} /></div>
                <div><label className="ui-label" htmlFor="iUnit">Unit</label><input id="iUnit" className="field" value={it.unit} onChange={e => setIt({ ...it, unit: e.target.value })} /></div>
                <div className="col-span-2"><label className="ui-label" htmlFor="iName">Name</label><input id="iName" className="field" placeholder="Carton box large" required value={it.name} onChange={e => setIt({ ...it, name: e.target.value })} /></div>
                <div className="col-span-2"><label className="ui-label" htmlFor="iPrice">Price to branches</label><input id="iPrice" type="number" step="0.001" min="0" className="field" value={it.price} onChange={e => setIt({ ...it, price: e.target.value })} /></div>
                <div className="col-span-2 flex justify-end"><button className="btn btn-coral">Add item</button></div>
            </form>
        </Modal>
    </>;

    const pane = !view ? null : paneErr ? <p className="text-center text-gray-400 p-10">{paneErr}</p>
        : view.tab === 'requests' ? Requests(view.d) : view.tab === 'cargo' ? Cargo(view.d) : view.tab === 'stock' ? Stock(view.d) : Purchases(view.d);
    const pinField = (ref: React.Ref<HTMLInputElement> | null, id: string, k: 'cur' | 'pin' | 'pin2', placeholder: string, label: string, hidden: boolean) => (
        <input id={id} ref={ref} className={`field pin-box${hidden ? ' hidden' : ''}`} type="password" inputMode="numeric" pattern="\d*" maxLength={6} placeholder={placeholder} aria-label={label} autoComplete="off"
            value={pins[k]} onChange={e => setPins({ ...pins, [k]: e.target.value })} />
    );

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="warehouse" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Warehouse</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p id="whSub" className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{status?.access ? `${status.warehouse_name || status.warehouse} • branch requests, stock, purchases` : 'Branch requests, stock, purchases • PIN protected'}</p>
                        </div>
                    </div>
                    <div id="lockBar" className={`${working || changingFromWork ? '' : 'hidden '}flex items-center gap-2 self-start sm:self-auto`}>
                        <span className="pill-tag pill-green"><span id="lockLeft">{left}</span></span>
                        <button type="button" id="changePinBtn" className="btn btn-light btn-sm" onClick={() => gate('change')}><Icon name="key" />Change PIN</button>
                        <button type="button" id="lockBtn" className="btn btn-dark btn-sm" onClick={() => lock()}><Icon name="lock" />Lock</button>
                    </div>
                </section>

                <div id="gate" className={`${working ? 'hidden ' : ''}max-w-sm mx-auto py-8 text-center`}>
                    <div className="w-16 h-16 rounded-3xl bg-[#111827] text-white flex items-center justify-center mx-auto mb-4"><Icon name="lock" cls="w-7 h-7" /></div>
                    <h2 id="gTitle" className="text-xl font-extrabold">{gTitle}</h2>
                    <p id="gText" className="text-xs text-gray-500 mt-1 mb-5">{gText}</p>
                    <form id="gForm" className={`space-y-3${showForm ? '' : ' hidden'}`} autoComplete="off" onSubmit={submitGate}>
                        {status?.warehouses?.length > 0 && mode === 'enter' && <select id="gWarehouse" className="field" aria-label="Warehouse" value={whPick} onChange={e => setWhPick(e.target.value)}>
                            {status.warehouses.map((w: any) => <option key={w.branch_code} value={w.branch_code}>{`${w.branch_name} (${w.branch_code})`}</option>)}</select>}
                        {pinField(gCur, 'gCurrent', 'cur', 'Current', 'Current PIN', mode !== 'change')}
                        {pinField(gPin, 'gPin', 'pin', mode === 'enter' ? '••••' : 'New PIN', 'PIN', false)}
                        {pinField(null, 'gPin2', 'pin2', 'Again', 'Repeat PIN', mode === 'enter')}
                        <button id="gBtn" className="btn btn-coral w-full justify-center" disabled={gBusy}>{mode === 'enter' ? 'Unlock' : 'Save PIN'}</button>
                        <button type="button" id="gCancel" className={`btn btn-light w-full justify-center${changingFromWork ? '' : ' hidden'}`} onClick={() => setPhase('work')}>Cancel</button>
                    </form>
                </div>

                <div id="work" className={working ? '' : 'hidden'}>
                    <div className="flex flex-wrap gap-1 bg-[#F8F8FA] p-1 rounded-full self-start w-fit mb-5" role="tablist">
                        <button type="button" className="opt px-4 py-2 rounded-full text-[11px] font-extrabold" data-tab="requests" aria-pressed={tab === 'requests'} onClick={() => pick('requests')}>Requests <span id="reqCount">{reqCount}</span></button>
                        <button type="button" className="opt px-4 py-2 rounded-full text-[11px] font-extrabold" data-tab="cargo" aria-pressed={tab === 'cargo'} onClick={() => pick('cargo')}>Cargo</button>
                        <button type="button" className="opt px-4 py-2 rounded-full text-[11px] font-extrabold" data-tab="stock" aria-pressed={tab === 'stock'} onClick={() => pick('stock')}>Packing materials</button>
                        <button type="button" className="opt px-4 py-2 rounded-full text-[11px] font-extrabold" data-tab="purchases" aria-pressed={tab === 'purchases'} onClick={() => pick('purchases')}>Purchases</button>
                    </div>
                    <div id="pane" key={view?.n || 0} className="ui-fade">{pane}</div>
                </div>
            </div>
        </AppFrame>
    );
}
