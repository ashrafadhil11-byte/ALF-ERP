// Scan & Update — same page as admin/status-update.html: scan AWBs into a batch, pick a milestone, update in one go.
// Data: GET /api/status (milestones, saved agents) · GET /api/bookings?awb= · POST /api/status
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { PageLink } from '../components/PageLink';
import { ScanInput } from '../components/fields/Scan';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { clean } from '../lib/format';
import { pickBoxes } from '../lib/pickBoxes';
import { beep, toast } from '../lib/toast';

const STAGES = ['', 'Booking', 'Pickup', 'Origin', 'Export', 'Transit', 'Destination', 'Last Mile', 'Delivered', 'Review'];
const CARRIERS = ['SMSA', 'Aramex', 'DHL', 'Delhivery', 'FedEx', 'UPS', 'India Post', 'Nepal Post'];
type Extra = { id: string; label: string; kind: 'agent' | 'docket' | 'text' };
const EXTRA: Record<string, Extra[]> = {
    agent_docket: [{ id: 'fwd_agent', label: 'Forwarding agent', kind: 'agent' }, { id: 'fwd_docket', label: 'Agent docket no.', kind: 'docket' }],
    delivery_docket: [{ id: 'delivery_agent', label: 'Delivery agent', kind: 'agent' }, { id: 'delivery_docket', label: 'Docket / LR no.', kind: 'docket' }],
    to_branch: [{ id: 'to_branch', label: 'To branch', kind: 'text' }],
    mawb: [{ id: 'mawb', label: 'MAWB number', kind: 'text' }],
    driver: [{ id: 'driver', label: 'Driver', kind: 'text' }]
};
type Status = { code: string; label: string; stage: number; is_exception?: boolean; requires: string[] };
type Item = { awb: string; consignee?: string; status?: string; error?: string; pieces?: number[] | null; total?: number; docket?: string };
type LogLine = { status: string; awbs: string[]; at: string };

