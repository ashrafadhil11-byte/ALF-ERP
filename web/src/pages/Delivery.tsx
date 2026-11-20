// Delivery & POD — same page as admin/delivery.html: To dispatch (scan / select, send out with a driver or agent),
// Out for delivery and My run cards (call, chat, map, delivered / failed), proof of delivery (receiver, photo,
// signature, location), Done today and review requests. Data: GET/POST /api/delivery
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { Combobox, type ComboboxHandle } from '../components/fields/Combobox';
import { ScanInput } from '../components/fields/Scan';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { clean } from '../lib/format';
import { beep, toast } from '../lib/toast';
import './delivery.css';

const AGENTS = ['Aramex', 'SMSA Express', 'DHL Express', 'FedEx', 'UPS', 'India Post', 'Blue Dart', 'DTDC', 'Delhivery', 'Professional Couriers', 'Pakistan Post', 'TCS', 'Leopards', 'Sundarban Courier', 'Nepal Post', 'Naqel', 'Oman Post'];
type Tab = 'mine' | 'ready' | 'out' | 'done';
const fmtTime = (v?: string) => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const telLink = (p?: string) => String(p || '').replace(/[^\d+]/g, '');
const waNum = (p?: string) => String(p || '').replace(/\D/g, '');
const mapLink = (bk: any) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([bk.consignee_address, bk.dest_city, bk.dest_country].filter(Boolean).join(', '))}`;
const Pill = ({ code, label }: { code?: string; label?: string }) => {
    const cls = code === 'DELIVERY_FAILED' ? 'pill-coral' : code === 'READY_FOR_COLLECTION' ? 'pill-amber' : code === 'OUT_FOR_DELIVERY' ? 'pill-dark' : 'pill-gray';
    return <span className={`pill-tag ${cls}`}>{label || code}</span>;
};
function CloseX() {
    const dismiss = useDismiss();
    return <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>;
}
function CancelBtn() {
    const dismiss = useDismiss();
    return <button type="button" className="btn btn-light" onClick={dismiss}>Cancel</button>;
}

export function Delivery() {
    const [data, setData] = useState<any>({ ready: [], out: [], done: [], drivers: [], reasons: [], me: {} });
    const [mine, setMine] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [tab, setTab] = useState<Tab>('ready');
    const [q, setQ] = useState('');
    const pick = useRef<HTMLInputElement>(null);
    const dataRef = useRef(data); dataRef.current = data;

    useLive(() => load());   // reload when data changes (here, by Farah, another tab) — lib/live.ts
    async function load(): Promise<any> {
        let d = dataRef.current, m = mine;
        try {
            d = await api('/api/delivery');
            if (d.me?.is_driver) m = (await api('/api/delivery?mine=1')).out || [];
        } catch (e) { toast(false, (e as Error).message); }
        setData(d); setMine(m); setLoaded(true);
        setSel(s => new Set([...s].filter(a => d.ready.some((r: any) => r.awb === a))));
        return d;
    }
    useEffect(() => { load().then(d => { if (d.me?.is_driver && d.me.role === 'staff') setTab('mine'); }); /* eslint-disable-next-line */ }, []);

    const ql = q.trim().toLowerCase();
    const rows = data.ready.filter((b: any) => !ql || [b.awb, b.consignee, b.dest_city, b.dest_country].some(v => String(v || '').toLowerCase().includes(ql)));
    const counts: Record<string, number> = { ready: data.ready.length, out: data.out.length, done: data.done.length, mine: mine.length };
    const cnt = (k: string) => counts[k] ? `· ${counts[k]}` : '';

    const submitPick = (e: React.FormEvent) => {
        e.preventDefault();
        const v = clean(pick.current!.value);
        const hit = data.ready.find((b: any) => b.awb === v);
        if (hit) { setSel(s => new Set(s).add(hit.awb)); beep(true); pick.current!.value = ''; setQ(''); toast(true, `${hit.awb} selected`); }
        else if (data.out.some((d: any) => d.awb === v)) toast(false, `${v} is already out for delivery.`);
        else if (v) toast(false, `${v} is not waiting for delivery here.`);
    };
    const toggle = (awb: string, on: boolean) => setSel(s => { const x = new Set(s); if (on) x.add(awb); else x.delete(awb); return x; });
    const selAll = (on: boolean) => setSel(s => {
        const x = new Set(s);
        data.ready.filter((b: any) => !ql || [b.awb, b.consignee, b.dest_city].some(v => String(v || '').toLowerCase().includes(ql))).forEach((b: any) => on ? x.add(b.awb) : x.delete(b.awb));
        return x;
    });

    // ---------- dispatch ----------
    const [dOpen, setDOpen] = useState(false);
    const [mode, setMode] = useState<'driver' | 'agent'>('driver');
    const [driver, setDriver] = useState('');
    const [ref, setRef] = useState('');
    const [dBusy, setDBusy] = useState(false);
    const agent = useRef<ComboboxHandle>(null);
    const openDispatch = () => { setMode(data.drivers.length ? 'driver' : 'agent'); setDOpen(true); };
    const dispatch = async (e: React.FormEvent) => {
        e.preventDefault();
        const body = { action: 'dispatch', awbs: [...sel], mode, driver_id: driver, agent_name: (agent.current?.text || '').trim(), agent_ref: ref.trim() };
        if (mode === 'driver' && !body.driver_id) return toast(false, 'Choose the driver.');
        if (mode === 'agent' && !body.agent_name) return toast(false, 'Enter the delivery agent.');
        setDBusy(true);
        try {
            const r = await api<{ dispatched: number }>('/api/delivery', { method: 'POST', body });
            toast(true, `${r.dispatched} shipment${r.dispatched === 1 ? '' : 's'} out for delivery.`);
            setSel(new Set()); setDOpen(false); setRef('');
            setTab('out'); await load();
        } catch (err) { toast(false, (err as Error).message); }
        setDBusy(false);
    };

    // ---------- POD ----------
    const [pOpen, setPOpen] = useState(false);
    const [outcome, setOutcome] = useState<'delivered' | 'failed'>('delivered');
    const [pod, setPod] = useState<{ awb: string; consignee?: string; whatsapp?: string; sub: string; collection: boolean } | null>(null);
    const [pf, setPf] = useState({ rcv: '', rel: 'Self', idNo: '', reason: '', notes: '' });
    const [photo, setPhoto] = useState<string | null>(null);
    const [pBusy, setPBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const pad = useRef<HTMLCanvasElement>(null);
    const sig = useRef({ drawing: false, signed: false });
    const sizeSig = () => {
        const c = pad.current; if (!c) return;
        const r = c.getBoundingClientRect(); if (!r.width) return;
        const d = window.devicePixelRatio || 1, ctx = c.getContext('2d')!;
        c.width = r.width * d; c.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'; sig.current.signed = false;
    };
    useLayoutEffect(() => { if (pOpen) setTimeout(sizeSig, 0); }, [pOpen, outcome]);
    useEffect(() => { const r = () => { if (pOpen) sizeSig(); }; window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, [pOpen]);
    const pt = (e: React.PointerEvent) => { const r = pad.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };

    const openPod = (awb: string, o: 'delivered' | 'failed', collection = false) => {
        const d = [...data.out, ...mine].find((x: any) => x.awb === awb);
        const bk = d?.bookings || data.ready.find((b: any) => b.awb === awb) || {};
        setPod({ awb, consignee: bk.consignee, whatsapp: bk.receiver_whatsapp || bk.consignee_phone, sub: `${awb} · ${bk.consignee || ''}${collection ? ' · collected at branch' : ''}`, collection });
        setPf({ rcv: bk.consignee || '', rel: 'Self', idNo: '', reason: data.reasons?.[0] || '', notes: '' });
        setPhoto(null); if (fileRef.current) fileRef.current.value = '';
        setOutcome(o); setPOpen(true);
    };
    // photo → resized JPEG (max 1280px) so uploads stay small on mobile data
    const onPhoto = async () => {
        const f = fileRef.current?.files?.[0]; if (!f) return;
        try {
            const img = await createImageBitmap(f);
            const s = Math.min(1, 1280 / Math.max(img.width, img.height));
            const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
            setPhoto(c.toDataURL('image/jpeg', 0.72));
        } catch { toast(false, 'Could not read that photo.'); }
    };
    const position = () => new Promise<{ lat?: number; lng?: number }>(res => {
        if (!navigator.geolocation) return res({});
        navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res({}), { timeout: 4000, maximumAge: 60000 });
    });
    const savePod = async (e: React.FormEvent) => {
        e.preventDefault();
        if (outcome === 'delivered' && !pf.rcv.trim()) return toast(false, 'Enter who received the shipment.');
        setPBusy(true);
        try {
            const geo = await position();
            const body = { action: 'complete', awb: pod!.awb, outcome, received_by: pf.rcv.trim(), relation: pf.rel, id_no: pf.idNo.trim(), reason: pf.reason, notes: pf.notes.trim(),
                photo, signature: outcome === 'delivered' && sig.current.signed ? pad.current!.toDataURL('image/png') : null, ...geo };
            const r = await api<{ awb: string; attempt?: number; review_token?: string }>('/api/delivery', { method: 'POST', body });
            setPOpen(false);
            toast(true, outcome === 'delivered' ? `${r.awb} delivered.` : `${r.awb}: attempt ${r.attempt} failed — it is back in “To dispatch”.`);
            await load();
            if (r.review_token) openReview(r.awb, r.review_token, pod!.whatsapp, pod!.consignee);
        } catch (err) { toast(false, (err as Error).message); }
        setPBusy(false);
    };

    // ---------- review request ----------
    const [rOpen, setROpen] = useState(false);
    const [rv, setRv] = useState<{ awb: string; link: string; msg: string; n: string; name?: string } | null>(null);
    function openReview(awb: string, token: string, phone?: string, name?: string) {
        const link = `${location.origin}/track.html?awb=${encodeURIComponent(awb)}&r=${token}`;
        const msg = `Hello${name ? ' ' + name : ''}, your Al-Farha Cargo shipment ${awb} has been delivered. We'd love your feedback — please rate us here: ${link}`;
        setRv({ awb, link, msg, n: waNum(phone), name }); setROpen(true);
    }
    const sent = (channel: string) => api('/api/delivery', { method: 'POST', body: { action: 'review_sent', awb: rv!.awb, channel } }).catch(() => {});

    const cards = (list: any[]) => list.map((d: any) => {
        const bk = d.bookings || {};
        const who = d.mode === 'agent' ? `${d.agent_name}${d.agent_ref ? ` · ${d.agent_ref}` : ''}` : d.driver_name;
        const phone = bk.consignee_phone, wa = bk.receiver_whatsapp || phone;
        return (
            <article key={d.awb} className="bg-[#F8F8FA] rounded-[2rem] p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                    <div><p className="font-extrabold font-mono text-sm">{d.awb}</p><p className="text-[10px] text-gray-400 font-bold">{`${d.attempt > 1 ? `Attempt ${d.attempt} · ` : ''}${d.mode === 'agent' ? 'Agent' : 'Driver'}: ${who || '—'}`}</p></div>
                    <span className="pill-tag pill-dark">{`${bk.pieces || 1} pc · ${bk.weight || 0} kg`}</span>
                </div>
                <div className="bg-white rounded-2xl p-3 text-xs space-y-1.5">
                    <p className="font-extrabold">{bk.consignee || '—'}</p>
                    <p className="text-gray-500">{[bk.consignee_address, bk.dest_city].filter(Boolean).join(', ') || '—'}</p>
                    {bk.amount && /credit|cod|cash on/i.test(bk.payment_method || '') ? <p className="text-[#D55C48] font-bold">{`Collect: ${bk.amount}`}</p> : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {phone ? <a className="btn btn-light btn-sm" href={`tel:${telLink(phone)}`}><Icon name="phone" />Call</a> : <span></span>}
                    {wa ? <a className="btn btn-light btn-sm" target="_blank" rel="noopener" href={`https://wa.me/${waNum(wa)}`}><Icon name="message" />Chat</a> : <span></span>}
                    <a className="btn btn-light btn-sm" target="_blank" rel="noopener" href={mapLink(bk)}><Icon name="pin" />Map</a>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-dark" data-pod={d.awb} data-outcome="delivered" onClick={() => openPod(d.awb, 'delivered')}><Icon name="checkCircle" />Delivered</button>
                    <button type="button" className="btn btn-light !text-[#D55C48]" data-pod={d.awb} data-outcome="failed" onClick={() => openPod(d.awb, 'failed')}><Icon name="alert" />Failed</button>
                </div>
            </article>
        );
    });
    const empty = (t: string) => <p className="col-span-full p-10 text-center text-xs text-gray-400 bg-[#F8F8FA] rounded-[2rem]">{t}</p>;
    const del = outcome === 'delivered';

    const popups = <>
        <Modal id="dispatchModal" open={dOpen} onClose={() => setDOpen(false)} panelClassName="max-w-lg" form={{ id: 'dispatchForm', onSubmit: dispatch }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 className="text-lg font-extrabold">Send out for delivery</h3><p id="dSub" className="text-xs text-gray-400 mt-0.5">{dOpen ? `${sel.size} shipment${sel.size === 1 ? '' : 's'}: ${[...sel].slice(0, 6).join(', ')}${sel.size > 6 ? '…' : ''}` : ''}</p></div>
                <CloseX />
            </div>
            <div className="space-y-4 my-5 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full">
                    <button type="button" className="opt py-2 rounded-full text-xs font-extrabold" data-mode="driver" aria-pressed={mode === 'driver'} onClick={() => setMode('driver')}>Our driver</button>
                    <button type="button" className="opt py-2 rounded-full text-xs font-extrabold" data-mode="agent" aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>Delivery agent (3rd party)</button>
                </div>
                <div data-for="driver" className={mode === 'driver' ? '' : 'hidden'}><label className="ui-label" htmlFor="dDriver">Driver <span className="req">*</span></label>
                    <select id="dDriver" className="field" value={driver} onChange={e => setDriver(e.target.value)}>
                        {loaded && <><option value="">Choose driver…</option>{data.drivers.map((d: any) => <option key={d.id} value={d.id}>{d.full_name + (d.branch ? ` · ${d.branch}` : '')}</option>)}</>}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">Drivers are staff with “Driver” ticked in Staff &amp; Users.</p></div>
                <div data-for="agent" className={`${mode === 'agent' ? '' : 'hidden '}grid grid-cols-1 sm:grid-cols-2 gap-4`}>
                    <div><label className="ui-label" htmlFor="dAgent">Agent <span className="req">*</span></label><Combobox ref={agent} load={() => AGENTS.map(a => ({ value: a, label: a }))} allowCustom inputProps={{ id: 'dAgent', className: 'field', placeholder: 'Select or type' }} /></div>
                    <div><label className="ui-label" htmlFor="dRef">Their tracking / docket no.</label><input id="dRef" className="field" placeholder="Optional" value={ref} onChange={e => setRef(e.target.value)} /></div>
                </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <CancelBtn />
                <button id="dispatchBtn" className="btn btn-dark" disabled={dBusy}><Icon name="truck" />Send out</button>
            </div>
        </Modal>

        <Modal id="podModal" open={pOpen} onClose={() => setPOpen(false)} panelClassName="max-w-lg" form={{ id: 'podForm', onSubmit: savePod }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 id="pTitle" className="text-lg font-extrabold">{del ? 'Proof of delivery' : 'Delivery attempt failed'}</h3><p id="pSub" className="text-xs text-gray-400 mt-0.5">{pod?.sub || ''}</p></div>
                <CloseX />
            </div>
            <div className="space-y-4 my-5 overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-2 gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full">
                    <button type="button" className="opt py-2 rounded-full text-xs font-extrabold" data-outcome="delivered" aria-pressed={del} onClick={() => setOutcome('delivered')}>Delivered</button>
                    <button type="button" className="opt py-2 rounded-full text-xs font-extrabold" data-outcome="failed" aria-pressed={!del} disabled={!!pod?.collection} onClick={() => setOutcome('failed')}>Not delivered</button>
                </div>
                <div data-out="delivered" className={`${del ? '' : 'hidden '}grid grid-cols-1 sm:grid-cols-2 gap-4`}>
                    <div><label className="ui-label" htmlFor="pRcv">Received by <span className="req">*</span></label><input id="pRcv" className="field" value={pf.rcv} onChange={e => setPf({ ...pf, rcv: e.target.value })} /></div>
                    <div><label className="ui-label" htmlFor="pRel">Relation</label>
                        <select id="pRel" className="field" value={pf.rel} onChange={e => setPf({ ...pf, rel: e.target.value })}><option>Self</option><option>Family member</option><option>Neighbour</option><option>Security / reception</option><option>Colleague</option><option>Other</option></select></div>
                    <div className="sm:col-span-2"><label className="ui-label" htmlFor="pIdNo">Receiver ID no.</label><input id="pIdNo" className="field" placeholder="Optional" value={pf.idNo} onChange={e => setPf({ ...pf, idNo: e.target.value })} /></div>
                </div>
                <div data-out="failed" className={del ? 'hidden' : ''}><label className="ui-label" htmlFor="pReason">Reason <span className="req">*</span></label>
                    <select id="pReason" className="field" value={pf.reason} onChange={e => setPf({ ...pf, reason: e.target.value })}>{(data.reasons || []).map((r: string) => <option key={r}>{r}</option>)}</select></div>
                <div>
                    <label className="ui-label">Photo <span id="photoHint" className="text-gray-400 font-medium normal-case">{del ? '(parcel at the door / with receiver)' : '(door / location — optional)'}</span></label>
                    <label className="flex items-center gap-3 bg-[#F8F8FA] border border-dashed border-gray-300 rounded-2xl p-3 cursor-pointer hover:border-[#E86D58]">
                        <img id="photoPrev" alt="" src={photo || undefined} className={`${photo ? '' : 'hidden '}w-16 h-16 object-cover rounded-xl`} />
                        <span id="photoPh" className={`${photo ? 'hidden ' : ''}w-16 h-16 rounded-xl bg-white flex items-center justify-center text-gray-400`}><Icon name="camera" /></span>
                        <span className="text-xs font-bold text-gray-600">Take or choose a photo</span>
                        <input id="pPhoto" ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
                    </label>
                </div>
                <div data-out="delivered" className={del ? '' : 'hidden'}>
                    <div className="flex items-center justify-between"><label className="ui-label">Receiver signature</label><button type="button" id="sigClear" className="text-[11px] font-bold text-[#D55C48]" onClick={sizeSig}>Clear</button></div>
                    <canvas id="sigPad" ref={pad} className="w-full h-36 bg-[#F8F8FA] border border-gray-200 rounded-2xl" aria-label="Signature pad"
                        onPointerDown={(e) => { sig.current.drawing = true; pad.current!.setPointerCapture(e.pointerId); const ctx = pad.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(...pt(e)); }}
                        onPointerMove={(e) => { if (!sig.current.drawing) return; const ctx = pad.current!.getContext('2d')!; ctx.lineTo(...pt(e)); ctx.stroke(); sig.current.signed = true; }}
                        onPointerUp={() => { sig.current.drawing = false; }} onPointerCancel={() => { sig.current.drawing = false; }} />
                </div>
                <div><label className="ui-label" htmlFor="pNotes">Notes</label><textarea id="pNotes" rows={2} className="field" placeholder="Optional" value={pf.notes} onChange={e => setPf({ ...pf, notes: e.target.value })}></textarea></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <CancelBtn />
                <button id="podBtn" className="btn btn-dark" disabled={pBusy}><Icon name="checkCircle" />{pBusy ? 'Saving…' : 'Save'}</button>
            </div>
        </Modal>

        <Modal id="reviewModal" open={rOpen} onClose={() => setROpen(false)} panelClassName="max-w-md">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 className="text-lg font-extrabold">Ask for a review</h3><p id="rSub" className="text-xs text-gray-400 mt-0.5">{rv ? `${rv.awb}${rv.name ? ' · ' + rv.name : ''}` : ''}</p></div>
                <CloseX />
            </div>
            <div className="my-5 space-y-3">
                <p className="text-xs text-gray-500">Send the customer their tracking page with a 1–5 star review form.</p>
                <input id="rLink" className="field text-xs" readOnly aria-label="Review link" value={rv?.link || ''} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <a id="rWa" target="_blank" rel="noopener" className={`btn btn-coral${rv && !rv.n ? ' hidden' : ''}`} href={rv ? `https://wa.me/${rv.n}?text=${encodeURIComponent(rv.msg)}` : undefined} onClick={() => sent('whatsapp')}><Icon name="message" />WhatsApp</a>
                    <a id="rMail" className="btn btn-light" href={rv ? `mailto:?subject=${encodeURIComponent(`How was your delivery? (${rv.awb})`)}&body=${encodeURIComponent(rv.msg)}` : undefined} onClick={() => sent('email')}><Icon name="link" />Email</a>
                    <button id="rCopy" type="button" className="btn btn-light" onClick={async () => { try { await navigator.clipboard.writeText(rv!.link); toast(true, 'Link copied.'); sent('link'); } catch { (document.getElementById('rLink') as HTMLInputElement).select(); } }}><Icon name="copy" />Copy</button>
                </div>
            </div>
        </Modal>
    </>;

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="truck" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Delivery &amp; POD</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Send out • proof of delivery • failed attempts • reviews</p>
                        </div>
                    </div>
                    <button id="reloadBtn" type="button" className="btn btn-light self-start sm:self-auto" onClick={() => load()}><Icon name="refresh" />Refresh</button>
                </section>

                <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    <div className="bg-[#F8F8FA] rounded-[1.5rem] p-4"><p className="text-[10px] font-extrabold text-gray-400 uppercase">Ready to deliver</p><p id="kReady" className="text-2xl font-extrabold mt-1">{loaded ? data.ready.length : '—'}</p></div>
                    <div className="bg-[#F8F8FA] rounded-[1.5rem] p-4"><p className="text-[10px] font-extrabold text-gray-400 uppercase">Out for delivery</p><p id="kOut" className="text-2xl font-extrabold mt-1">{loaded ? data.out.length : '—'}</p></div>
                    <div className="bg-emerald-50 rounded-[1.5rem] p-4"><p className="text-[10px] font-extrabold text-emerald-600 uppercase">Delivered today</p><p id="kDone" className="text-2xl font-extrabold mt-1 text-emerald-700">{loaded ? data.done.filter((d: any) => d.status === 'delivered').length : '—'}</p></div>
                    <div className="bg-[#FFF5F3] rounded-[1.5rem] p-4"><p className="text-[10px] font-extrabold text-[#D55C48] uppercase">Failed today</p><p id="kFail" className="text-2xl font-extrabold mt-1 text-[#D55C48]">{loaded ? data.done.filter((d: any) => d.status === 'failed').length : '—'}</p></div>
                </section>

                <div className="flex flex-wrap gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full w-fit mb-5" role="tablist">
                    {([['mine', 'My run'], ['ready', 'To dispatch'], ['out', 'Out for delivery'], ['done', 'Done today']] as [Tab, string][]).map(([k, label]) => (
                        <button key={k} type="button" className={`tab px-4 py-2 rounded-full text-xs font-extrabold${k === 'mine' && !data.me?.is_driver ? ' hidden' : ''}`} data-tab={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label + ' '}<span data-count={k}>{cnt(k)}</span></button>
                    ))}
                </div>

                <section data-panel="ready" className={`${tab === 'ready' ? '' : 'hidden '}space-y-4`}>
                    <form id="pickForm" className="flex flex-col sm:flex-row gap-2" onSubmit={submitPick}>
                        <ScanInput ref={pick} mode="submit" continuous inputProps={{ id: 'pickInput', className: 'field scan', placeholder: 'Scan AWB to select it, or search name / city', autoComplete: 'off', 'aria-label': 'Scan or search', onInput: (e) => setQ((e.target as HTMLInputElement).value) }} />
                        <button className="btn btn-dark">Select</button>
                    </form>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                        <table className="rtable w-full text-xs">
                            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                <th className="p-3 pl-4 w-10"><input id="selAll" type="checkbox" className="w-4 h-4" aria-label="Select all" checked={rows.length > 0 && rows.every((b: any) => sel.has(b.awb))} onChange={e => selAll(e.target.checked)} /></th>
                                <th className="p-3 font-extrabold">AWB</th><th className="p-3 font-extrabold">Receiver</th><th className="p-3 font-extrabold">Destination</th>
                                <th className="p-3 font-extrabold">Status</th><th className="p-3 font-extrabold text-right pr-4">Action</th>
                            </tr></thead>
                            <tbody id="readyRows" className="divide-y divide-gray-100">
                                {!loaded ? null : rows.length ? rows.map((b: any) => (
                                    <tr key={b.awb} className={sel.has(b.awb) ? 'bg-[#FFF5F3]' : ''}>
                                        <td className="p-3 pl-4" data-label=""><input type="checkbox" className="w-4 h-4" data-sel={b.awb} checked={sel.has(b.awb)} aria-label={`Select ${b.awb}`} onChange={e => toggle(b.awb, e.target.checked)} /></td>
                                        <td className="p-3 font-extrabold font-mono" data-label="AWB">{b.awb}</td>
                                        <td className="p-3" data-label="Receiver"><span className="font-bold">{b.consignee || '—'}</span><span className="block text-[10px] text-gray-400">{b.consignee_phone || ''}</span></td>
                                        <td className="p-3" data-label="Destination">{[b.dest_city, b.dest_country].filter(Boolean).join(', ') || '—'}</td>
                                        <td className="p-3" data-label="Status"><Pill code={b.current_status_code} label={b.current_status} /></td>
                                        <td className="p-3 pr-4 text-right" data-label=""><button type="button" className="btn btn-light btn-sm" data-collect={b.awb} onClick={() => openPod(b.awb, 'delivered', true)}><Icon name="userCheck" />Collected</button></td>
                                    </tr>
                                )) : <tr><td colSpan={6} className="p-8 text-center text-gray-400">{ql ? 'No match.' : 'Nothing waiting for delivery.'}</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section data-panel="out" className={tab === 'out' ? '' : 'hidden'}><div id="outCards" className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">{loaded && (data.out.length ? cards(data.out) : empty('No shipments are out for delivery.'))}</div></section>
                <section data-panel="mine" className={tab === 'mine' ? '' : 'hidden'}><div id="mineCards" className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">{loaded && (mine.length ? cards(mine) : empty('Nothing assigned to you right now.'))}</div></section>

                <section data-panel="done" className={tab === 'done' ? '' : 'hidden'}>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                        <table className="rtable w-full text-xs">
                            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                <th className="p-3 pl-4 font-extrabold">AWB</th><th className="p-3 font-extrabold">Result</th><th className="p-3 font-extrabold">By</th>
                                <th className="p-3 font-extrabold">Received by / reason</th><th className="p-3 font-extrabold">Time</th><th className="p-3 font-extrabold text-right pr-4">Review</th>
                            </tr></thead>
                            <tbody id="doneRows" className="divide-y divide-gray-100">
                                {!loaded ? null : data.done.length ? data.done.map((d: any) => (
                                    <tr key={d.awb + d.attempt}>
                                        <td className="p-3 pl-4 font-extrabold font-mono" data-label="AWB">{d.awb}{d.attempt > 1 && <span className="block text-[10px] text-gray-400 font-sans">{`Attempt ${d.attempt}`}</span>}</td>
                                        <td className="p-3" data-label="Result">{d.status === 'delivered' ? <span className="pill-tag pill-green">Delivered</span> : <span className="pill-tag pill-coral">Failed</span>}</td>
                                        <td className="p-3" data-label="By">{d.mode === 'collection' ? 'Collected at branch' : d.driver_name || d.agent_name || '—'}</td>
                                        <td className="p-3" data-label="Detail">{(d.received_by || d.failure_reason || '—') + ' '}{d.pod_photo && <Icon name="camera" cls="w-3.5 h-3.5 inline text-gray-400" />}{' '}{d.pod_signature && <Icon name="edit" cls="w-3.5 h-3.5 inline text-gray-400" />}</td>
                                        <td className="p-3" data-label="Time">{fmtTime(d.completed_at)}</td>
                                        <td className="p-3 pr-4 text-right" data-label="">{d.status === 'delivered' && d.bookings?.review_token && <button type="button" className="btn btn-light btn-sm" data-review={d.awb}
                                            onClick={() => openReview(d.awb, d.bookings.review_token, d.bookings.receiver_whatsapp || d.bookings.consignee_phone, d.bookings.consignee)}><Icon name="star" />{d.bookings?.reviewed_at ? 'Reviewed' : 'Send'}</button>}</td>
                                    </tr>
                                )) : <tr><td colSpan={6} className="p-8 text-center text-gray-400">No deliveries completed today yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            <div id="selBar" className={`${sel.size && tab === 'ready' ? '' : 'hidden '}absolute left-4 right-4 bottom-20 lg:bottom-6 z-20 bg-[#111827] text-white rounded-full shadow-2xl p-2 pl-5 flex items-center justify-between gap-3`}>
                <span className="text-xs font-extrabold"><span id="selCount">{sel.size}</span> selected</span>
                <div className="flex gap-2">
                    <button id="selClear" type="button" className="btn btn-sm !bg-white/10 !text-white" onClick={() => setSel(new Set())}>Clear</button>
                    <button id="selSend" type="button" className="btn btn-coral btn-sm" onClick={openDispatch}><Icon name="truck" />Send out</button>
                </div>
            </div>
        </AppFrame>
    );
}
