// Attendance — same page as admin/attendance.html. Tabs: My attendance (punch, break, month calendar, leave requests);
// managers also get Today, Report (+ CSV), Leave approvals and Shifts. Data: GET/POST /api/attendance
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { confirm } from '../lib/dialogs';
import { session } from '../lib/session';
import { beep, toast } from '../lib/toast';
import './attendance.css';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ST: Record<string, [string, string]> = { present: ['pill-green', 'Present'], late: ['pill-amber', 'Late'], absent: ['pill-coral', 'Absent'], leave: ['pill-dark', 'Leave'], off: ['pill-gray', 'Off'], upcoming: ['pill-gray', '—'] };
const LS: Record<string, string> = { pending: 'pill-amber', approved: 'pill-green', rejected: 'pill-coral', cancelled: 'pill-gray' };
export const hm = (v?: string | null) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
export const hrs = (m?: number) => m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—';
export const dd = (v: string) => new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const Pill = ({ s }: { s: string }) => <span className={`pill-tag ${ST[s]?.[0] || 'pill-gray'}`}>{ST[s]?.[1] || s}</span>;
const hh = (v?: string | null) => v ? String(v).slice(0, 5) : '';

type Tab = 'me' | 'today' | 'report' | 'leave' | 'shifts';
type Rec = { check_in?: string; check_out?: string; break_started_at?: string; break_ended_at?: string; break_min?: number; break_over_min?: number; late_min?: number; worked_min?: number };
type Leave = { id: number; from_date: string; to_date: string; reason?: string; leave_type: string; days: number; status: string; decided_by?: string; decision_note?: string; full_name?: string; branch_code?: string };
type DayRow = { employee_id: string; work_date: string; full_name: string; branch?: string; status: string; leave_type?: string; edited?: boolean; check_in?: string; check_out?: string; late_min?: number; worked_min?: number };
type ShiftRow = { id: string; full_name: string; branch?: string; role?: string; shift_start: string; shift_end: string; break_start?: string; break_end?: string; grace_min: number; weekly_off?: number[] };

