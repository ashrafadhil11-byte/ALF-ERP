// Check in / out from anywhere — same as admin/components/checkin.js.
//  • Top bar: Check in → Start break / End break → Check out; after check-out it shows the hours worked.
//  • Reminder popup when the shift has started and you have not checked in, the shift is over and you have not
//    checked out, or your break ran over. "Later" hides it for 30 minutes.
// Data: GET /api/attendance?view=status (the server decides when to remind, in the branch's time zone).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { beep, toast } from '../../lib/toast';
import { Icon, Svg } from '../Icon';
import { PageLink } from '../PageLink';

const CHECK_EVERY_MS = 5 * 60e3;
const SNOOZE_MS = 30 * 60e3;
const KEY = 'alf_checkin_snooze';

type Kind = 'in' | 'out' | 'break' | 'resume';
type Rec = { check_in?: string; check_out?: string; break_started_at?: string; break_ended_at?: string; late_min?: number; worked_min?: number; break_over_min?: number };
type Status = {
    today: string; on_leave?: boolean; remind?: 'in' | 'out' | 'resume' | null; record?: Rec | null;
    shift: { start: string; end: string; break_start?: string; break_end?: string };
    branch?: { name?: string; has_location?: boolean };
};

export const hm = (v?: string) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
export const hrs = (m?: number) => m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '0h';
/** where the day stands: in → work → (break → work) → done */
export const stageOf = (r?: Rec | null) => !r?.check_in ? 'in' : r.check_out ? 'done' : r.break_started_at && !r.break_ended_at ? 'onbreak' : 'work';

const BREAK_D = '<path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>';
const BreakIcon = ({ cls = 'w-4 h-4' }: { cls?: string }) => <Svg d={BREAK_D} cls={`${cls} flex-shrink-0`} />;

function position(): Promise<GeolocationCoordinates> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
        navigator.geolocation.getCurrentPosition(p => resolve(p.coords), err => reject(new Error(err.code === 1
            ? 'Location is blocked. Allow location for this site in your browser settings, then try again.'
            : 'Could not get your location. Turn on GPS or move near a window and try again.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
}

const snoozed = (kind: string, today?: string) => {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.kind === kind && s.day === today && s.until > Date.now(); } catch { return false; }
};

/** Shared state for the top-bar buttons and the reminder popup. */
export function useCheckin() {
    const qc = useQueryClient();
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState<Kind | false>(false);
    useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t); }, []);   // let the page's own data load first
    const q = useQuery({
        queryKey: ['attendance', 'status'], enabled: ready && !!localStorage.getItem('cargo_auth_token'),
        queryFn: () => api<Status>('/api/attendance?view=status').catch(() => null),
        refetchInterval: CHECK_EVERY_MS, staleTime: 60_000, retry: false
    });

    async function punch(kind: Kind) {
        if (busy) return;
        setBusy(kind);
        const state = q.data;
        try {
            const needsGps = kind === 'in' || kind === 'out';
            const c = !needsGps ? null : state?.branch?.has_location ? await position() : await position().catch(() => null);
            const out = await api<{ record?: Rec }>('/api/attendance', { method: 'POST', body: { action: 'punch', kind, lat: c?.latitude, lng: c?.longitude, accuracy: c?.accuracy } });
            const r = out.record || {};
            toast(true, {
                in: `Checked in at ${hm(r.check_in)}${r.late_min ? ` — ${r.late_min} min late` : ''}.`,
                break: `Break started at ${hm(r.break_started_at)}.`,
                resume: `Back from break at ${hm(r.break_ended_at)}${r.break_over_min ? ` — ${r.break_over_min} min over` : ''}.`,
                out: `Checked out at ${hm(r.check_out)}. Worked ${hrs(r.worked_min)}.`
            }[kind]);
            beep(true);
            setBusy(false);
            await q.refetch();
            qc.invalidateQueries({ queryKey: ['attendance'], refetchType: 'active' });
            document.dispatchEvent(new CustomEvent('attendance:changed'));
        } catch (e) { setBusy(false); toast(false, (e as Error).message); }
    }
    return { state: q.data, busy, punch };
}

type Ck = ReturnType<typeof useCheckin>;