export function StatusUpdate() {
    const [params] = useSearchParams();
    const [statuses, setStatuses] = useState<Status[]>([]);
    const [agents, setAgents] = useState<{ name: string }[] | null>(null);
    const batch = useRef<Item[]>([]);
    const [, force] = useState(0);
    const rerender = () => force(n => n + 1);
    const [code, setCode] = useState('');
    const [extra, setExtra] = useState<Record<string, string>>({});
    const [eventAt, setEventAt] = useState('');
    const [locationV, setLocationV] = useState('');
    const [remark, setRemark] = useState('');
    const [paste, setPaste] = useState('');
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<LogLine[]>([]);
    const scan = useRef<HTMLInputElement>(null);

    const st = statuses.find(s => s.code === code);
    const req = st ? st.requires : [];
    // a status with an agent docket: one docket for all, or (several shipments) each its own
    const docketKey = req.includes('delivery_docket') ? 'delivery_docket' : req.includes('agent_docket') ? 'fwd_docket' : null;
    const [perAwb, setPerAwb] = useState(false);
    const eachDocket = Boolean(docketKey && perAwb && batch.current.filter(b => !b.error).length > 1);
    const extras = req.flatMap(r => EXTRA[r] || []).filter(x => !(eachDocket && x.id === docketKey));
    const ok = batch.current.filter(b => !b.error);

    async function addAwb(raw: string) {
        const awb = clean(raw);
        if (!awb || batch.current.some(b => b.awb === awb)) return;
        const item: Item = { awb };
        batch.current = [item, ...batch.current]; rerender();
        try {
            const { booking } = await api<{ booking: { awb: string; consignee?: string; current_status?: string } }>('/api/bookings?awb=' + encodeURIComponent(awb));
            item.awb = booking.awb; item.consignee = booking.consignee; item.status = booking.current_status;
            beep(true);
            // several boxes: all ticked, staff untick the ones not here
            const pick = await pickBoxes(item.awb, { title: 'Boxes for this update', confirmText: 'Add to batch' });
            if (!pick) { batch.current = batch.current.filter(b => b !== item); rerender(); return; }
            item.pieces = pick.pieces; item.total = pick.total;
        } catch (e) { item.error = (e as Error).message; beep(false); }
        rerender();
    }
    const reBoxes = async (it: Item) => {
        const pick = await pickBoxes(it.awb, { title: 'Boxes for this update', confirmText: 'Save' });
        if (pick) { it.pieces = pick.pieces; rerender(); }
    };

    async function update() {
        const awbs = ok.map(b => b.awb);
        const pieces = Object.fromEntries(ok.filter(b => b.pieces).map(b => [b.awb, b.pieces]));
        const body: Record<string, unknown> = { awbs, pieces, code: st!.code, location: locationV, remark, event_at: eventAt ? new Date(eventAt).toISOString() : undefined };
        extras.forEach(x => { body[x.id] = (extra[x.id] || '').trim(); });
        if (eachDocket) {
            const missing = ok.filter(b => !(b.docket || '').trim()).map(b => b.awb);
            if (missing.length) { toast(false, `Enter the docket number for ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`); return; }
            body.dockets = Object.fromEntries(ok.map(b => [b.awb, (b.docket || '').trim()]));
        }
        if (!await confirm({ title: `Set ${awbs.length} shipment(s) to “${st!.label}”?`, message: awbs.slice(0, 12).join(', ') + (awbs.length > 12 ? ` and ${awbs.length - 12} more` : ''), confirmText: 'Update' })) return;
        setBusy(true);
        try {
            const r = await api<{ updated: number; status: string }>('/api/status', { method: 'POST', body });
            toast(true, `${r.updated} shipment(s) → ${r.status}`); beep(true);
            setLog(l => [{ status: r.status, awbs, at: new Date().toLocaleTimeString() }, ...l]);
            batch.current = []; setRemark('');
        } catch (e) { toast(false, (e as Error).message); beep(false); }
        setBusy(false);
    }

    useEffect(() => {
        (async () => {
            try {
                const { statuses: list, agents: ag = [] } = await api<{ statuses: Status[]; agents?: { name: string }[] }>('/api/status');
                setStatuses(list); setAgents(ag);
            } catch (e) { toast(false, (e as Error).message); }
            const pre = params.get('awb');
            if (pre) addAwb(pre);
            scan.current?.focus();
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // milestone list grouped by stage, exceptions together
    const groups: Record<string, Status[]> = {};
    statuses.forEach(s => (groups[s.is_exception ? 'Exceptions' : STAGES[s.stage]] ||= []).push(s));
    const known = new Set((agents || []).map(a => a.name.toLowerCase()));

    return (
        <AppFrame after={
            <datalist id="carrierList">
                {agents === null ? CARRIERS.map(n => <option key={n}>{n}</option>) : <>
                    {/* saved agents first (Accounts → Suppliers & agents), then the common carriers */}
                    {agents.map(a => <option key={'a' + a.name} value={a.name}>Saved agent</option>)}
                    {CARRIERS.filter(n => !known.has(n.toLowerCase())).map(n => <option key={n} value={n}></option>)}
                </>}
            </datalist>
        }>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path></svg>
                        </div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Scan &amp; Update Status</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Scan AWBs • pick a milestone • update in one go</p>
                        </div>
                    </div>
                    <PageLink page="shipments.html" className="btn btn-light self-start sm:self-auto"><Icon name="arrowLeft" />Shipments</PageLink>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-5 gap-5">
                    {/* 1. Scan batch */}
                    <div className="xl:col-span-3 bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#111827] text-white text-[11px] font-extrabold flex items-center justify-center">1</span><span className="font-extrabold text-xs uppercase tracking-wider">Scan shipments</span></div>
                            <span id="batchCount" className="pill-tag pill-dark">{`${ok.length} in batch`}</span>
                        </div>
                        <form id="scanForm" className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); const el = scan.current!; const v = el.value; el.value = ''; el.focus(); addAwb(v); }}>
                            <ScanInput ref={scan} mode="submit" continuous inputProps={{ id: 'scanInput', className: 'field scan', placeholder: 'Scan or type AWB, press Enter', autoComplete: 'off', 'aria-label': 'AWB' }} />
                            <button className="btn btn-dark">Add</button>
                        </form>
                        <details>
                            <summary className="cursor-pointer text-[11px] font-bold text-gray-500">Paste a list of AWBs</summary>
                            <div className="flex flex-col sm:flex-row gap-2 mt-2">
                                <textarea id="pasteInput" rows={3} className="field" placeholder="One per line or comma separated" value={paste} onChange={e => setPaste(e.target.value)}></textarea>
                                <button id="pasteBtn" type="button" className="btn btn-light self-start" onClick={async () => { const list = paste.split(/[\s,;]+/).filter(Boolean); setPaste(''); for (const a of list) await addAwb(a); }}>Add all</button>
                            </div>
                        </details>
                        <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                            <table className="rtable w-full text-xs">
                                <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                    <th className="p-3 pl-4 font-extrabold">AWB</th><th className="p-3 font-extrabold">Consignee</th><th className="p-3 font-extrabold">Current status</th>{eachDocket && <th className="p-3 font-extrabold">Docket / LR no.</th>}<th className="p-3 w-10"></th>
                                </tr></thead>
                                <tbody id="batchRows" className="divide-y divide-gray-100">
                                    {batch.current.length ? batch.current.map(b => (
                                        <tr key={b.awb} className={b.error ? 'bg-[#FFF5F3]' : ''}>
                                            <td className="cell-main p-3 pl-4 font-extrabold"><PageLink page="shipments.html" search={`?awb=${encodeURIComponent(b.awb)}`} className="hover:text-coral-500">{b.awb}</PageLink></td>
                                            <td className="p-3 truncate max-w-[180px]" data-label="Consignee">{b.error ? <span className="text-coral-600 font-bold">{b.error}</span> : b.consignee || '—'}
                                                {!b.error && (b.total || 0) > 1 && <button type="button" onClick={() => reBoxes(b)} className={`block text-[10px] font-extrabold ${b.pieces ? 'text-[#D55C48]' : 'text-gray-400'} hover:underline`}>{(b.pieces ? `Boxes ${b.pieces.join(', ')} of ${b.total}` : `All ${b.total} boxes`) + ' · change'}</button>}</td>
                                            <td className="p-3" data-label="Status">{b.error ? '' : <span className="pill-tag pill-coral">{b.status || 'New'}</span>}</td>
                                            {eachDocket && <td className="p-2" data-label="Docket / LR no.">{!b.error && <input className="field !py-1.5 !w-36" data-docket={b.awb} value={b.docket || ''} placeholder="Docket / LR" aria-label={`Docket number for ${b.awb}`}
                                                onChange={e => { b.docket = e.target.value; rerender(); }} />}</td>}
                                            <td className="cell-menu p-3"><button type="button" onClick={() => { batch.current = batch.current.filter(x => x !== b); rerender(); }} aria-label={`Remove ${b.awb}`} className="icon-btn !w-7 !h-7 hover:!text-coral-600"><Icon name="x" cls="w-3.5 h-3.5" /></button></td>
                                        </tr>
                                    )) : <tr><td colSpan={eachDocket ? 5 : 4} className="cell-empty p-6 text-center text-gray-400">Scan AWBs to build the batch.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        <button type="button" onClick={() => { batch.current = []; rerender(); }} className="text-[11px] font-bold text-gray-400 hover:text-gray-900 underline self-start">Clear batch</button>
                    </div>

                    {/* 2. Status */}
                    <div className="xl:col-span-2 bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 flex flex-col gap-4">
                        <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#111827] text-white text-[11px] font-extrabold flex items-center justify-center">2</span><span className="font-extrabold text-xs uppercase tracking-wider">New status</span></div>
                        <div><label className="ui-label" htmlFor="statusSelect">Milestone <span className="req">*</span></label>
                            <select id="statusSelect" className="field" value={code} onChange={e => setCode(e.target.value)}>
                                {statuses.length > 0 && <option value="">Choose milestone…</option>}
                                {Object.entries(groups).map(([g, items]) => <optgroup key={g} label={g}>{items.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}</optgroup>)}
                            </select></div>
                        {docketKey && batch.current.filter(b => !b.error).length > 1 && <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
                            <input type="checkbox" id="perAwbDocket" checked={perAwb} onChange={e => setPerAwb(e.target.checked)} />Different docket for each shipment (enter them in the list)</label>}
                        <div id="extraFields" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {extras.map(x => {
                                const props = { id: `x_${x.id}`, 'data-extra': x.id, className: 'field', value: extra[x.id] || '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setExtra(v => ({ ...v, [x.id]: e.target.value })) };
                                return (
                                    <div key={x.id}><label className="ui-label" htmlFor={`x_${x.id}`}>{x.label} <span className="req">*</span></label>
                                        {x.kind === 'docket' ? <ScanInput mode="fill" inputProps={{ ...props, 'aria-label': 'agent docket number', autoComplete: 'off', placeholder: 'Scan or type' }} />
                                            : x.kind === 'agent' ? <input {...props} list="carrierList" autoComplete="off" placeholder="Pick or type the agent" />
                                                : <input {...props} />}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div><label className="ui-label" htmlFor="eventAt">Date &amp; time</label><input id="eventAt" type="datetime-local" className="field" value={eventAt} onChange={e => setEventAt(e.target.value)} /></div>
                            <div><label className="ui-label" htmlFor="location">Location</label><input id="location" className="field" placeholder="Defaults to your branch" value={locationV} onChange={e => setLocationV(e.target.value)} /></div>
                        </div>
                        <div><label className="ui-label" htmlFor="remark">Remark <span id="remarkReq" className={`req${req.includes('remark') ? '' : ' hidden'}`}>*</span></label><input id="remark" className="field" placeholder="Optional note shown on the timeline" value={remark} onChange={e => setRemark(e.target.value)} /></div>
                        <button id="updateBtn" type="button" disabled={busy || !ok.length || !code} className="btn btn-coral !py-4 !text-sm mt-auto" onClick={update}>{busy ? 'Updating…' : `Update ${ok.length} shipment${ok.length === 1 ? '' : 's'}`}</button>
                        <p className="text-[10px] text-gray-400 leading-relaxed">Statuses only move forward. Managers can move one back. Exceptions (hold, failed delivery…) need a remark.</p>
                    </div>
                </section>

                {/* Session log */}
                <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 mt-5">
                    <div className="flex items-center gap-2 mb-3"><span className="font-extrabold text-xs uppercase tracking-wider">Updated this session</span><span className="w-2 h-2 rounded-full bg-coral-500"></span></div>
                    <ul id="log" className="space-y-2">
                        {log.length ? log.map((l, i) => (
                            <li key={log.length - i} className="bg-white rounded-2xl px-4 py-3 border border-gray-100 flex flex-wrap justify-between gap-2 text-xs">
                                <span><b>{l.status}</b>{' • ' + l.awbs.join(', ')}</span><span className="text-gray-400">{l.at}</span></li>
                        )) : <li className="text-xs text-gray-400">Nothing yet.</li>}
                    </ul>
                </section>
            </div>
        </AppFrame>
    );
}
