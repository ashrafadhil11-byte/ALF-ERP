// The shipment card (details, tracking timeline, delivery & POD) as a drawer over any page.
// The Shipments page passes its own buttons (edit, WhatsApp, sync, cancel, delete); everywhere else the drawer shows
// "Open in Shipments" and "Update status". <ShipmentPeek /> (in AppFrame) opens it for any shipment link on any page.
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from './Icon';
import { PageLink } from './PageLink';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { IconName } from '../lib/icons';

export const STAGE_ICONS: IconName[] = ['box', 'clipboard', 'truck', 'warehouse', 'stamp', 'plane', 'building', 'truck', 'boxCheck'];
export const SX_STEPS: [string, IconName][] = [['Booked', 'clipboard'], ['Origin', 'warehouse'], ['In-transit', 'plane'], ['Last Mile', 'truck'], ['Delivered', 'boxCheck']];
export const sxStep = (stage: number) => stage >= 8 ? 4 : stage === 7 ? 3 : stage >= 5 ? 2 : stage >= 3 ? 1 : 0;
export const fmtDate = (iso: string | undefined | null, opts: Intl.DateTimeFormatOptions) => (iso ? new Date(iso).toLocaleString('en-GB', opts) : '—');
export const vars = (o: Record<string, string | number>) => o as CSSProperties;

type Fab = (icon: IconName, label: string, onClick: () => void, cls?: string) => ReactNode;
export type DrawerActions = (b: any, ctx: { cancelled: boolean; fab: Fab }) => ReactNode;