export function CheckInButtons({ ck }: { ck: Ck }) {
    const { state, busy, punch } = ck;
    if (!state || state.on_leave) return <div id="checkinSlot" className="flex-shrink-0"></div>;
    const r = state.record || undefined, s = state.shift, stage = stageOf(r);
    const brk = s.break_start ? ` · break ${s.break_start}–${s.break_end}` : '';
    const btn = (kind: Kind, cls: string, icon: React.ReactNode, label: string, tip: string, open = true) => (
        <button type="button" data-punch={kind} disabled={!!busy} className={`fab ${open ? 'fab-open' : ''} ${cls}`} title={tip} aria-label={label} onClick={() => punch(kind)}>
            {icon}<span className="fab-label">{busy === kind ? (kind === 'in' || kind === 'out' ? 'Locating…' : 'Saving…') : label}</span>
        </button>
    );
    let body: React.ReactNode;
    if (stage === 'done') {
        body = <PageLink page="attendance.html" className="fab ck-done" title={`${hm(r!.check_in)} – ${hm(r!.check_out)}`}><Icon name="check" /><span className="fab-label">Done · {hrs(r!.worked_min)}</span></PageLink>;
    } else if (stage === 'in') {
        body = btn('in', 'ck-in', <Icon name="clock" />, 'Check in', `Shift ${s.start}–${s.end}${brk}`);
    } else if (stage === 'onbreak') {
        body = btn('resume', 'ck-break', <BreakIcon />, 'End break', `On break since ${hm(r!.break_started_at)}${brk}`);
    } else {
        // working: a small round "Start break" (opens on hover) next to Check out
        body = (
            <div className="flex items-center gap-2">
                {!r!.break_started_at && btn('break', 'ck-brk-start', <BreakIcon />, 'Start break', `Start your break${brk}`, false)}
                {btn('out', 'ck-out', <Icon name="clock" />, 'Check out', `In since ${hm(r!.check_in)}${r!.late_min ? ` (${r!.late_min} min late)` : ''} · shift ends ${s.end}`)}
            </div>
        );
    }
    return <div id="checkinSlot" className="flex-shrink-0">{body}</div>;
}

const POP = {
    in: { title: 'Time to check in', btn: 'Check in now', tone: 'bg-[#111827]', cls: 'btn-dark' },
    out: { title: 'Don’t forget to check out', btn: 'Check out now', tone: 'bg-coral-500', cls: 'btn-coral' },
    resume: { title: 'Your break is over', btn: 'End break', tone: 'bg-amber-500', cls: 'btn-dark' }
} as const;

export function CheckInReminder({ ck, onAttendancePage }: { ck: Ck; onAttendancePage: boolean }) {
    const { state, busy, punch } = ck;
    const [, rerender] = useState(0);
    const kind = state?.remind;
    if (!state || !kind || !POP[kind] || snoozed(kind, state.today) || onAttendancePage) return null;
    const s = state.shift, P = POP[kind];
    const text = kind === 'in' ? `Shift ${s.start}–${s.end}. Check in at ${state.branch?.name || 'your branch'}.`
        : kind === 'resume' ? `You started your break at ${hm(state.record?.break_started_at)}${s.break_end ? ` — it was due to end at ${s.break_end}` : ''}.`
            : `Your shift ended at ${s.end}. Check out before you leave.`;
    const snooze = () => {
        try { localStorage.setItem(KEY, JSON.stringify({ kind, day: state.today, until: Date.now() + SNOOZE_MS })); } catch { /* ignore */ }
        rerender(n => n + 1);
    };
    return (
        <div id="checkinPop" role="alertdialog" aria-label="Attendance reminder"
            className="fixed z-[70] right-4 bottom-24 lg:bottom-6 w-[calc(100%-2rem)] max-w-sm bg-white rounded-[1.5rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] border border-gray-100 p-4 ui-fade">
            <div className="flex gap-3">
                <span className={`w-11 h-11 rounded-2xl ${P.tone} text-white flex items-center justify-center flex-shrink-0`}>{kind === 'resume' ? <BreakIcon cls="w-5 h-5" /> : <Icon name="clock" cls="w-5 h-5" />}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{P.title}</p><p className="text-xs text-gray-500 mt-0.5">{text}</p>
                    <div className="flex gap-2 mt-3">
                        <button type="button" data-punch={kind} disabled={!!busy} className={`btn ${P.cls} btn-sm`} onClick={() => punch(kind)}>{busy ? 'Saving…' : P.btn}</button>
                        <button type="button" data-snooze className="btn btn-light btn-sm" onClick={snooze}>Later</button>
                    </div>
                </div>
                <button type="button" data-snooze className="icon-btn !w-7 !h-7 flex-shrink-0" aria-label="Close reminder" onClick={snooze}><Icon name="x" cls="w-3 h-3" /></button>
            </div>
        </div>
    );
}
