// Consolidation & Bulk — same page as admin/consolidation.html: Outbound (scan / select held shipments, manifest to
// another branch), Inbound (scan arrivals, receive all, box checks), MAWB / container / bag (create, add shipments,
// bulk or single status update, costs split per shipment, close / reopen, print manifest).
// Data: /api/transfers, /api/consolidation, /api/status, /api/accounts (parties, cost_bill)
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { Combobox, type ComboboxHandle } from '../components/fields/Combobox';
import { ScanInput } from '../components/fields/Scan';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { confirm } from '../lib/dialogs';
import { clean } from '../lib/format';
import { countryItems } from '../lib/geo';
import { printManifest } from '../lib/manifest';
import { ManifestExport } from '../components/ManifestExport';
import { pickBoxes } from '../lib/pickBoxes';
import { session } from '../lib/session';
import { beep, toast } from '../lib/toast';
import './consolidation.css';

type Tab = 'outbound' | 'inbound' | 'mawb';
const fmt = (v?: string) => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const KIND_NAME: Record<string, string> = { mawb: 'MAWB', bag: 'Bag', container: 'Container' };
const RESULT: Record<string, [boolean, string]> = {
    received: [true, 'Received'], received_short: [true, 'Received — boxes missing'], no_boxes: [false, 'No boxes ticked'], already_here: [false, 'Already at this branch'], not_found: [false, 'AWB not found'],
    not_expected: [false, 'Not on any manifest to this branch'], wrong_branch: [false, 'Going to another branch']
};

function CloseX() {
    const dismiss = useDismiss();
    return <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>;
}
function CancelBtn() {
    const dismiss = useDismiss();
    return <button type="button" className="btn btn-light" onClick={dismiss}>Cancel</button>;
}