/** Same table markup as the old page's table(heads, rows, empty) helper. */
function Table({ heads, children, empty }: { heads: [string, ('right' | undefined)?][]; children: ReactNode[]; empty: string }) {
    return (
        <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden"><table className="rtable w-full text-xs">
            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                {heads.map(([h, a], i) => <th key={i} className={`p-3 ${i === 0 ? 'pl-4' : ''} ${i === heads.length - 1 ? 'pr-4' : ''} font-extrabold ${a === 'right' ? 'text-right' : ''}`}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">{children.length ? children : <tr><td colSpan={heads.length} className="p-10 text-center text-gray-400">{empty}</td></tr>}</tbody></table></div>
    );
}

function Clock() {
    const [t, setT] = useState(() => new Date());
    useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
    return <p id="clock" className="text-4xl font-extrabold tabular-nums my-2">{t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>;
}

function ModalHead({ title, sub, subId }: { title: string; sub?: string; subId?: string }) {
    const dismiss = useDismiss();
    return (
        <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
            {subId ? <div><h3 className="text-lg font-extrabold">{title}</h3><p id={subId} className="text-xs text-gray-400 mt-0.5">{sub}</p></div> : <h3 className="text-lg font-extrabold">{title}</h3>}
            <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>
        </div>
    );
}

export function Attendance() {
    const qc = useQueryClient();
    const isMgr = ['super_admin', 'head_office', 'branch_manager'].includes(session.role());
    const [tab, setTab] = useState<Tab>('me');
    const [view, setView] = useState<{ tab: Tab; d: any; n: number } | null>(null);   // what the pane shows (kept until the next one is loaded)
    const [error, setError] = useState<string | null>(null);
    const [leaveCount, setLeaveCount] = useState('');
    const month = useRef<string | null>(null);
    const range = useRef<{ from?: string; to?: string }>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [gpsNote, setGpsNote] = useState<string | null>(null);
    // popups
    const [leaveOpen, setLeaveOpen] = useState(false);
    const [lf, setLf] = useState({ type: 'annual', from: '', to: '', reason: '' });
    const [fixing, setFixing] = useState<DayRow | null>(null);
    const [fixOpen, setFixOpen] = useState(false);
    const [fx, setFx] = useState({ in: '', out: '', reason: '' });
    const [shiftEmp, setShiftEmp] = useState<ShiftRow | null>(null);
    const [shiftOpen, setShiftOpen] = useState(false);
    const [sh, setSh] = useState({ start: '', end: '', brStart: '', brEnd: '', grace: '', off: [] as number[] });

    useLive(() => show());   // reload when data changes (here, by Farah, another tab) — lib/live.ts
    async function show(t: Tab = tab) {
        try {
            let d: any;
            if (t === 'me') { d = await api(`/api/attendance?view=me${month.current ? '&month=' + month.current : ''}`); month.current = d.month; }
            else if (t === 'today') d = await api('/api/attendance?view=day');
            else if (t === 'report') {
                const to = range.current.to || new Date().toISOString().slice(0, 10), from = range.current.from || to.slice(0, 8) + '01';
                d = await api(`/api/attendance?view=report&from=${from}&to=${to}`);
            } else if (t === 'leave') {
                d = await api('/api/attendance?view=leave');
                const pending = d.rows.filter((l: Leave) => l.status === 'pending').length;
                setLeaveCount(pending ? `· ${pending}` : '');
            } else d = await api('/api/attendance?view=shifts');
            setError(null); setGpsNote(null); setBusy(null);
            setView(v => ({ tab: t, d, n: (v?.n || 0) + 1 }));
        } catch (e) { setError((e as Error).message); setView(v => ({ tab: t, d: null, n: (v?.n || 0) + 1 })); }
    }
    useEffect(() => {
        show('me');
        if (isMgr) api<{ rows: Leave[] }>('/api/attendance?view=leave&status=pending').then(d => setLeaveCount(d.rows.length ? `· ${d.rows.length}` : '')).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const pick = (t: Tab) => { setTab(t); show(t); };

    // ---------- punch ----------
    function position(): Promise<GeolocationCoordinates> {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
            navigator.geolocation.getCurrentPosition(p => resolve(p.coords), err => reject(new Error(err.code === 1
                ? 'Location is blocked. Allow location for this site in your browser settings, then try again.'
                : 'Could not get your location. Move near a window or turn on GPS and try again.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        });
    }
    async function punch(kind: string) {
        const me = view?.d;
        setBusy(kind === 'break' ? 'break' : 'punch');
        const gps = kind === 'in' || kind === 'out';
        if (gps) setGpsNote('Getting your location…');
        try {
            let c: GeolocationCoordinates | null = null;
            if (gps && me.branch?.has_location) c = await position();
            else if (gps) c = await position().catch(() => null);
            const out = await api<{ record: Rec }>('/api/attendance', { method: 'POST', body: { action: 'punch', kind, lat: c?.latitude, lng: c?.longitude, accuracy: c?.accuracy } });
            const rec = out.record;
            toast(true, ({ in: `Checked in at ${hm(rec.check_in)}${rec.late_min ? ` — ${rec.late_min} min late` : ''}.`, break: `Break started at ${hm(rec.break_started_at)}.`,
                resume: `Back from break${rec.break_over_min ? ` — ${rec.break_over_min} min over` : ''}.`, out: `Checked out at ${hm(rec.check_out)}. Worked ${hrs(rec.worked_min)}.` } as Record<string, string>)[kind]);
            qc.invalidateQueries({ queryKey: ['attendance', 'status'] });   // the top-bar buttons follow
            beep(true);
            show();
        } catch (e) { toast(false, (e as Error).message); setBusy(null); setGpsNote((e as Error).message); }
    }

    // ---------- actions ----------
    const cancelLeave = async (id: number) => {
        if (!await confirm({ title: 'Cancel this leave request?', message: '', confirmText: 'Cancel request' })) return;
        try { await api('/api/attendance', { method: 'POST', body: { action: 'leave_cancel', id } }); show(); } catch (err) { toast(false, (err as Error).message); }
    };
    const leaveDays = () => { if (!lf.from || !lf.to) return 0; return Math.round((+new Date(lf.to) - +new Date(lf.from)) / 864e5) + 1; };
    const sendLeave = async (e: React.FormEvent) => {
        e.preventDefault();
        try { await api('/api/attendance', { method: 'POST', body: { action: 'leave_request', leave_type: lf.type, from_date: lf.from, to_date: lf.to, reason: lf.reason } }); setLeaveOpen(false); toast(true, 'Leave request sent to your manager.'); show(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const openFix = (r: DayRow) => {
        const t = (v?: string) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
        setFixing(r); setFx({ in: t(r.check_in), out: t(r.check_out), reason: '' }); setFixOpen(true);
    };
    const saveFix = async (e: React.FormEvent) => {
        e.preventDefault();
        try { await api('/api/attendance', { method: 'POST', body: { action: 'manual', employee_id: fixing!.employee_id, date: fixing!.work_date, check_in: fx.in || null, check_out: fx.out || null, reason: fx.reason } }); setFixOpen(false); toast(true, 'Corrected.'); show(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const decide = async (decision: string, id: number) => {
        const note = decision === 'rejected' ? prompt('Reason (shown to the employee):', '') : '';
        if (note === null) return;
        try { await api('/api/attendance', { method: 'POST', body: { action: 'leave_decide', id, decision, note } }); toast(true, decision === 'approved' ? 'Approved.' : 'Rejected.'); show(); } catch (err) { toast(false, (err as Error).message); }
    };
    const openShift = (r: ShiftRow) => {
        setShiftEmp(r);
        setSh({ start: hh(r.shift_start), end: hh(r.shift_end), grace: String(r.grace_min), brStart: hh(r.break_start), brEnd: hh(r.break_end), off: [...(r.weekly_off || [])] });
        setShiftOpen(true);
    };
    const saveShift = async (e: React.FormEvent) => {
        e.preventDefault();
        const off = [1, 2, 3, 4, 5, 6, 7].filter(n => sh.off.includes(n));
        try { await api('/api/attendance', { method: 'POST', body: { action: 'shift', employee_id: shiftEmp!.id, shift_start: sh.start, shift_end: sh.end, break_start: sh.brStart, break_end: sh.brEnd, grace_min: +sh.grace, weekly_off: off } }); setShiftOpen(false); toast(true, 'Shift saved.'); show(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const csv = async (from: string, to: string) => {
        try {
            const res = await fetch(`/api/attendance?view=report&format=csv&from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${session.token()}` } });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed.');
            const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `attendance_${from}_${to}.csv`; a.click();
        } catch (e) { toast(false, (e as Error).message); }
    };

    // ---------- panes ----------
    function Me({ me }: { me: any }) {
        const r: Rec | null = me.record;
        const onBreak = Boolean(r?.break_started_at && !r.break_ended_at && !r.check_out);
        const state = !r?.check_in ? 'in' : r.check_out ? 'done' : onBreak ? 'resume' : 'out';
        const off = me.shift.weekly_off.map((n: number) => DOW[n - 1]).join(', ');
        const [y, m] = me.month.split('-').map(Number);
        const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
        const tot = me.days.reduce((t: any, d: any) => { t[d.status] = (t[d.status] || 0) + 1; t.late_min += d.late_min; t.worked += d.worked_min; return t; }, { late_min: 0, worked: 0 });
        const kpi = (l: string, v: ReactNode, cls = '') => <div className="bg-[#F8F8FA] rounded-2xl p-3"><p className="sd-label">{l}</p><div className={`text-lg font-extrabold ${cls}`}>{v}</div></div>;
        const step = (n: number) => { month.current = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); show(); };
        const note = gpsNote ?? (me.branch ? (me.branch.has_location ? `Must be within ${me.branch.geofence_m} m of ${me.branch.name || me.branch.code} — uses your location.` : `${me.branch.name || me.branch.code} has no location set yet, so your position is not checked.`) : 'Your account has no branch.');
        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="bg-[#F8F8FA] rounded-[2rem] p-6 flex flex-col items-center text-center">
                    <p className="sd-label">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
                    <Clock />
                    <p className="text-xs text-gray-500 mb-5">{`Shift ${me.shift.start}–${me.shift.end}${me.shift.break_start ? ` · break ${me.shift.break_start}–${me.shift.break_end}` : ''} · ${me.shift.grace_min} min grace · off ${off || 'none'}`}</p>
                    {state === 'done'
                        ? <div className="punch bg-emerald-50 text-emerald-700 flex flex-col items-center justify-center"><Icon name="check" cls="w-8 h-8" /><b className="mt-2">Day complete</b><span className="text-xs">{`${hm(r!.check_in)} – ${hm(r!.check_out)}`}</span></div>
                        : <button type="button" id="punchBtn" disabled={busy === 'punch'} onClick={() => punch(state)}
                            className={`punch ${state === 'in' ? 'bg-[#111827]' : state === 'resume' ? 'bg-amber-500' : 'bg-coral-500'} text-white flex flex-col items-center justify-center shadow-xl hover:scale-[1.02] transition-transform${busy === 'punch' ? ' opacity-70' : ''}`}>
                            <Icon name="fingerprint" cls="w-10 h-10" /><b className="mt-2 text-lg">{state === 'in' ? 'Check in' : state === 'resume' ? 'End break' : 'Check out'}</b>
                            {state === 'resume' ? <span className="text-xs opacity-90">{`on break since ${hm(r!.break_started_at)}`}</span> : r?.check_in ? <span className="text-xs opacity-80">{`in since ${hm(r.check_in)}`}</span> : null}
                        </button>}
                    {state === 'out' && !r!.break_started_at && <button type="button" id="breakBtn" disabled={busy === 'break'} onClick={() => punch('break')}
                        className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-200 text-xs font-extrabold text-gray-700 hover:bg-amber-500 hover:border-amber-500 hover:text-white transition-colors${busy === 'break' ? ' opacity-70' : ''}`}><Icon name="clock" cls="w-3.5 h-3.5" />Start break</button>}
                    {r?.break_started_at && r.break_ended_at && <p className="text-[11px] font-bold text-gray-500 mt-3">{`Break ${hm(r.break_started_at)}–${hm(r.break_ended_at)} · ${r.break_min} min`}{r.break_over_min ? <>{' '}<span className="text-amber-700">{`(${r.break_over_min} min over)`}</span></> : null}</p>}
                    <p id="gpsNote" className="text-[11px] text-gray-400 mt-4">{note}</p>
                    {r?.late_min ? <p className="text-xs font-bold text-amber-700 mt-2">{`Late by ${r.late_min} min today`}</p> : null}
                </div>
                <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1"><button type="button" className="icon-btn" id="mPrev" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
                            <b className="text-sm w-36 text-center">{new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
                            <button type="button" className="icon-btn" id="mNext" aria-label="Next month" onClick={() => step(1)}>›</button></div>
                        <button type="button" id="askLeave" className="btn btn-dark btn-sm" onClick={() => { setLf({ type: 'annual', from: '', to: '', reason: '' }); setLeaveOpen(true); }}><Icon name="calendar" />Request leave</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {kpi('Present', (tot.present || 0) + (tot.late || 0))}
                        {kpi('Late', <>{`${tot.late || 0} `}<span className="text-xs text-gray-400">{`${tot.late_min} min`}</span></>, tot.late ? 'text-amber-700' : '')}
                        {kpi('Absent', tot.absent || 0, tot.absent ? 'text-[#D55C48]' : '')}
                        {kpi('Worked', hrs(tot.worked))}
                    </div>
                    <div className="cal text-center text-[10px] font-extrabold text-gray-400">{DOW.map(d => <div key={d}>{d}</div>)}</div>
                    <div className="cal">
                        {Array.from({ length: firstDow }, (_, i) => <div key={'e' + i}></div>)}
                        {me.days.map((d: any) => (
                            <div key={d.work_date} className={`d s-${d.status}`} title={`${ST[d.status]?.[1] || d.status}${d.leave_type ? ' · ' + d.leave_type : ''}`}>
                                <b className="text-xs">{+d.work_date.slice(8)}</b>
                                {d.check_in && <span className="block">{`${hm(d.check_in)}–${d.check_out ? hm(d.check_out) : '…'}`}</span>}
                                {d.late_min ? <span className="block text-amber-700 font-bold">{`+${d.late_min}m late`}</span> : null}
                                {d.status === 'leave' && <span className="block">leave</span>}
                                {d.status === 'absent' && <span className="block text-[#D55C48] font-bold">absent</span>}
                            </div>
                        ))}
                    </div>
                    <div><p className="sd-label mb-2">My leave requests</p>
                        <Table heads={[['Dates'], ['Type'], ['Days', 'right'], ['Status'], ['']]} empty="No leave requests.">
                            {me.leave.map((l: Leave) => (
                                <tr key={l.id}><td className="p-3 pl-4" data-label="Dates">{`${dd(l.from_date)} – ${dd(l.to_date)}`}{l.reason && <span className="block text-[10px] text-gray-400">{l.reason}</span>}</td>
                                    <td className="p-3 capitalize" data-label="Type">{l.leave_type}</td><td className="p-3 text-right" data-label="Days">{l.days}</td>
                                    <td className="p-3" data-label="Status"><span className={`pill-tag ${LS[l.status]}`}>{l.status}</span>{l.decided_by && <span className="block text-[10px] text-gray-400">{l.decided_by + (l.decision_note ? ' · ' + l.decision_note : '')}</span>}</td>
                                    <td className="p-3 pr-4 text-right" data-label="">{l.status === 'pending' && <button type="button" className="btn btn-light btn-sm" data-lcancel={l.id} onClick={() => cancelLeave(l.id)}>Cancel</button>}</td></tr>
                            ))}
                        </Table></div>
                </div>
            </div>
        );
    }

    function Today({ d }: { d: { rows: DayRow[] } }) {
        const count = (s: string) => d.rows.filter(r => r.status === s).length;
        const kpi = (l: string, v: number, cls = '') => <div className="bg-[#F8F8FA] rounded-2xl p-3"><p className="sd-label">{l}</p><div className={`text-2xl font-extrabold ${cls}`}>{v}</div></div>;
        return <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">{kpi('In', count('present') + count('late'), 'text-emerald-600')}{kpi('Late', count('late'), 'text-amber-700')}{kpi('Not in', count('absent'), 'text-[#D55C48]')}{kpi('On leave', count('leave'))}{kpi('Off', count('off'))}</div>
            <Table heads={[['Employee'], ['Status'], ['In'], ['Out'], ['Late', 'right'], ['Worked', 'right'], ['']]} empty="No staff in this branch.">
                {d.rows.map((r, i) => (
                    <tr key={i}>
                        <td className="p-3 pl-4" data-label="Employee"><b>{r.full_name}</b><span className="block text-[10px] text-gray-400">{r.branch || ''}</span></td>
                        <td className="p-3" data-label="Status"><Pill s={r.status} />{r.leave_type && <>{' '}<span className="text-[10px] text-gray-400">{r.leave_type}</span></>}{r.edited && <>{' '}<span className="pill-tag pill-gray" title="Corrected by a manager">edited</span></>}</td>
                        <td className="p-3" data-label="In">{hm(r.check_in)}</td><td className="p-3" data-label="Out">{hm(r.check_out)}</td>
                        <td className={`p-3 text-right ${r.late_min ? 'text-amber-700 font-bold' : ''}`} data-label="Late">{r.late_min ? r.late_min + 'm' : '—'}</td>
                        <td className="p-3 text-right" data-label="Worked">{hrs(r.worked_min)}</td>
                        <td className="p-3 pr-4 text-right" data-label=""><button type="button" className="btn btn-light btn-sm" data-fix={`day:${i}`} onClick={() => openFix(r)}>Correct</button></td></tr>
                ))}
            </Table>
        </>;
    }

    function Report({ d }: { d: any }) {
        const setRange = (k: 'from' | 'to', v: string) => { range.current = { from: k === 'from' ? v : d.from, to: k === 'to' ? v : d.to }; show(); };
        const odd = d.rows.map((r: DayRow, i: number) => ({ r, i })).filter(({ r }: { r: DayRow }) => ['late', 'absent'].includes(r.status) || r.edited);
        return <>
            <div className="flex flex-wrap items-end gap-2 mb-4">
                <div><label className="ui-label" htmlFor="rFrom">From</label><input id="rFrom" type="date" className="field" defaultValue={d.from} onChange={e => setRange('from', e.target.value)} /></div>
                <div><label className="ui-label" htmlFor="rTo">To</label><input id="rTo" type="date" className="field" defaultValue={d.to} onChange={e => setRange('to', e.target.value)} /></div>
                <button type="button" id="rCsv" className="btn btn-light" onClick={() => csv((document.getElementById('rFrom') as HTMLInputElement).value, (document.getElementById('rTo') as HTMLInputElement).value)}><Icon name="upload" />Download CSV</button></div>
            <Table heads={[['Employee'], ['Present', 'right'], ['Late', 'right'], ['Absent', 'right'], ['Leave', 'right'], ['Late min', 'right'], ['Early out min', 'right'], ['Overtime', 'right'], ['Worked', 'right']]} empty="No staff.">
                {d.summary.map((s: any, i: number) => (
                    <tr key={i}><td className="p-3 pl-4" data-label="Employee"><b>{s.full_name}</b><span className="block text-[10px] text-gray-400">{s.branch || ''}</span></td>
                        <td className="p-3 text-right" data-label="Present">{s.present + s.late}</td><td className={`p-3 text-right ${s.late ? 'text-amber-700 font-bold' : ''}`} data-label="Late">{s.late}</td>
                        <td className={`p-3 text-right ${s.absent ? 'text-[#D55C48] font-bold' : ''}`} data-label="Absent">{s.absent}</td><td className="p-3 text-right" data-label="Leave">{s.leave}</td>
                        <td className="p-3 text-right" data-label="Late min">{s.late_min}</td><td className="p-3 text-right" data-label="Early out min">{s.early_min}</td>
                        <td className="p-3 text-right" data-label="Overtime">{hrs(s.overtime_min)}</td><td className="p-3 pr-4 text-right font-extrabold" data-label="Worked">{hrs(s.worked_min)}</td></tr>
                ))}
            </Table>
            <p className="sd-label mt-6 mb-2">Day by day (late, absent and corrected days)</p>
            <Table heads={[['Date'], ['Employee'], ['Status'], ['In'], ['Out'], ['']]} empty="Nobody late or absent in this period.">
                {odd.map(({ r, i }: { r: DayRow; i: number }) => (
                    <tr key={i}>
                        <td className="p-3 pl-4" data-label="Date">{dd(r.work_date)}</td><td className="p-3" data-label="Employee">{r.full_name}</td>
                        <td className="p-3" data-label="Status"><Pill s={r.status} />{r.late_min ? <>{' '}<span className="text-[10px] text-amber-700">{`${r.late_min}m`}</span></> : null}{r.edited && <>{' '}<span className="pill-tag pill-gray">edited</span></>}</td>
                        <td className="p-3" data-label="In">{hm(r.check_in)}</td><td className="p-3" data-label="Out">{hm(r.check_out)}</td>
                        <td className="p-3 pr-4 text-right" data-label=""><button type="button" className="btn btn-light btn-sm" data-fix={`report:${i}`} onClick={() => openFix(r)}>Correct</button></td></tr>
                ))}
            </Table>
        </>;
    }

    function LeavePane({ d }: { d: { rows: Leave[] } }) {
        return (
            <Table heads={[['Employee'], ['Dates'], ['Type'], ['Days', 'right'], ['Status'], ['']]} empty="No leave requests.">
                {d.rows.map(l => (
                    <tr key={l.id} className={l.status === 'pending' ? 'bg-[#FFFBF5]' : ''}>
                        <td className="p-3 pl-4" data-label="Employee"><b>{l.full_name}</b><span className="block text-[10px] text-gray-400">{l.branch_code || ''}</span></td>
                        <td className="p-3" data-label="Dates">{`${dd(l.from_date)} – ${dd(l.to_date)}`}{l.reason && <span className="block text-[10px] text-gray-400">{l.reason}</span>}</td>
                        <td className="p-3 capitalize" data-label="Type">{l.leave_type}</td><td className="p-3 text-right" data-label="Days">{l.days}</td>
                        <td className="p-3" data-label="Status"><span className={`pill-tag ${LS[l.status]}`}>{l.status}</span>{l.decided_by && <span className="block text-[10px] text-gray-400">{l.decided_by}</span>}</td>
                        <td className="p-3 pr-4 text-right whitespace-nowrap" data-label="">{l.status === 'pending' && <><button type="button" className="btn btn-dark btn-sm" data-decide={`approved:${l.id}`} onClick={() => decide('approved', l.id)}>Approve</button>{' '}<button type="button" className="btn btn-light btn-sm" data-decide={`rejected:${l.id}`} onClick={() => decide('rejected', l.id)}>Reject</button></>}</td></tr>
                ))}
            </Table>
        );
    }

    function Shifts({ d }: { d: { rows: ShiftRow[] } }) {
        return (
            <Table heads={[['Employee'], ['Shift'], ['Grace', 'right'], ['Weekly off'], ['']]} empty="No staff.">
                {d.rows.map((r, i) => (
                    <tr key={i}>
                        <td className="p-3 pl-4" data-label="Employee"><b>{r.full_name}</b><span className="block text-[10px] text-gray-400">{[r.branch, String(r.role || '').replace(/_/g, ' ')].filter(Boolean).join(' · ')}</span></td>
                        <td className="p-3 font-extrabold" data-label="Shift">{`${hh(r.shift_start)} – ${hh(r.shift_end)}`}{r.break_start && <span className="block text-[10px] text-gray-400 font-medium">{`break ${hh(r.break_start)}–${hh(r.break_end)}`}</span>}</td>
                        <td className="p-3 text-right" data-label="Grace">{`${r.grace_min} min`}</td>
                        <td className="p-3" data-label="Weekly off">{(r.weekly_off || []).map(n => DOW[n - 1]).join(', ') || 'none'}</td>
                        <td className="p-3 pr-4 text-right" data-label=""><button type="button" className="btn btn-light btn-sm" data-shift={i} onClick={() => openShift(r)}>Edit</button></td></tr>
                ))}
            </Table>
        );
    }

    const pane = !view ? null : error ? <p className="text-center text-gray-400 p-10">{error}</p>
        // called as functions (not <Me/>) so the pane is not rebuilt from scratch on every change
        : view.tab === 'me' ? Me({ me: view.d }) : view.tab === 'today' ? Today({ d: view.d }) : view.tab === 'report' ? Report({ d: view.d }) : view.tab === 'leave' ? LeavePane({ d: view.d }) : Shifts({ d: view.d });
    const n = leaveDays();

    const popups = <>
        <Modal id="leaveModal" open={leaveOpen} onClose={() => setLeaveOpen(false)} panelClassName="max-w-md">
            <ModalHead title="Request leave" />
            <form id="leaveForm" className="my-5 grid grid-cols-2 gap-3" onSubmit={sendLeave}>
                <div className="col-span-2"><label className="ui-label" htmlFor="lType">Type</label><select id="lType" className="field" value={lf.type} onChange={e => setLf({ ...lf, type: e.target.value })}><option value="annual">Annual</option><option value="sick">Sick</option><option value="emergency">Emergency</option><option value="unpaid">Unpaid</option><option value="other">Other</option></select></div>
                <div><label className="ui-label" htmlFor="lFrom">From</label><input id="lFrom" type="date" className="field" required value={lf.from} onChange={e => setLf({ ...lf, from: e.target.value, to: e.target.value && !lf.to ? e.target.value : lf.to })} /></div>
                <div><label className="ui-label" htmlFor="lTo">To</label><input id="lTo" type="date" className="field" required value={lf.to} onChange={e => setLf({ ...lf, to: e.target.value })} /></div>
                <div className="col-span-2"><label className="ui-label" htmlFor="lReason">Reason</label><textarea id="lReason" rows={2} className="field" value={lf.reason} onChange={e => setLf({ ...lf, reason: e.target.value })}></textarea></div>
                <div className="col-span-2 flex justify-between items-center"><span id="lDays" className="text-xs text-gray-500">{n > 0 ? `${n} day${n > 1 ? 's' : ''}` : ''}</span><button className="btn btn-coral">Send request</button></div>
            </form>
        </Modal>
        <Modal id="fixModal" open={fixOpen} onClose={() => setFixOpen(false)} panelClassName="max-w-md">
            <ModalHead title="Correct attendance" subId="fxSub" sub={fixing ? `${fixing.full_name} · ${dd(fixing.work_date)}` : ''} />
            <form id="fixForm" className="my-5 grid grid-cols-2 gap-3" onSubmit={saveFix}>
                <div><label className="ui-label" htmlFor="fxIn">Check in</label><input id="fxIn" type="time" className="field" value={fx.in} onChange={e => setFx({ ...fx, in: e.target.value })} /></div>
                <div><label className="ui-label" htmlFor="fxOut">Check out</label><input id="fxOut" type="time" className="field" value={fx.out} onChange={e => setFx({ ...fx, out: e.target.value })} /></div>
                <div className="col-span-2"><label className="ui-label" htmlFor="fxReason">Reason (kept on the record)</label><input id="fxReason" className="field" placeholder="e.g. phone battery died, checked in at 08:55" required value={fx.reason} onChange={e => setFx({ ...fx, reason: e.target.value })} /></div>
                <div className="col-span-2 flex justify-end"><button className="btn btn-coral">Save correction</button></div>
            </form>
        </Modal>
        <Modal id="shiftModal" open={shiftOpen} onClose={() => setShiftOpen(false)} panelClassName="max-w-md">
            <ModalHead title="Shift" subId="shSub" sub={shiftEmp?.full_name || ''} />
            <form id="shiftForm" className="my-5 grid grid-cols-2 gap-3" onSubmit={saveShift}>
                <div><label className="ui-label" htmlFor="shStart">Starts</label><input id="shStart" type="time" className="field" required value={sh.start} onChange={e => setSh({ ...sh, start: e.target.value })} /></div>
                <div><label className="ui-label" htmlFor="shEnd">Ends</label><input id="shEnd" type="time" className="field" required value={sh.end} onChange={e => setSh({ ...sh, end: e.target.value })} /></div>
                <div><label className="ui-label" htmlFor="shBrStart">Break from <span className="text-gray-400 normal-case">(optional)</span></label><input id="shBrStart" type="time" className="field" value={sh.brStart} onChange={e => setSh({ ...sh, brStart: e.target.value })} /></div>
                <div><label className="ui-label" htmlFor="shBrEnd">Break to</label><input id="shBrEnd" type="time" className="field" value={sh.brEnd} onChange={e => setSh({ ...sh, brEnd: e.target.value })} /></div>
                <div className="col-span-2"><label className="ui-label" htmlFor="shGrace">Late after (minutes of grace)</label><input id="shGrace" type="number" min="0" max="120" className="field" required value={sh.grace} onChange={e => setSh({ ...sh, grace: e.target.value })} /></div>
                <div className="col-span-2"><span className="ui-label">Weekly off</span><div id="shOff" className="flex flex-wrap gap-1 mt-1">
                    {shiftEmp && DOW.map((d, i) => <button key={d} type="button" className="day-chip px-3 py-1.5 rounded-full bg-[#F8F8FA] text-[11px] font-extrabold" data-dow={i + 1} aria-pressed={sh.off.includes(i + 1)}
                        onClick={() => setSh(s => ({ ...s, off: s.off.includes(i + 1) ? s.off.filter(x => x !== i + 1) : [...s.off, i + 1] }))}>{d}</button>)}
                </div></div>
                <div className="col-span-2 flex justify-end"><button className="btn btn-coral">Save shift</button></div>
            </form>
        </Modal>
    </>;

    const tabBtn = (t: Tab, label: ReactNode, mgr = false) => (
        <button type="button" className={`opt ${mgr ? 'mgr ' : ''}${mgr && !isMgr ? 'hidden ' : ''}px-4 py-2 rounded-full text-[11px] font-extrabold`} data-tab={t} aria-pressed={tab === t} onClick={() => pick(t)}>{label}</button>
    );
    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="clock" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Attendance</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Check in at your branch • shifts • leave</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1 bg-[#F8F8FA] p-1 rounded-full self-start" role="tablist">
                        {tabBtn('me', 'My attendance')}
                        {tabBtn('today', 'Today', true)}
                        {tabBtn('report', 'Report', true)}
                        {tabBtn('leave', <>Leave <span id="leaveCount">{leaveCount}</span></>, true)}
                        {tabBtn('shifts', 'Shifts', true)}
                    </div>
                </section>
                <div id="pane" key={view?.n || 0} className="ui-fade">{pane}</div>
            </div>
        </AppFrame>
    );
}