/** awb = the shipment shown (null = closed); bump `version` to load it again after a change */
export function ShipmentDrawer({ awb, version = 0, onClose, actions }: { awb: string | null; version?: number; onClose: () => void; actions?: DrawerActions }) {
    const statusQ = useQuery({ queryKey: ['statuses'], queryFn: () => api<{ statuses: any[] }>('/api/status'), staleTime: 300_000, enabled: Boolean(awb) });
    const statusInfo = useRef<Record<string, any>>({});
    statusInfo.current = Object.fromEntries((statusQ.data?.statuses || []).map((s: any) => [s.code, s]));
    const drawerOpen = Boolean(awb);
    const [card, setCard] = useState<{ state: 'loading' } | { state: 'error'; msg: string } | { state: 'ok'; b: any; events: any[] }>({ state: 'loading' });
    const [cardTab, setCardTab] = useState<'info' | 'track' | 'pod'>('info');
    const [pod, setPod] = useState<{ b: any; list: any[] } | null>(null);
    const [copied, setCopied] = useState(false);
    const drawerSeq = useRef(0);
    async function openDrawer(a: string) {
        const mine = ++drawerSeq.current;
        setCard({ state: 'loading' }); setCardTab('info'); setPod(null); setCopied(false);
        try {
            const { booking, events } = await api('/api/bookings?awb=' + encodeURIComponent(a));
            if (mine !== drawerSeq.current) return;
            setCard({ state: 'ok', b: booking, events });
            loadPod(booking, mine);
        } catch (e) { if (mine === drawerSeq.current) setCard({ state: 'error', msg: (e as Error).message }); }
    }
    async function loadPod(b: any, mine: number) {
        let l: any[] = [];
        try { l = (await api('/api/delivery?awb=' + encodeURIComponent(b.awb))).deliveries || []; } catch { return; }
        if (!l.length && !b.reviewed_at) return;
        if (mine === drawerSeq.current) setPod({ b, list: l });
    }
    function closeDrawer() { onClose(); }
    // open / reload when the shipment (or the reload counter) changes
    useEffect(() => {
        if (!awb) { document.body.style.overflow = ''; return; }
        document.body.style.overflow = 'hidden';
        openDrawer(awb);
        return () => { document.body.style.overflow = ''; };
    }, [awb, version]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!awb) return;
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [awb]);   // eslint-disable-line react-hooks/exhaustive-deps
    const printPod = () => {
        if (!pod) return;
        const { b, list: l } = pod; const d = l.filter(x => x.status === 'delivered').pop(); if (!d) return;
        const w = window.open('', '_blank'); if (!w) return toast(false, 'Allow pop-ups to print.');
        const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
        const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>POD ${esc(b.awb)}</title>
                <style>body{font-family:Arial,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0}table{border-collapse:collapse;width:100%;margin:16px 0}td{border:1px solid #ddd;padding:8px;font-size:13px;vertical-align:top}td:first-child{width:35%;font-weight:bold;background:#f7f7f7}img{max-width:46%;max-height:260px;border:1px solid #ddd;margin-right:12px}</style></head><body>
                <h1>Proof of Delivery — Al-Farha Cargo</h1><p style="color:#666;font-size:12px">Printed ${esc(new Date().toLocaleString())}</p><table>
                ${row('AWB', esc(b.awb))}${row('Shipper', esc(b.shipper || ''))}
                ${row('Consignee', `${esc(b.consignee || '')}<br>${esc(b.consignee_address || [b.dest_city, b.dest_country].filter(Boolean).join(', '))}`)}
                ${row('Pieces / weight', `${esc(b.pieces ?? '')} / ${esc(b.weight ?? '')} kg`)}
                ${row('Delivered', `${esc(new Date(d.completed_at).toLocaleString())} — attempt ${d.attempt}`)}
                ${row('Delivered by', esc(d.mode === 'collection' ? 'Collected at branch' : d.driver_name || d.agent_name || ''))}
                ${row('Received by', `${esc(d.received_by || '')}${d.receiver_relation ? ' (' + esc(d.receiver_relation) + ')' : ''}${d.receiver_id_no ? '<br>ID: ' + esc(d.receiver_id_no) : ''}`)}
                ${d.notes ? row('Notes', esc(d.notes)) : ''}</table>
                <div>${d.pod_photo_url ? `<img src="${esc(d.pod_photo_url)}" alt="Photo">` : ''}${d.pod_signature_url ? `<img src="${esc(d.pod_signature_url)}" alt="Signature">` : ''}</div></body></html>`);
        w.document.close();
        w.onload = () => setTimeout(() => w.print(), 300);
    };


    function renderCard(b: any, events: any[]) {
        const sea = /sea/i.test(b.package_type || '');
        const st = statusInfo.current[b.current_status_code] || {};
        const exception = Boolean(st.is_exception);
        const cancelled = b.current_status_code === 'CANCELLED';
        const step = sxStep(Math.min(8, b.current_stage || 1));
        const pct = step / (SX_STEPS.length - 1) * 100;
        const statusTone = cancelled ? 'pill-gray' : exception ? 'pill-coral' : step === 4 ? 'pill-green' : 'pill-coral';
        const eventIcon = (e: any): { name: IconName; tone: string } => {
            const s = statusInfo.current[e.status_code];
            if (!s) return { name: e.source === 'carrier_api' ? 'globe' : 'edit', tone: 'bg-gray-100 text-gray-500' };
            if (s.is_exception) return { name: 'alert', tone: 'bg-coral-50 text-coral-600' };
            if (s.stage >= 8) return { name: 'boxCheck', tone: 'bg-emerald-50 text-emerald-600' };
            return { name: STAGE_ICONS[s.stage] || 'box', tone: 'bg-[#111827] text-white' };
        };
        const tile = (label: string, value: ReactNode) => <div className="sx-tile ui-lift"><p className="sx-k">{label}</p><p className="sx-v">{value}</p></div>;
        const person = (label: string, icon: IconName, name: string, phone: string, where: string) => (
            <div className="sx-tile ui-lift">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="sx-k">{label}</p><p className="sx-v truncate">{name || '—'}</p></div>
                    <span className="sx-ic"><Icon name={icon} /></span>
                </div>
                {where && <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{where}</p>}
                {phone && <a href={`tel:${phone}`} className="sx-chip mt-2.5"><Icon name="phone" cls="w-3.5 h-3.5" /><span>{phone}</span></a>}
            </div>
        );
        let lastDay = '';
        const timeline = events.map((e, i) => {
            const dayS = fmtDate(e.event_at, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            const header = dayS !== lastDay ? <li className="sx-day">{dayS}</li> : null;
            lastDay = dayS;
            const ic = eventIcon(e);
            return <Fragment key={i}>{header}<li className={`sx-ev ${i === 0 ? 'latest' : ''}`} style={vars({ '--d': Math.min(i, 8) })}>
                <span className={`sx-ev-dot ${ic.tone}`}><Icon name={ic.name} cls="w-3.5 h-3.5" /></span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="text-[13px] font-extrabold">{e.status}</p><span className="text-[11px] font-bold text-gray-400 tabular-nums">{fmtDate(e.event_at, { hour: '2-digit', minute: '2-digit' })}</span></div>
                <p className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-3">{e.location && <span className="inline-flex items-center gap-1"><Icon name="pin" cls="w-3 h-3" />{e.location}</span>}<span className="inline-flex items-center gap-1"><Icon name={e.source === 'carrier_api' ? 'globe' : 'user'} cls="w-3 h-3" />{e.created_by_name || e.source}</span></p>
                {e.remark && <p className="text-xs text-gray-600 mt-2 bg-[#F8F8FA] rounded-xl px-3 py-2">{e.remark}</p>}</li></Fragment>;
        });
        const fab = (icon: IconName, label: string, onClick: () => void, cls = '') => <button type="button" className={`fab ${cls}`} onClick={onClick} title={label} aria-label={label}><Icon name={icon} /><span className="fab-label">{label}</span></button>;
        const tabs: ['info' | 'track' | 'pod', boolean][] = [['info', true], ['track', true], ['pod', !!pod]];
        const visible = tabs.filter(t => t[1]).map(t => t[0]);
        const tabI = visible.indexOf(cardTab);
        const tabBtn = (t: 'info' | 'track' | 'pod', label: ReactNode) => <button type="button" role="tab" className={`sx-tab${cardTab === t ? ' on' : ''}${t === 'pod' && !pod ? ' hidden' : ''}`} data-tab={t} aria-selected={cardTab === t} onClick={() => setCardTab(t)}>{label}</button>;
        const when = (v: string) => fmtDate(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const who = (d: any) => d.mode === 'collection' ? 'Collected at branch' : d.mode === 'agent' ? `${d.agent_name}${d.agent_ref ? ' · ' + d.agent_ref : ''}` : d.driver_name;

        return <>
            <div className="sx-top">
                <div className="sx-hero">
                    <span className="sx-badge"><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span>{`${sea ? 'Sea' : 'Air'} shipment card`}</span>
                    <button type="button" onClick={closeDrawer} aria-label="Close" className="sx-close"><Icon name="x" /></button>
                </div>
                <div className="sx-body">
                    <section className="sx-id" style={vars({ '--d': 0 })}>
                        <span className="sx-avatar"><Icon name={sea ? 'ship' : 'plane'} cls="w-6 h-6" /></span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="sx-awb">{b.awb}</h3>
                                <button type="button" className={`sx-copy${copied ? ' ok' : ''}`} data-copy={b.awb} title="Copy AWB" aria-label="Copy AWB"
                                    onClick={() => { navigator.clipboard?.writeText(b.awb); setCopied(true); setTimeout(() => setCopied(false), 1400); }}><Icon name={copied ? 'check' : 'copy'} cls="w-3.5 h-3.5" /></button>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                <span className={`pill-tag ${statusTone}`}>{b.current_status || 'New'}</span>
                                <span className="pill-tag pill-gray">{b.branch_code || '—'}</span>
                                <span className="pill-tag pill-gray">{b.intake_mode === 'pickup' ? 'Pickup' : 'Drop-off'}</span>
                            </div>
                        </div>
                    </section>
                    <section className="sx-route" style={vars({ '--d': 1 })}>
                        <div className="sx-end from">
                            <p className="sx-k"><Icon name="pin" cls="w-3 h-3" />Origin</p>
                            <p className="sx-city" title={b.origin_city || ''}>{b.origin_city || '—'}</p>
                            <span className="sx-country">{b.origin_country || '—'}</span>
                        </div>
                        <span className="sx-join" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></span>
                        <div className="sx-end to">
                            <p className="sx-k">Destination<Icon name="flag" cls="w-3 h-3" /></p>
                            <p className="sx-city" title={b.dest_city || ''}>{b.dest_city || '—'}</p>
                            <span className="sx-country">{b.dest_country || '—'}</span>
                        </div>
                    </section>
                    <section className={`sx-progress ${cancelled ? 'is-cancelled' : exception ? 'is-alert' : ''}`} style={vars({ '--d': 2, '--p': `${pct}%` })}>
                        <div className="flex items-center justify-between mb-5">
                            <div><p className="sx-k !mb-0">Shipment progress</p><p className="text-[11px] font-bold text-gray-400 mt-1 flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${exception ? 'bg-coral-500' : 'bg-emerald-500'}`}></span>{`Updated ${fmtDate(events[0]?.event_at || b.updated_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</p></div>
                            <span className={`text-[11px] font-extrabold ${exception || cancelled ? 'text-coral-600' : 'text-gray-500'}`}>{exception || cancelled ? b.current_status : SX_STEPS[step][0]}</span>
                        </div>
                        <ol className="sx-track"><span className="sx-rail"><span className="sx-rail-fill"></span></span>{SX_STEPS.map(([name, icon], i) => {
                            const cls = i < step || (i === step && step === 4) ? 'done' : i === step ? (exception || cancelled ? 'alert' : 'now') : '';
                            return <li key={i} className={`sx-step ${cls}`} style={vars({ '--d': i })}><span className="sx-dot"><Icon name={cls === 'alert' ? 'alert' : icon} /></span><span className="sx-step-name">{name}</span></li>;
                        })}</ol>
                    </section>
                    <div className="sx-tabs" role="tablist" style={vars({ '--d': 3, '--n': pod ? 3 : 2, '--i': tabI })}>
                        <span className="sx-tab-ind"></span>
                        {tabBtn('info', 'Details')}
                        {tabBtn('track', <>{'Tracking '}<span className="sx-count">{events.length}</span></>)}
                        {tabBtn('pod', 'Delivery')}
                    </div>
                </div>
            </div>

            <div className="sx-scroll pretty-scroll">
                <div className="sx-panes">
                    <div className={`sx-pane${cardTab === 'info' ? '' : ' hidden'}`} data-pane="info">
                        <div className="grid grid-cols-2 gap-2.5">
                            {tile('Type', b.package_type || '—')}
                            {tile('Weight', <>{`${b.chargeable_weight ?? b.weight ?? '—'} `}<span className="text-gray-400 text-[11px] font-bold">kg</span></>)}
                            {tile('Pieces', b.pieces ?? '—')}
                            {tile(b.amount != null ? 'Charge' : 'Declared value', b.amount ?? b.declared_value ?? '—')}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
                            {person('Shipper', 'user', b.shipper, b.shipper_phone, [b.origin_city, b.origin_country].filter(Boolean).join(', '))}
                            {person('Consignee', 'pin', b.consignee, b.consignee_phone, b.consignee_address || [b.dest_city, b.dest_country].filter(Boolean).join(', '))}
                        </div>
                        <div className="sx-tile sx-soft mt-2.5 flex items-center justify-between gap-3">
                            <div><p className="sx-k !text-coral-600">Booked</p><p className="sx-v">{fmtDate(b.booked_at, { day: '2-digit', month: 'short', year: 'numeric' })}</p></div>
                            <span className="sx-chip !bg-white"><Icon name={b.source === 'alfarhaonline' ? 'link' : 'edit'} cls="w-3.5 h-3.5" /><span>{b.source === 'alfarhaonline' ? `Al-Farha ${b.external_ref || ''}` : 'Manual entry'}</span></span>
                        </div>
                        {(b.fwd_docket || b.fwd_agent) && <div className="sx-tile ui-lift mt-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0"><p className="sx-k">Forwarding agent</p><p className="sx-v truncate">{`${b.fwd_agent || '—'} `}<span className="text-gray-400 text-[11px]">{`· ${b.fwd_docket || '—'}`}</span></p></div>
                            <p className={`text-[11px] font-bold text-right ${b.carrier_error ? 'text-coral-600' : 'text-gray-500'}`}>{b.carrier_error ? b.carrier_error : b.carrier_synced_at ? `Synced ${fmtDate(b.carrier_synced_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet'}</p>
                        </div>}
                    </div>
                    <div className={`sx-pane${cardTab === 'track' ? '' : ' hidden'}`} data-pane="track">
                        <ol className="sx-timeline">{timeline.length ? timeline : <li className="text-xs text-gray-400 py-6 text-center">No events yet.</li>}</ol>
                    </div>
                    <div className={`sx-pane${cardTab === 'pod' ? '' : ' hidden'}`} data-pane="pod"><div id="podBox">
                        {pod && <div className="space-y-3">
                            <div className="flex items-center justify-between"><span className="sd-label">{'Delivery & proof of delivery'}</span>
                                {pod.list.some(d => d.status === 'delivered') && <button type="button" className="btn btn-light btn-sm" onClick={printPod}><Icon name="clipboard" cls="w-3.5 h-3.5" />Print POD</button>}</div>
                            {pod.b.reviewed_at && <div className="flex items-center gap-2 bg-amber-50 rounded-2xl px-4 py-3"><span className="text-amber-500 font-extrabold">{'★'.repeat(pod.b.review_rating || 0)}</span><span className="text-gray-300 font-extrabold">{'★'.repeat(5 - (pod.b.review_rating || 0))}</span><span className="text-xs text-gray-600">{pod.b.review_comment || 'Customer review'}</span></div>}
                            {pod.list.slice().reverse().map((d, i) => (
                                <div key={i} className="border border-gray-100 rounded-2xl p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-xs font-extrabold">{`Attempt ${d.attempt} · ${who(d) || '—'}`}</p>
                                        {d.status === 'delivered' ? <span className="pill-tag pill-green">Delivered</span> : d.status === 'failed' ? <span className="pill-tag pill-coral">Failed</span> : <span className="pill-tag pill-dark">Out for delivery</span>}
                                    </div>
                                    <p className="text-[11px] text-gray-500 mt-1">{d.status === 'delivered'
                                        ? <>{'Received by '}<b>{d.received_by}</b>{`${d.receiver_relation ? ' (' + d.receiver_relation + ')' : ''}${d.receiver_id_no ? ' · ID ' + d.receiver_id_no : ''}${d.completed_at ? ' · ' + when(d.completed_at) : ''}${d.completed_by_name ? ' · by ' + d.completed_by_name : ''}`}</>
                                        : `${d.failure_reason ? d.failure_reason : 'Sent ' + when(d.assigned_at)}${d.completed_at ? ' · ' + when(d.completed_at) : ''}${d.completed_by_name ? ' · by ' + d.completed_by_name : ''}`}</p>
                                    {d.notes && <p className="text-xs text-gray-600 mt-1.5 bg-[#F8F8FA] rounded-xl px-3 py-2">{d.notes}</p>}
                                    {(d.pod_photo_url || d.pod_signature_url) && <div className="flex gap-2 mt-3">
                                        {d.pod_photo_url && <a href={d.pod_photo_url} target="_blank" rel="noopener"><img src={d.pod_photo_url} alt="POD photo" className="w-24 h-24 object-cover rounded-xl border border-gray-100" /></a>}
                                        {d.pod_signature_url && <a href={d.pod_signature_url} target="_blank" rel="noopener"><img src={d.pod_signature_url} alt="Signature" className="w-40 h-24 object-contain rounded-xl border border-gray-100 bg-white" /></a>}
                                    </div>}
                                    {d.lat && <a className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 mt-2 hover:text-coral-600" target="_blank" rel="noopener" href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}><Icon name="pin" cls="w-3 h-3" />Delivery location</a>}
                                </div>))}
                        </div>}
                    </div></div>
                </div>
            </div>

            <footer className="sx-foot">
                {actions ? actions(b, { cancelled, fab }) : <>
                    <PageLink page="shipments.html" search={`?awb=${encodeURIComponent(b.awb)}`} data-peek="off" className="fab fab-open flex-shrink-0" title="Open in Shipments"><Icon name="box" /><span className="fab-label">Open in Shipments</span></PageLink>
                    <PageLink page="status-update.html" search={`?awb=${encodeURIComponent(b.awb)}`} className="fab fab-open fab-primary flex-shrink-0" title="Update status"><Icon name="refresh" /><span className="fab-label">Update status</span></PageLink>
                </>}
            </footer>
        </>;
    }

    return <>
        <div id="drawer" className={`sx-modal${drawerOpen ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeDrawer(); }}>
            <div id="drawerBody" className="sx-panel" role="dialog" aria-modal="true" aria-label="Shipment details">
                {drawerOpen && (card.state === 'loading'
                    ? <div className="flex flex-col items-center justify-center gap-3 h-72 text-xs font-bold text-gray-300"><span className="w-10 h-10 rounded-full border-4 border-gray-100 border-t-coral-500 animate-spin"></span>Loading shipment…</div>
                    : card.state === 'error'
                        ? <div className="p-8"><p className="text-xs text-coral-600">{card.msg}</p><button type="button" className="btn btn-light btn-sm mt-4" onClick={closeDrawer}>Close</button></div>
                        : renderCard(card.b, card.events))}
            </div>
        </div>
    </>;
}

/** Opens the shipment drawer for any link to /app/shipments?awb=… on any page (and window event 'alf:shipment'). */
export function ShipmentPeek() {
    const [awb, setAwb] = useState<string | null>(null);
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const open = (a: string) => { setAwb(a); setVersion(v => v + 1); };
        const click = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!a || a.target === '_blank' || a.dataset.peek === 'off') return;
            const url = new URL(a.href, location.href);
            const awbQ = url.searchParams.get('awb');
            if (url.origin !== location.origin || url.pathname.replace(/\/$/, '') !== '/app/shipments' || !awbQ) return;
            e.preventDefault(); e.stopPropagation();       // before the in-app link moves to the Shipments page
            open(awbQ);
        };
        const ev = (e: Event) => { const a = (e as CustomEvent<string>).detail; if (a) open(a); };
        document.addEventListener('click', click, true);   // capture: runs before React's own link handling
        window.addEventListener('alf:shipment', ev);
        return () => { document.removeEventListener('click', click, true); window.removeEventListener('alf:shipment', ev); };
    }, []);
    return <ShipmentDrawer awb={awb} version={version} onClose={() => setAwb(null)} />;
}

/** open the shipment drawer from code */
export const openShipment = (awb: string) => window.dispatchEvent(new CustomEvent('alf:shipment', { detail: awb }));