export function Consolidation() {
    const [params, setParams] = useSearchParams();
    const [tab, setTabState] = useState<Tab>(() => { const t = params.get('tab') as Tab; return ['outbound', 'inbound', 'mawb'].includes(t) ? t : 'outbound'; });
    const [fade, setFade] = useState(0);
    const showTab = (t: Tab) => { setTabState(t); setFade(n => n + 1); setParams({ tab: t }, { replace: true }); };
    const [T, setT] = useState<any>({ held: [], incoming: [], outgoing: [], branches: [] });
    const [actBranch, setActBranch] = useState('');
    const [cons, setCons] = useState<any[] | null>(null);
    const [statuses, setStatuses] = useState<any[]>([]);
    const [agents, setAgents] = useState<string[] | null>(null);
    const [cfilter, setCfilter] = useState('open');
    const [batch, setBatch] = useState<Set<string>>(new Set());
    const [obPieces, setObPieces] = useState<Record<string, number[]>>({});
    const [obFilter, setObFilter] = useState('');
    const [ob, setOb] = useState({ to: '', vehicle: '', driver: '', seal: '', notes: '' });
    const [obBusy, setObBusy] = useState(false);
    const [ibNote, setIbNote] = useState('');
    const [ibLast, setIbLast] = useState<{ k: number; awb: string; ok: boolean; text: string }[]>([]);
    const ibKey = useRef(0);
    const obInput = useRef<HTMLInputElement>(null), ibInput = useRef<HTMLInputElement>(null), dInput = useRef<HTMLInputElement>(null);
    const bname = (c?: string) => (T.branches.find((b: any) => b.branch_code === c) || {}).branch_name || c;

    useLive(() => { loadCons(); loadTransfers(); });   // reload when data changes (here, by Farah, another tab) — lib/live.ts
    async function loadTransfers(want = actBranch) {
        let d: any;
        try { d = await api('/api/transfers' + (want ? `?branch=${encodeURIComponent(want)}` : '')); } catch (e) { toast(false, (e as Error).message); return; }
        setT(d); setActBranch(d.branch);
        setBatch(b => new Set([...b].filter(a => d.held.some((h: any) => h.awb === a))));
    }
    async function loadCons() {
        try { setCons((await api('/api/consolidation')).consolidations); } catch (e) { toast(false, (e as Error).message); }
    }
    async function loadStatuses() {
        try { const st = await api('/api/status'); setStatuses(st.statuses); setAgents([...(st.agents || []).map((x: any) => x.name), 'SMSA', 'Aramex', 'DHL', 'FedEx', 'UPS']); }
        catch { setStatuses([]); }
    }
    useEffect(() => { loadTransfers(''); loadCons(); loadStatuses(); /* eslint-disable-next-line */ }, []);
    const pendingIn = T.incoming.reduce((s: number, m: any) => s + m.transfers.filter((t: any) => t.status === 'pending').length, 0);
    const openCons = (cons || []).filter(c => !c.closed).length;

    // ---------- outbound ----------
    async function addOutbound(awb: string) {
        const h = T.held.find((x: any) => x.awb === awb);
        const here = (x: any) => x && x.boxes && x.boxes.length < +x.boxes_total ? x.boxes : null;   // only the boxes at this branch
        if (h && +h.pieces > 1) {
            const pick = await pickBoxes(awb, { title: 'Boxes to send', confirmText: 'Add', only: here(h) });
            if (!pick) return false;
            setObPieces(p => { const x = { ...p }; if (pick.pieces) x[awb] = pick.pieces; else delete x[awb]; return x; });
        }
        setBatch(b => new Set(b).add(awb)); return true;
    }
    const reBoxOut = async (awb: string) => {
        const h = T.held.find((x: any) => x.awb === awb);
        const pick = await pickBoxes(awb, { title: 'Boxes to send', confirmText: 'Save', only: h && h.boxes && h.boxes.length < +h.boxes_total ? h.boxes : null });
        if (pick) setObPieces(p => { const x = { ...p }; if (pick.pieces) x[awb] = pick.pieces; else delete x[awb]; return x; });
    };
    const q = obFilter.trim().toLowerCase();
    const obRows = T.held.filter((b: any) => !q || [b.awb, b.consignee, b.dest_city, b.dest_country].some(v => String(v || '').toLowerCase().includes(q)));
    const obScan = async (e: React.FormEvent) => {
        e.preventDefault();
        const a = clean(obInput.current!.value); obInput.current!.value = '';
        if (!a) return;
        if (T.held.some((h: any) => h.awb === a)) { if (await addOutbound(a)) { beep(true); toast(true, `${a} added`); } }
        else { beep(false); toast(false, `${a} is not held at ${bname(T.branch)} (or is already in transit).`); }
    };
    const obSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ob.to) return toast(false, 'Choose the branch to send to.');
        if (!await confirm({ title: `Send ${batch.size} shipment(s) to ${bname(ob.to)}?`, message: 'A transfer manifest is created. The receiving branch scans them in on arrival.', confirmText: 'Send' })) return;
        setObBusy(true);
        try {
            const r = await api('/api/transfers', { method: 'POST', body: { action: 'outbound', branch: T.branch, awbs: [...batch], pieces: Object.fromEntries([...batch].filter(a => obPieces[a]).map(a => [a, obPieces[a]])), to_branch: ob.to, vehicle: ob.vehicle, driver: ob.driver, seal: ob.seal, notes: ob.notes } });
            toast(true, `${r.manifest_no}: ${r.count} shipment(s) sent.`);
            setBatch(new Set()); setObPieces({}); setOb(o => ({ ...o, vehicle: '', driver: '', seal: '', notes: '' }));
            await loadTransfers();
            printTransfer(r.id);
        } catch (err) { toast(false, (err as Error).message); }
        setObBusy(false);
    };

    // ---------- inbound ----------
    async function receive(awbs: string[], pieces: Record<string, number[]> = {}) {
        try {
            const r = await api('/api/transfers', { method: 'POST', body: { action: 'inbound', branch: T.branch, awbs, pieces, note: ibNote } });
            const lines = r.results.map((x: any) => {
                const [ok, label] = RESULT[x.result] || [false, x.result];
                beep(ok);
                if (x.result === 'received_short') toast(false, `${x.awb}: box ${x.missing.join(', ')} not received — recorded as missing.`);
                return { k: ++ibKey.current, awb: x.awb, ok, text: label + (x.result === 'wrong_branch' && x.to_branch ? ' (' + bname(x.to_branch) + ')' : '') + (x.missing ? ': box ' + x.missing.join(', ') : '') };
            });
            setIbLast(l => [...lines.reverse(), ...l]);
            const got = r.results.filter((x: any) => x.result === 'received' || x.result === 'received_short').length;
            if (awbs.length > 1) toast(got > 0, `${got} of ${awbs.length} received.`);
            await loadTransfers();
        } catch (err) { beep(false); toast(false, (err as Error).message); }
    }
    // scanned / typed AWB: show the boxes that were sent, all ticked; untick what did not arrive
    const ibScan = async (e: React.FormEvent) => {
        e.preventDefault();
        const a = clean(ibInput.current!.value); ibInput.current!.value = '';
        if (!a) return;
        const t = T.incoming.flatMap((m: any) => m.transfers).find((x: any) => x.status === 'pending' && x.bookings?.awb === a);
        const sent: number[] | null = t ? (t.pieces || (+t.bookings.pieces > 1 ? Array.from({ length: +t.bookings.pieces }, (_, i) => i + 1) : null)) : null;
        if (sent && sent.length > 1) {
            const pick = await pickBoxes(a, { title: 'Boxes that arrived', confirmText: 'Receive', only: sent });
            if (!pick) return;
            const got = pick.pieces || sent;
            return receive([a], got.length < sent.length ? { [a]: got } : {});
        }
        receive([a]);
    };
    const receiveAll = async (m: any) => {
        const left = m.transfers.filter((t: any) => t.status === 'pending').map((t: any) => t.bookings.awb);
        if (await confirm({ title: `Receive all ${left.length} on ${m.manifest_no}?`, message: 'Only do this after counting the boxes. Scanning each one is safer.', confirmText: 'Receive all' })) receive(left);
    };

    // ---------- new consolidation ----------
    const [cOpen, setCOpen] = useState(false);
    const [kind, setKind] = useState('mawb');
    const blankC = { no: '', carrier: '', flight: '', size: '20GP', seal: '', voy: '', bl: '', eta: '', date: '', notes: '' };
    const [cf, setCf] = useState(blankC);
    const cDest = useRef<ComboboxHandle>(null);
    const setC = (k: keyof typeof cf) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCf(v => ({ ...v, [k]: e.target.value }));
    const createCons = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const r = await api('/api/consolidation', { method: 'POST', body: { action: 'create', kind, mawb: cf.no, carrier: cf.carrier, flight_no: cf.flight, departure_date: cf.date || null, dest_country: cDest.current?.text || '', notes: cf.notes,
                ...(kind === 'container' ? { container_size: cf.size, seal_no: cf.seal, vessel: cf.flight, voyage: cf.voy, bl_no: cf.bl, eta: cf.eta || null } : {}) } });
            setCOpen(false); toast(true, `${r.consolidation.mawb} created — scan shipments into it.`);
            await loadCons(); openDetail(r.consolidation.id);
        } catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- detail ----------
    const [detail, setDetail] = useState<any>(null);
    const detailRef = useRef<any>(null); detailRef.current = detail;
    const [dOpen, setDOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bTarget, setBTarget] = useState(''), [bTicks, setBTicks] = useState<number[]>([]);
    const [bStatus, setBStatus] = useState('');
    const [bf, setBf] = useState({ agent: '', docket: '', loc: '', remark: '' });
    const bulkRef = useRef<HTMLDetailsElement>(null);
    async function openDetail(id: number | string, keepOpen = false) {
        let d: any;
        try { d = await api(`/api/consolidation?id=${encodeURIComponent(id)}`); } catch (e) { return toast(false, (e as Error).message); }
        d.costs = d.costs || []; d.allocation = d.allocation || [];
        setDetail(d); setBTarget(''); setBTicks([]);
        if (!keepOpen) { setDOpen(true); setTimeout(() => !d.consolidation.closed && dInput.current?.focus(), 50); }
    }
    const dScan = async (e: React.FormEvent) => {
        e.preventDefault();
        const list = clean(dInput.current!.value).split(/[,\s]+/).filter(Boolean); dInput.current!.value = '';
        if (!list.length) return;
        const d = detailRef.current, awbs: string[] = [], pieces: Record<string, number[]> = {};
        for (const a of list) {
            const pick = await pickBoxes(a, { title: `Add to ${d.consolidation.mawb}`, confirmText: 'Add boxes' });
            if (!pick) continue;
            awbs.push(pick.awb);
            if (pick.pieces) pieces[pick.awb] = pick.pieces;
        }
        if (!awbs.length) return;
        try {
            const r = await api('/api/consolidation', { method: 'POST', body: { action: 'add', id: d.consolidation.id, awbs, pieces } });
            beep(true); toast(true, r.added ? `${awbs.join(', ')} added.` : 'Already inside.');
            await openDetail(d.consolidation.id, true); loadCons();
        } catch (err) { beep(false); toast(false, (err as Error).message); }
    };
    const removeItem = async (awb: string) => {
        if (!await confirm({ title: `Remove ${awb}?`, message: `It is taken out of ${detail.consolidation.mawb}.`, confirmText: 'Remove' })) return;
        try { await api('/api/consolidation', { method: 'POST', body: { action: 'remove', id: detail.consolidation.id, awb } }); await openDetail(detail.consolidation.id, true); loadCons(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const closeToggle = async () => {
        const c = detail.consolidation, closing = !c.closed;
        if (closing && !await confirm({ title: `Close ${c.mawb}?`, message: `${detail.items.length} shipment(s). Nothing can be added or removed until it is reopened.`, confirmText: 'Close' })) return;
        try { await api('/api/consolidation', { method: 'POST', body: { action: closing ? 'close' : 'reopen', id: c.id } }); await openDetail(c.id, true); loadCons(); toast(true, closing ? 'Closed.' : 'Reopened.'); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const printDetail = () => {
        const c = detail.consolidation;
        printManifest(`${KIND_NAME[c.kind] || 'MAWB'} manifest — ${c.mawb}`,
            [['Carrier', c.carrier], [c.kind === 'container' ? 'Vessel' : 'Flight', c.flight_no || c.vessel], ['Voyage', c.voyage], ['B/L', c.bl_no], ['Size', c.container_size], ['Seal', c.seal_no], ['Departure', c.departure_date], ['ETA', c.eta], ['Destination', c.dest_country], ['Origin branch', c.origin_branch], ['Status', c.closed ? 'Closed' : 'Open']],
            detail.items.map((i: any) => ({ ...i, pieces: i.boxes_in ? `${i.in_pieces} of ${i.boxes_total}` : i.in_pieces, weight: i.in_weight || i.weight })));
    };
    // ---------- export with chosen columns (components/ManifestExport.tsx) ----------
    const [exp, setExp] = useState<{ title: string; fileName: string; meta: [string, unknown][]; rows: any[] } | null>(null);
    const exportDetail = () => {
        const c = detail.consolidation;
        setExp({ title: `${KIND_NAME[c.kind] || 'MAWB'} manifest — ${c.mawb}`, fileName: `manifest-${String(c.mawb).replace(/[^A-Za-z0-9-]+/g, '_')}`,
            meta: [['Carrier', c.carrier], [c.kind === 'container' ? 'Vessel' : 'Flight', c.flight_no || c.vessel], ['Departure', c.departure_date], ['Destination', c.dest_country], ['Origin branch', c.origin_branch]],
            rows: detail.items.map((i: any) => ({ ...i, pieces: i.boxes_in ? i.in_pieces : i.pieces, weight: i.in_weight || i.weight })) });
    };
    async function exportTransfer(id: number | string) {
        try {
            const { manifest: m, items } = await api(`/api/transfers?id=${encodeURIComponent(id)}`);
            setExp({ title: `Transfer manifest — ${m.manifest_no}`, fileName: `manifest-${String(m.manifest_no).replace(/[^A-Za-z0-9-]+/g, '_')}`,
                meta: [['From', bname(m.from_branch)], ['To', bname(m.to_branch)], ['Sent', fmt(m.created_at)], ['Vehicle', m.vehicle], ['Driver', m.driver], ['Seal', m.seal_no]],
                rows: items.map((t: any) => ({ ...t.bookings, current_status: t.status === 'received' ? 'Received' : 'In transit' })) });
        } catch (e) { toast(false, (e as Error).message); }
    }
    async function printTransfer(id: number | string) {
        try {
            const { manifest: m, items } = await api(`/api/transfers?id=${encodeURIComponent(id)}`);
            printManifest(`Transfer manifest — ${m.manifest_no}`,
                [['From', bname(m.from_branch)], ['To', bname(m.to_branch)], ['Sent', fmt(m.created_at) + (m.created_by_name ? ' by ' + m.created_by_name : '')], ['Vehicle', m.vehicle], ['Driver', m.driver], ['Seal', m.seal_no], ['Notes', m.notes]],
                items.map((t: any) => ({ ...t.bookings, current_status: t.status === 'received' ? 'Received' : 'In transit' })), true);
        } catch (e) { toast(false, (e as Error).message); }
    }
    // status for everything inside, or one shipment (its boxes inside ticked)
    const st = statuses.find(x => x.code === (bStatus || statuses[0]?.code)) || { requires: [] };
    const pickTarget = (awb: string) => {
        setBTarget(awb);
        const it = detail.items.find((i: any) => i.awb === awb);
        setBTicks(it && it.boxes_total > 1 ? it.boxes.filter((b: any) => !it.boxes_in || it.boxes_in.includes(b.piece_no)).map((b: any) => b.piece_no) : []);
    };
    const rowUpdate = (awb: string) => { pickTarget(awb); setBulkOpen(true); setTimeout(() => bulkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); };
    const applyStatus = async () => {
        const s = statuses.find(x => x.code === (bStatus || statuses[0]?.code)); if (!s) return;
        const items = bTarget ? detail.items.filter((i: any) => i.awb === bTarget) : detail.items;
        const awbs = items.map((i: any) => i.awb), pieces: Record<string, number[]> = {};
        if (bTarget) {
            if (items[0].boxes_total > 1) { if (!bTicks.length) return toast(false, 'Tick at least one box.'); if (bTicks.length < items[0].boxes_total) pieces[bTarget] = [...bTicks].sort((a, b) => a - b); }
        } else items.forEach((i: any) => { if (i.boxes_in) pieces[i.awb] = i.boxes_in; });   // only the boxes inside move
        if (!await confirm({ title: `Set ${bTarget ? bTarget : awbs.length + ' shipment(s)'} to “${s.label}”?`, message: bTarget ? (pieces[bTarget] ? `Boxes ${pieces[bTarget].join(', ')} only.` : 'All boxes.') : `Everything in ${detail.consolidation.mawb}.`, confirmText: 'Update' })) return;
        try {
            const r = await api('/api/status', { method: 'POST', body: { awbs, pieces, code: s.code, location: bf.loc, remark: [bf.remark, `${detail.consolidation.kind.toUpperCase()}: ${detail.consolidation.mawb}`].filter(Boolean).join(' • '), fwd_agent: bf.agent, fwd_docket: bf.docket, mawb: detail.consolidation.mawb } });
            toast(true, `${r.updated ?? awbs.length} updated to ${s.label}.`);
            await openDetail(detail.consolidation.id, true);
        } catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- costs ----------
    const canCost = session.role() !== 'staff';
    const [parties, setParties] = useState<any[] | null>(null);
    const [costOpen, setCostOpen] = useState(false);
    const blankK = { type: 'freight', party: '', amt: '', pay: 'credit', ref: '', desc: '' };
    const [kf, setKf] = useState(blankK);
    const kAmt = useRef<HTMLInputElement>(null);
    const setK = (k: keyof typeof kf) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setKf(v => ({ ...v, [k]: e.target.value }));
    const costAdd = async () => {
        if (!parties) { try { setParties((await api('/api/accounts?view=parties')).parties.filter((p: any) => p.active)); } catch { setParties([]); } }
        setCostOpen(true); setTimeout(() => kAmt.current?.focus(), 0);
    };
    const saveCost = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const r = await api('/api/accounts', { method: 'POST', body: { action: 'cost_bill', branch: detail.consolidation.origin_branch, consolidation_id: detail.consolidation.id, cost_type: kf.type, supplier_id: kf.party || null, amount: kf.amt, pay_method: kf.pay, bill_ref: kf.ref, description: kf.desc } });
            const sh: any[] = r.shares || [];
            toast(true, sh.length > 1 ? `${r.bill_no} saved — shared: ${sh.map(x => `${x.branch} ${(+x.amount).toFixed(3)}`).join(' · ')}. Each branch carries its share.` : `${r.bill_no} saved — split across ${detail.items.length} shipment(s).`);
            setKf(blankK); setCostOpen(false);
            await openDetail(detail.consolidation.id, true);
        } catch (err) { toast(false, (err as Error).message); }
    };
    const money = (cur: string, v: unknown) => `${cur} ${(+(v as number) || 0).toFixed(3)}`;

    const c = detail?.consolidation, items: any[] = detail?.items || [];
    const curTarget = items.find(i => i.awb === bTarget);
    const costTotal = (detail?.costs || []).reduce((s: number, k: any) => s + +k.amount, 0);
    const isSea = kind === 'container';

    const popups = <>
        <Modal id="consModal" open={cOpen} onClose={() => setCOpen(false)} panelClassName="max-w-lg" form={{ id: 'consForm', onSubmit: createCons }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 className="text-lg font-extrabold">New MAWB / bag</h3><p className="text-xs text-gray-400 mt-0.5">Group shipments under one master airway bill or bag.</p></div>
                <CloseX />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-5 overflow-y-auto custom-scrollbar">
                <div className="sm:col-span-2 grid grid-cols-3 gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full">
                    {([['mawb', 'MAWB (air)'], ['container', 'Container (sea)'], ['bag', 'Bag / sack']] as const).map(([k, l]) => <button key={k} type="button" className="opt py-2 rounded-full text-xs font-extrabold" data-kind={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
                </div>
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="cNo" id="cNoLabel">{kind === 'bag' ? 'Bag number' : kind === 'container' ? 'Container number' : 'MAWB number'} <span className="req">*</span></label>
                    <input id="cNo" className="field font-mono uppercase" placeholder={kind === 'bag' ? 'e.g. BAG-SLL-0012' : kind === 'container' ? 'e.g. MSKU1234567' : 'e.g. 176-12345675'} required value={cf.no} onChange={setC('no')} /></div>
                <div><label className="ui-label" htmlFor="cCarrier" id="cCarrierLabel">{isSea ? 'Shipping line / agent' : 'Airline / agent'}</label><input id="cCarrier" className="field" placeholder="e.g. Emirates SkyCargo" value={cf.carrier} onChange={setC('carrier')} /></div>
                <div><label className="ui-label" htmlFor="cFlight" id="cFlightLabel">{isSea ? 'Vessel' : 'Flight no.'}</label><input id="cFlight" className="field" placeholder="e.g. EK 0861" value={cf.flight} onChange={setC('flight')} /></div>
                <div data-sea="" className={isSea ? '' : 'hidden'}><label className="ui-label" htmlFor="cSize">Container size</label><select id="cSize" className="field" value={cf.size} onChange={setC('size')}><option>20GP</option><option>40GP</option><option>40HC</option><option>45HC</option><option>LCL</option></select></div>
                <div data-sea="" className={isSea ? '' : 'hidden'}><label className="ui-label" htmlFor="cSeal">Seal no.</label><input id="cSeal" className="field" value={cf.seal} onChange={setC('seal')} /></div>
                <div data-sea="" className={isSea ? '' : 'hidden'}><label className="ui-label" htmlFor="cVoy">Voyage</label><input id="cVoy" className="field" value={cf.voy} onChange={setC('voy')} /></div>
                <div data-sea="" className={isSea ? '' : 'hidden'}><label className="ui-label" htmlFor="cBl">B/L no.</label><input id="cBl" className="field" value={cf.bl} onChange={setC('bl')} /></div>
                <div data-sea="" className={isSea ? '' : 'hidden'}><label className="ui-label" htmlFor="cEta">ETA</label><input id="cEta" type="date" className="field" value={cf.eta} onChange={setC('eta')} /></div>
                <div><label className="ui-label" htmlFor="cDate">Departure</label><input id="cDate" type="date" className="field" value={cf.date} onChange={setC('date')} /></div>
                <div><label className="ui-label" htmlFor="cDest">Destination country</label><Combobox ref={cDest} load={countryItems} inputProps={{ id: 'cDest', className: 'field', placeholder: 'Select' }} /></div>
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="cNotes">Notes</label><input id="cNotes" className="field" placeholder="Optional" value={cf.notes} onChange={setC('notes')} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <CancelBtn />
                <button className="btn btn-dark">Create</button>
            </div>
        </Modal>

        <Modal id="detailModal" open={dOpen} onClose={() => setDOpen(false)} panelClassName="max-w-3xl">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div className="min-w-0"><p id="dKind" className="sd-label">{c ? (c.kind === 'bag' ? 'Bag' : c.kind === 'container' ? `Container${c.container_size ? ' · ' + c.container_size : ''}` : 'Master airway bill') : ''}</p>
                    <h3 id="dNo" className="text-xl font-extrabold font-mono truncate">{c?.mawb}</h3>
                    <p id="dMeta" className="text-xs text-gray-400 mt-0.5">{c ? [c.carrier, c.flight_no || c.vessel, c.voyage && 'Voy ' + c.voyage, c.bl_no && 'B/L ' + c.bl_no, c.seal_no && 'Seal ' + c.seal_no, c.departure_date, c.eta && 'ETA ' + c.eta, c.dest_country, c.origin_branch].filter(Boolean).join(' · ') || '—' : ''}</p></div>
                <CloseX />
            </div>
            <div className="my-5 space-y-4 overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#F8F8FA] rounded-2xl p-3"><p className="sd-label">Shipments</p><p id="dShip" className="text-xl font-extrabold">{items.length}</p></div>
                    <div className="bg-[#F8F8FA] rounded-2xl p-3"><p className="sd-label">Pieces</p><p id="dPcs" className="text-xl font-extrabold">{items.reduce((s, i) => s + (+i.in_pieces || 0), 0)}</p></div>
                    <div className="bg-[#F8F8FA] rounded-2xl p-3"><p className="sd-label">Weight</p><p id="dKg" className="text-xl font-extrabold">{`${Math.round(items.reduce((s, i) => s + (+i.in_weight || 0), 0) * 100) / 100} kg`}</p></div>
                </div>
                <form id="dScan" className={`flex flex-col sm:flex-row gap-2${c?.closed ? ' hidden' : ''}`} onSubmit={dScan}>
                    <ScanInput ref={dInput} mode="submit" continuous inputProps={{ id: 'dInput', className: 'field scan', placeholder: 'Scan AWB to add', autoComplete: 'off', 'aria-label': 'AWB to add' }} />
                    <button className="btn btn-dark">Add</button>
                </form>
                <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                    <table className="rtable w-full text-xs">
                        <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                            <th className="p-3 pl-4 font-extrabold">AWB</th><th className="p-3 font-extrabold">Receiver</th><th className="p-3 font-extrabold">Dest.</th><th className="p-3 font-extrabold">Boxes / kg</th><th className="p-3 font-extrabold">Status</th><th className="p-3 w-10"></th>
                        </tr></thead>
                        <tbody id="dRows" className="divide-y divide-gray-100">
                            {detail && (items.length ? items.map(i => (
                                <tr key={i.awb}>
                                    <td className="p-3 pl-4 font-extrabold font-mono" data-label="AWB">{i.awb}</td>
                                    <td className="p-3" data-label="Receiver">{i.consignee || '—'}</td>
                                    <td className="p-3" data-label="Dest.">{i.dest_city || i.dest_country || '—'}</td>
                                    <td className="p-3" data-label="Boxes / kg"><span className={i.boxes_in ? 'text-[#D55C48] font-extrabold' : ''}>{`${i.in_pieces}${i.boxes_in ? ` of ${i.boxes_total}` : ''}`}</span>{` / ${i.in_weight || i.weight || '—'}`}{i.boxes_in && <span className="block text-[10px] text-gray-400">{`Box ${i.boxes_in.join(', ')}`}</span>}</td>
                                    <td className="p-3" data-label="Status"><span className="pill-tag pill-gray">{i.current_status || ''}</span></td>
                                    <td className="p-3 pr-4 text-right whitespace-nowrap" data-label=""><button type="button" className="btn btn-light btn-sm" data-row-update={i.awb} onClick={() => rowUpdate(i.awb)}>Update</button>{!c.closed && <>{' '}<button type="button" className="icon-btn" title="Remove" data-remove={i.awb} onClick={() => removeItem(i.awb)}><Icon name="x" cls="w-3.5 h-3.5" /></button></>}</td></tr>
                            )) : <tr><td colSpan={6} className="p-8 text-center text-gray-400">Empty — scan shipments to add them.</td></tr>)}
                        </tbody>
                    </table>
                </div>
                <details id="bulkBox" ref={bulkRef} open={bulkOpen} onToggle={e => setBulkOpen((e.target as HTMLDetailsElement).open)} className={`bg-[#F8F8FA] rounded-[1.5rem] p-4${detail && !items.length ? " hidden" : ""}`}>
                    <summary className="cursor-pointer text-xs font-extrabold">Update status — everything inside, or one shipment</summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                        <div className="sm:col-span-2"><label className="ui-label" htmlFor="bTarget">Apply to</label><select id="bTarget" className="field" value={bTarget} onChange={e => pickTarget(e.target.value)}>
                            <option value="">{`Everything inside (${items.length} shipments)`}</option>{items.map(i => <option key={i.awb} value={i.awb}>{`${i.awb} only · ${i.consignee || ''}`}</option>)}</select></div>
                        <div id="bBoxes" className={`sm:col-span-2 ${curTarget && curTarget.boxes_total > 1 ? '' : 'hidden '}flex flex-wrap gap-2`}>
                            {curTarget && curTarget.boxes_total > 1 && curTarget.boxes.map((b: any) => <label key={b.piece_no} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 text-xs font-bold border border-gray-100 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-[#E86D58]" value={b.piece_no} checked={bTicks.includes(b.piece_no)} onChange={e => setBTicks(t => e.target.checked ? [...t, b.piece_no] : t.filter(x => x !== b.piece_no))} />{`Box ${b.piece_no}`}<span className="text-[10px] text-gray-400 font-medium">{b.status || ''}</span></label>)}
                        </div>
                        <div className="sm:col-span-2"><label className="ui-label" htmlFor="bStatus">New status</label><select id="bStatus" className="field" value={bStatus || statuses[0]?.code || ''} onChange={e => setBStatus(e.target.value)}>
                            {statuses.map(s => <option key={s.code} value={s.code}>{(s.is_exception ? '⚠ ' : '') + s.label}</option>)}</select></div>
                        <div data-need="agent_docket" className={st.requires.includes('agent_docket') ? '' : 'hidden'}><label className="ui-label" htmlFor="bAgent">Forwarding agent</label><input id="bAgent" className="field" list="cAgentList" autoComplete="off" value={bf.agent} onChange={e => setBf({ ...bf, agent: e.target.value })} /></div>
                        <div data-need="agent_docket" className={st.requires.includes('agent_docket') ? '' : 'hidden'}><label className="ui-label" htmlFor="bDocket">Agent docket no.</label>
                            <ScanInput mode="fill" inputProps={{ id: 'bDocket', className: 'field', 'aria-label': 'agent docket number', autoComplete: 'off', placeholder: 'Scan or type', value: bf.docket, onChange: e => setBf({ ...bf, docket: e.target.value }) }} /></div>
                        <div><label className="ui-label" htmlFor="bLoc">Location</label><input id="bLoc" className="field" placeholder="Optional" value={bf.loc} onChange={e => setBf({ ...bf, loc: e.target.value })} /></div>
                        <div><label className="ui-label" htmlFor="bRemark">Remark</label><input id="bRemark" className="field" placeholder="Optional" value={bf.remark} onChange={e => setBf({ ...bf, remark: e.target.value })} /></div>
                        <button id="bApply" type="button" className="btn btn-dark sm:col-span-2" onClick={applyStatus}><Icon name="refresh" />Update</button>
                    </div>
                </details>
                <section id="costBox" className={`${canCost && detail ? '' : 'hidden '}bg-white rounded-[1.5rem] border border-gray-100 p-4 space-y-3`}>
                    <div className="flex items-center justify-between gap-2"><span className="sd-label">Costs · split by <span id="costBasis">{c ? (c.kind === 'container' ? 'CBM (box dimensions)' : 'chargeable weight') : ''}</span></span>
                        <button id="costAdd" type="button" className="btn btn-light btn-sm" onClick={costAdd}><Icon name="plus" />Add cost</button></div>
                    {detail && canCost && (detail.branch_shares || []).length > 1 && <p id="branchShares" className="text-[11px] text-gray-500">{'Shipments from several branches — each bill here is shared: '}{detail.branch_shares.map((s: any, i: number) => <span key={s.branch}>{i ? ' · ' : ''}<b>{s.name}</b>{` ${Math.round(s.share * 1000) / 10}%`}</span>)}{'. Each branch carries its share as its own cost.'}</p>}
                    <form id="costForm" className={`${costOpen ? '' : 'hidden '}grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#F8F8FA] rounded-2xl p-3`} onSubmit={saveCost}>
                        <div><label className="ui-label" htmlFor="kType">Cost</label><select id="kType" className="field" value={kf.type} onChange={setK('type')}><option value="freight">Freight (airline / shipping line)</option><option value="customs">Customs &amp; clearance</option><option value="trucking">Trucking / transport</option><option value="handling">Handling / terminal</option><option value="other">Other</option></select></div>
                        <div><label className="ui-label" htmlFor="kParty">Agent / supplier</label><select id="kParty" className="field" value={kf.party} onChange={setK('party')}>
                            {parties && <><option value="">— none —</option>{parties.map(p => <option key={p.id} value={p.id}>{p.name + (p.kind !== 'supplier' ? ' (agent)' : '')}</option>)}</>}</select></div>
                        <div><label className="ui-label" htmlFor="kAmt">Amount</label><input id="kAmt" ref={kAmt} type="number" min="0" step="0.001" className="field" required value={kf.amt} onChange={setK('amt')} /></div>
                        <div><label className="ui-label" htmlFor="kPay">Paid by</label><select id="kPay" className="field" value={kf.pay} onChange={setK('pay')}><option value="credit">On credit (pay agent later)</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="card">Card</option></select></div>
                        <div><label className="ui-label" htmlFor="kRef">Their bill no.</label><input id="kRef" className="field" value={kf.ref} onChange={setK('ref')} /></div>
                        <div><label className="ui-label" htmlFor="kDesc">Note</label><input id="kDesc" className="field" value={kf.desc} onChange={setK('desc')} /></div>
                        <div className="sm:col-span-3 flex justify-end gap-2"><button type="button" className="btn btn-light btn-sm" id="costCancel" onClick={() => setCostOpen(false)}>Cancel</button><button className="btn btn-dark btn-sm">Save cost</button></div>
                    </form>
                    <div id="costList" className="space-y-1.5">
                        {detail && canCost && (detail.costs.length ? detail.costs.map((k: any) => (
                            <div key={k.bill_no} className="flex items-center justify-between gap-3 text-xs bg-[#F8F8FA] rounded-xl px-3 py-2">
                                <span><b>{k.bill_no}</b>{` · ${k.cost_type}${k.suppliers?.name ? ' · ' + k.suppliers.name : ''}${k.bill_ref ? ' · bill ' + k.bill_ref : ''}${k.description ? ' · ' + k.description : ''}`}{k.split && (k.cost_bill_shares || []).length > 0 && <span className="block text-gray-400 mt-0.5">{'shared: ' + k.cost_bill_shares.map((x: any) => `${x.branch_code} ${(+x.amount).toFixed(3)}`).join(' · ')}</span>}</span>
                                <span className="font-extrabold tabular-nums whitespace-nowrap">{money(k.currency, k.amount) + ' '}<span className={`pill-tag ${k.status === 'paid' ? 'pill-green' : 'pill-amber'}`}>{k.status === 'unpaid' ? 'owed' : k.status}</span></span></div>
                        )) : <p className="text-xs text-gray-400">No costs yet — add the airline / shipping line, customs, trucking bills here.</p>)}
                    </div>
                    <div id="allocBox">
                        {detail && canCost && detail.allocation.length > 0 && <>
                            <p className="sd-label mt-2 mb-1">{`Cost per shipment (total ${money(detail.costs[0]?.currency || '', costTotal)})`}</p>
                            <table className="w-full text-xs"><tbody>{detail.allocation.map((a: any) => (
                                <tr key={a.awb} className="border-t border-gray-100"><td className="py-1.5 font-mono font-bold">{a.awb}</td>
                                    <td className="py-1.5 text-gray-500">{`${(+a.basis).toFixed(c.kind === 'container' ? 3 : 2)} ${c.kind === 'container' ? 'CBM' : 'kg'}`}</td><td className="py-1.5 text-gray-500">{`${(a.share * 100).toFixed(1)}%`}</td>
                                    <td className="py-1.5 text-right font-extrabold tabular-nums">{money(a.currency, a.allocated)}</td></tr>
                            ))}</tbody></table></>}
                    </div>
                </section>
            </div>
            <div className="flex flex-wrap justify-between gap-2 pt-4 border-t border-gray-100">
                <button id="dPrint" type="button" className="btn btn-light" onClick={printDetail}><Icon name="clipboard" />Print manifest</button>
                <button id="dExport" type="button" className="btn btn-light" onClick={exportDetail}><Icon name="download" />Export</button>
                <button id="dClose" type="button" className="btn btn-dark" onClick={closeToggle}>{c && (c.closed ? <><Icon name="refresh" />Reopen</> : <><Icon name="check" />{`Close ${(KIND_NAME[c.kind] || 'MAWB').toLowerCase()}`}</>)}</button>
            </div>
        </Modal>
        {agents && <datalist id="cAgentList">{agents.map((n, i) => <option key={i} value={n}></option>)}</datalist>}
        {/* last, so it opens above the consolidation window */}
        {exp && <ManifestExport open onClose={() => setExp(null)} title={exp.title} fileName={exp.fileName} meta={exp.meta} rows={exp.rows} />}
    </>;

    const consList = (cons || []).filter(x => cfilter === 'all' || (cfilter === 'open' ? !x.closed : x.closed));
    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="layers" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Consolidation &amp; Bulk</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Branch outbound / inbound • MAWB &amp; bags • bulk status</p>
                        </div>
                    </div>
                    <div id="branchPick" className={`${T.can_switch ? 'flex' : 'hidden'} items-center gap-2 self-start sm:self-auto`}>
                        <label htmlFor="actBranch" className="text-[11px] font-bold text-gray-500 whitespace-nowrap">Working at</label>
                        <select id="actBranch" className="field !py-2 !w-56" value={actBranch} onChange={e => { setBatch(new Set()); setActBranch(e.target.value); loadTransfers(e.target.value); }}>
                            {T.can_switch && T.branches.map((b: any) => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} (${b.branch_code})`}</option>)}
                        </select>
                    </div>
                </section>

                {(() => {   // cargo stock at this location, box level: on hand, on the way in, on the way out
                    const boxesOf = (t: any) => t.pieces ? t.pieces.length : +t.bookings?.pieces || 1;
                    const onHand = T.held.reduce((n: number, h: any) => n + (+h.pieces || 0), 0), kg = T.held.reduce((n: number, h: any) => n + (+h.weight || 0), 0);
                    const inBoxes = T.incoming.reduce((n: number, m: any) => n + (m.transfers || []).filter((t: any) => t.status === 'pending').reduce((k: number, t: any) => k + boxesOf(t), 0), 0);
                    const outShip = T.outgoing.reduce((n: number, m: any) => n + (m.transfers || []).filter((t: any) => t.status === 'pending').length, 0);
                    const cell = (label: string, value: string, sub: string) => <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3"><p className="sd-label">{label}</p><p className="text-xl font-extrabold tabular-nums">{value}</p><p className="text-[11px] text-gray-400">{sub}</p></div>;
                    return <div id="cargoStock" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                        {cell(`Cargo on hand · ${bname(T.branch) || T.branch || ''}`, `${onHand} box${onHand === 1 ? '' : 'es'}`, `${T.held.length} shipment${T.held.length === 1 ? '' : 's'} · ${Math.round(kg * 100) / 100} kg`)}
                        {cell('Coming in', `${inBoxes} box${inBoxes === 1 ? '' : 'es'}`, `${T.incoming.length} manifest${T.incoming.length === 1 ? '' : 's'} on the way here`)}
                        {cell('Sent, not yet received', `${outShip} shipment${outShip === 1 ? '' : 's'}`, 'Left this stock when sent')}
                    </div>;
                })()}
                <div className="flex flex-wrap gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full w-fit mb-5" role="tablist">
                    <button type="button" className="tab px-4 py-2 rounded-full text-xs font-extrabold" data-tab="outbound" role="tab" aria-selected={tab === 'outbound'} onClick={() => showTab('outbound')}>Outbound</button>
                    <button type="button" className="tab px-4 py-2 rounded-full text-xs font-extrabold" data-tab="inbound" role="tab" aria-selected={tab === 'inbound'} onClick={() => showTab('inbound')}>Inbound <span data-count="inbound">{pendingIn ? `· ${pendingIn}` : ''}</span></button>
                    <button type="button" className="tab px-4 py-2 rounded-full text-xs font-extrabold" data-tab="mawb" role="tab" aria-selected={tab === 'mawb'} onClick={() => showTab('mawb')}>MAWB / Bags <span data-count="mawb">{openCons ? `· ${openCons}` : ''}</span></button>
                </div>

                <section key={'o' + (tab === 'outbound' ? fade : '')} data-panel="outbound" className={`${tab === 'outbound' ? '' : 'hidden '}grid grid-cols-1 xl:grid-cols-5 gap-5 ui-fade`}>
                    <div className="xl:col-span-3 space-y-4">
                        <div className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#111827] text-white text-[11px] font-extrabold flex items-center justify-center">1</span><span className="font-extrabold text-xs uppercase tracking-wider">Scan shipments to send</span></div>
                                <span id="obCount" className="pill-tag pill-dark">{`${batch.size} selected`}</span>
                            </div>
                            <form id="obScan" className="flex flex-col sm:flex-row gap-2" onSubmit={obScan}>
                                <ScanInput ref={obInput} mode="submit" continuous inputProps={{ id: 'obInput', className: 'field scan', placeholder: 'Scan or type AWB, press Enter', autoComplete: 'off', 'aria-label': 'AWB' }} />
                                <button className="btn btn-dark">Add</button>
                            </form>
                            <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                                    <span className="sd-label">Held at this branch</span>
                                    <input id="obFilter" className="field !py-1.5 !w-44 text-xs" placeholder="Filter…" aria-label="Filter" value={obFilter} onChange={e => setObFilter(e.target.value)} />
                                </div>
                                <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
                                    <table className="rtable w-full text-xs">
                                        <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                            <th className="p-3 pl-4 w-10"><input id="obAll" type="checkbox" className="w-4 h-4" aria-label="Select all" checked={obRows.length > 0 && obRows.every((b: any) => batch.has(b.awb))}
                                                onChange={e => { const on = e.target.checked; setBatch(s => { const x = new Set(s); obRows.forEach((b: any) => on ? x.add(b.awb) : x.delete(b.awb)); return x; }); }} /></th>
                                            <th className="p-3 font-extrabold">AWB</th><th className="p-3 font-extrabold">Receiver</th><th className="p-3 font-extrabold">Destination</th><th className="p-3 font-extrabold">Status</th>
                                        </tr></thead>
                                        <tbody id="obRows" className="divide-y divide-gray-100">
                                            {obRows.length ? obRows.map((b: any) => (
                                                <tr key={b.awb} className={batch.has(b.awb) ? 'bg-[#FFF5F3]' : ''}>
                                                    <td className="p-3 pl-4" data-label=""><input type="checkbox" className="w-4 h-4" data-ob={b.awb} checked={batch.has(b.awb)} aria-label={`Select ${b.awb}`}
                                                        onChange={async e => { if (e.target.checked) await addOutbound(b.awb); else { setBatch(s => { const x = new Set(s); x.delete(b.awb); return x; }); setObPieces(p => { const x = { ...p }; delete x[b.awb]; return x; }); } }} /></td>
                                                    <td className="p-3 font-extrabold font-mono" data-label="AWB">{b.awb}</td>
                                                    <td className="p-3" data-label="Receiver">{b.consignee || '—'}{+b.pieces > 1 && <button type="button" onClick={() => reBoxOut(b.awb)} className={`block text-[10px] font-extrabold ${obPieces[b.awb] ? 'text-[#D55C48]' : 'text-gray-400'} hover:underline`}>{(obPieces[b.awb] ? `Boxes ${obPieces[b.awb].join(', ')} of ${b.boxes_total || b.pieces}` : +b.boxes_total > +b.pieces ? `Boxes ${b.boxes.join(', ')} here (of ${b.boxes_total})` : `${b.pieces} boxes`) + (batch.has(b.awb) ? ' · change' : '')}</button>}</td>
                                                    <td className="p-3" data-label="Destination">{[b.dest_city, b.dest_country].filter(Boolean).join(', ') || '—'}</td>
                                                    <td className="p-3" data-label="Status"><span className="pill-tag pill-gray">{b.current_status || ''}</span></td></tr>
                                            )) : <tr><td colSpan={5} className="p-8 text-center text-gray-400">{q ? 'No match.' : 'No shipments held at this branch.'}</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="xl:col-span-2 space-y-4">
                        <form id="obForm" className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4" onSubmit={obSend}>
                            <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#111827] text-white text-[11px] font-extrabold flex items-center justify-center">2</span><span className="font-extrabold text-xs uppercase tracking-wider">Manifest details</span></div>
                            <div><label className="ui-label" htmlFor="obTo">Send to branch <span className="req">*</span></label><select id="obTo" className="field" value={ob.to} onChange={e => setOb({ ...ob, to: e.target.value })}>
                                {T.branch && <><option value="">Choose branch…</option>{T.branches.filter((b: any) => b.branch_code !== T.branch).map((b: any) => <option key={b.branch_code} value={b.branch_code}>{b.branch_name + (b.is_hub ? ' · hub' : '')}</option>)}</>}</select></div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="ui-label" htmlFor="obVehicle">Vehicle</label><input id="obVehicle" className="field" placeholder="e.g. Van 12" value={ob.vehicle} onChange={e => setOb({ ...ob, vehicle: e.target.value })} /></div>
                                <div><label className="ui-label" htmlFor="obDriver">Driver / courier</label><input id="obDriver" className="field" placeholder="Name" value={ob.driver} onChange={e => setOb({ ...ob, driver: e.target.value })} /></div>
                            </div>
                            <div><label className="ui-label" htmlFor="obSeal">Seal no.</label><input id="obSeal" className="field" placeholder="Optional" value={ob.seal} onChange={e => setOb({ ...ob, seal: e.target.value })} /></div>
                            <div><label className="ui-label" htmlFor="obNotes">Notes</label><textarea id="obNotes" rows={2} className="field" placeholder="Optional" value={ob.notes} onChange={e => setOb({ ...ob, notes: e.target.value })}></textarea></div>
                            <button id="obSend" className="btn btn-coral w-full" disabled={obBusy || !batch.size}><Icon name="truck" />{`Send ${batch.size} shipment${batch.size === 1 ? '' : 's'}`}</button>
                        </form>
                        <div className="bg-white rounded-[2rem] border border-gray-100 p-5">
                            <div className="flex items-center justify-between mb-3"><span className="sd-label">Sent in the last 30 days</span></div>
                            <div id="obRecent" className="space-y-2">
                                {T.outgoing.length ? T.outgoing.map((m: any) => {
                                    const total = m.transfers.length, got = m.transfers.filter((t: any) => t.status === 'received').length;
                                    const pill = m.status === 'received' ? 'pill-green' : m.status === 'partial' ? 'pill-amber' : 'pill-dark';
                                    return (
                                        <div key={m.id} className="flex items-center gap-1"><button type="button" data-print-tr={m.id} onClick={() => printTransfer(m.id)} className="flex-1 min-w-0 flex items-center justify-between gap-3 p-3 rounded-2xl hover:bg-[#F8F8FA] text-left">
                                            <span className="min-w-0"><span className="block text-xs font-extrabold font-mono truncate">{m.manifest_no}</span>
                                                <span className="block text-[10px] text-gray-400">{`→ ${bname(m.to_branch)} · ${fmt(m.created_at)}`}</span></span>
                                            <span className="text-right"><span className={`pill-tag ${pill}`}>{`${got}/${total} ${m.status === 'in_transit' ? 'in transit' : m.status}`}</span>{m.transfers.some((t: any) => t.missing_pieces) && <span className="block pill-tag pill-coral mt-1">boxes missing</span>}</span></button><button type="button" className="icon-btn flex-shrink-0" aria-label={`Export ${m.manifest_no}`} title="Export with chosen columns" data-export-tr={m.id} onClick={() => exportTransfer(m.id)}><Icon name="download" cls="w-4 h-4" /></button></div>
                                    );
                                }) : <p className="text-xs text-gray-400 text-center py-4">Nothing sent yet.</p>}
                            </div>
                        </div>
                    </div>
                </section>

                <section key={'i' + (tab === 'inbound' ? fade : '')} data-panel="inbound" className={`${tab === 'inbound' ? '' : 'hidden '}grid grid-cols-1 xl:grid-cols-5 gap-5 ui-fade`}>
                    <div className="xl:col-span-2 space-y-4">
                        <div className="bg-[#111827] text-white rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <p className="font-extrabold text-xs uppercase tracking-wider text-white/60">Receive at <span id="ibBranch" className="text-white">{T.branch ? bname(T.branch) : ''}</span></p>
                            <form id="ibScan" className="flex flex-col sm:flex-row gap-2" onSubmit={ibScan}>
                                <ScanInput ref={ibInput} mode="submit" continuous inputProps={{ id: 'ibInput', className: 'field scan !bg-white/10 !text-white !border-white/10 placeholder:!text-white/40', placeholder: 'Scan arriving AWB', autoComplete: 'off', 'aria-label': 'AWB' }} />
                                <button className="btn btn-coral">Receive</button>
                            </form>
                            <input id="ibNote" className="field !bg-white/10 !text-white !border-white/10 placeholder:!text-white/40 text-xs" placeholder="Note for this scan (e.g. box damaged) — optional" aria-label="Note" value={ibNote} onChange={e => setIbNote(e.target.value)} />
                            <div id="ibLast" className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                                {ibLast.map(x => (
                                    <div key={x.k} className={`ui-fade flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${x.ok ? 'bg-emerald-500/15' : 'bg-coral-500/20'}`}>
                                        <span className="font-mono text-xs font-extrabold">{x.awb}</span><span className={`text-[11px] font-bold ${x.ok ? 'text-emerald-300' : 'text-coral-200'}`}>{x.text}</span></div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="xl:col-span-3"><div id="ibManifests" className="space-y-4">
                        {T.incoming.length ? T.incoming.map((m: any) => {
                            const its = m.transfers || [], left = its.filter((t: any) => t.status === 'pending');
                            return (
                                <article key={m.id} className="bg-[#F8F8FA] rounded-[2rem] p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div><p className="font-extrabold font-mono">{m.manifest_no}</p>
                                            <p className="text-[11px] text-gray-500">From <b>{bname(m.from_branch)}</b>{` · ${fmt(m.created_at)}${m.vehicle ? ' · ' + m.vehicle : ''}${m.driver ? ' · ' + m.driver : ''}${m.seal_no ? ' · seal ' + m.seal_no : ''}`}</p></div>
                                        <span className={`pill-tag ${left.length ? 'pill-amber' : 'pill-green'}`}>{`${its.length - left.length}/${its.length} received`}</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-white rounded-full mt-3 overflow-hidden"><div className="h-full bg-coral-500 rounded-full transition-all duration-500" style={{ width: `${its.length ? Math.round((its.length - left.length) / its.length * 100) : 0}%` }}></div></div>
                                    <div className="flex flex-wrap gap-1.5 mt-3">{its.map((t: any, i: number) => <span key={i} className={`pill-tag ${t.missing_pieces ? 'pill-coral' : t.status === 'received' ? 'pill-green' : 'pill-gray'} font-mono`}>
                                        {`${t.status === 'received' ? '✓ ' : ''}${t.bookings?.awb ?? ''}${t.pieces ? ` · box ${t.pieces.join(',')}` : +t.bookings?.pieces > 1 ? ` · ${t.bookings.pieces} boxes` : ''}${t.missing_pieces ? ` · missing ${t.missing_pieces.join(',')}` : ''}`}</span>)}</div>
                                    <div className="flex flex-wrap gap-2 mt-4">
                                        {left.length > 0 && <button type="button" className="btn btn-dark btn-sm" data-recv-all={m.id} onClick={() => receiveAll(m)}><Icon name="checkCircle" />{`Receive all ${left.length}`}</button>}
                                        <button type="button" className="btn btn-light btn-sm" data-print-tr={m.id} onClick={() => printTransfer(m.id)}><Icon name="clipboard" />Manifest</button>
                                        <button type="button" className="btn btn-light btn-sm" data-export-tr={m.id} onClick={() => exportTransfer(m.id)}><Icon name="download" />Export</button>
                                    </div></article>
                            );
                        }) : T.branch ? <p className="p-10 text-center text-xs text-gray-400 bg-[#F8F8FA] rounded-[2rem]">Nothing on the way to this branch.</p> : null}
                    </div></div>
                </section>

                <section key={'m' + (tab === 'mawb' ? fade : '')} data-panel="mawb" className={`${tab === 'mawb' ? '' : 'hidden '}space-y-4 ui-fade`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex gap-1.5 bg-[#F8F8FA] p-1 rounded-full">
                            {(['open', 'closed', 'all'] as const).map(f => <button key={f} type="button" className="opt px-3 py-1.5 rounded-full text-[11px] font-extrabold" data-cfilter={f} aria-pressed={cfilter === f} onClick={() => setCfilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
                        </div>
                        <button id="newCons" type="button" className="btn btn-coral" onClick={() => { setCf(blankC); setKind(kind); cDest.current?.clear(); setCOpen(true); }}><Icon name="plus" />New MAWB / container / bag</button>
                    </div>
                    <div id="consList" className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                        {cons && (consList.length ? consList.map(x => (
                            <button key={x.id} type="button" data-cons={x.id} onClick={() => openDetail(x.id)} className="ui-lift text-left bg-[#F8F8FA] rounded-[2rem] p-5 border border-transparent hover:border-gray-200">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0"><p className="sd-label">{(KIND_NAME[x.kind] || 'MAWB') + (x.container_size ? ' · ' + x.container_size : '')}</p><p className="font-extrabold font-mono text-base truncate">{x.mawb}</p></div>
                                    <span className={`pill-tag ${x.closed ? 'pill-gray' : 'pill-coral'}`}>{x.closed ? 'Closed' : 'Open'}</span>
                                </div>
                                <p className="text-[11px] text-gray-500 mt-1 truncate">{[x.carrier, x.flight_no || x.vessel, x.dest_country].filter(Boolean).join(' · ') || 'No carrier details'}</p>
                                <div className="grid grid-cols-3 gap-2 mt-4">
                                    <div className="bg-white rounded-xl p-2 text-center"><p className="text-lg font-extrabold">{x.shipments}</p><p className="text-[9px] font-bold text-gray-400 uppercase">AWBs</p></div>
                                    <div className="bg-white rounded-xl p-2 text-center"><p className="text-lg font-extrabold">{x.pieces}</p><p className="text-[9px] font-bold text-gray-400 uppercase">Pieces</p></div>
                                    <div className="bg-white rounded-xl p-2 text-center"><p className="text-lg font-extrabold">{x.weight}</p><p className="text-[9px] font-bold text-gray-400 uppercase">kg</p></div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-3">{`${x.origin_branch || ''} · ${fmt(x.departure_date || x.created_at)}`}</p></button>
                        )) : <p className="col-span-full p-10 text-center text-xs text-gray-400 bg-[#F8F8FA] rounded-[2rem]">{`No ${cfilter === 'all' ? '' : cfilter} consolidations.`}</p>)}
                    </div>
                </section>
            </div>
        </AppFrame>
    );
}
