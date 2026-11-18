// Activity Log — same page as admin/activity.html. Data: GET /api/activity (filters, paging).
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import './activity.css';

// Plain names for the areas of the app (route → label)
export const AREA: Record<string, string> = {
    login: 'Sign in', bookings: 'Bookings', status: 'Status update', delivery: 'Delivery / POD', transfers: 'Branch transfers', consolidation: 'Consolidation',
    accounts: 'Accounts', customers: 'Customers', warehouse: 'Warehouse', attendance: 'Attendance', users: 'Staff & users', 'create-user': 'New user', branches: 'Branches',
    integrations: 'Integrations', profile: 'Profile', codes: 'Status codes', 'carrier-sync': 'Carrier sync', 'dashboard-layout': 'Dashboard layout', notifications: 'Notifications'
};
const VERB: Record<string, string> = { POST: 'saved', PUT: 'saved', PATCH: 'changed', DELETE: 'deleted' };
const words = (s?: string | null) => String(s || '').replace(/_/g, ' ');
type Row = { at: string; ok: boolean; route: string; action?: string; method: string; status?: number; error?: string; target?: string; user_name?: string; user_email?: string; role?: string; branch?: string; ip?: string; user_agent?: string; details?: Record<string, unknown> };
export const what = (r: Pick<Row, 'route' | 'ok' | 'action' | 'method'>) => r.route === 'login' ? (r.ok ? 'signed in' : 'sign-in attempt') : r.action ? words(r.action) : VERB[r.method] || r.method;
export const when = (v: string) => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Resp = { rows: Row[]; more: boolean; users: { id: string; full_name?: string; branch?: string }[] };

function Detail({ r }: { r: Row | null }) {
    const dismiss = useDismiss();
    return (
        <>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 id="dTitle" className="text-lg font-extrabold">{r ? `${AREA[r.route] || r.route} — ${what(r)}` : ''}</h3>
                    <p id="dSub" className="text-xs text-gray-400 mt-0.5">{r ? `${r.user_name || r.user_email || 'Unknown'} · ${when(r.at)} · ${r.ip || ''}` : ''}</p></div>
                <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>
            </div>
            <div className="my-5 overflow-y-auto custom-scrollbar"><pre id="dBody" className="details bg-[#F8F8FA] rounded-2xl p-4 font-mono">
                {r ? JSON.stringify({ result: r.ok ? 'done' : `${r.status} ${r.error || ''}`, record: r.target, ...r.details, device: r.user_agent }, null, 2) : ''}
            </pre></div>
        </>
    );
}

export function Activity() {
    const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
    const [to, setTo] = useState('');
    const [user, setUser] = useState('');
    const [route, setRoute] = useState('');
    const [q, setQ] = useState('');
    const [qLive, setQLive] = useState('');   // q, 300 ms after typing stops
    const [failed, setFailed] = useState(false);
    const [rows, setRows] = useState<Row[]>([]);
    const [more, setMore] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [users, setUsers] = useState<Resp['users']>([]);
    const [open, setOpen] = useState<Row | null>(null);
    const [showDetail, setShowDetail] = useState(false);
    const page = useRef(0);

    async function load(reset = true) {
        if (reset) page.current = 0;
        const p = new URLSearchParams({ from, page: String(page.current) });
        if (to) p.set('to', to);
        if (user) p.set('user', user);
        if (route) p.set('route', route);
        if (qLive.trim()) p.set('q', qLive.trim());
        if (failed) p.set('failed', '1');
        try {
            const d = await api<Resp>('/api/activity?' + p);
            setRows(prev => (reset ? [] : prev).concat(d.rows));
            setMore(!!d.more);
            setUsers(u => (!u.length && d.users.length ? d.users : u));
        } catch (e) { toast(false, (e as Error).message); if (reset) setRows([]); }
        setLoaded(true);
    }
    useEffect(() => { const t = setTimeout(() => setQLive(q), 300); return () => clearTimeout(t); }, [q]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [from, to, user, route, failed, qLive]);

    return (
        <AppFrame after={<Modal id="detail" open={showDetail} onClose={() => setShowDetail(false)} panelClassName="max-w-2xl"><Detail r={open} /></Modal>}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="clipboard" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Activity Log</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Every change by every user • passwords and PINs are never stored</p>
                        </div>
                    </div>
                </section>

                <form id="filters" className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); load(); }}>
                    <div><label className="ui-label" htmlFor="fFrom">From</label><input id="fFrom" type="date" className="field" value={from} onChange={e => setFrom(e.target.value)} /></div>
                    <div><label className="ui-label" htmlFor="fTo">To</label><input id="fTo" type="date" className="field" value={to} onChange={e => setTo(e.target.value)} /></div>
                    <div><label className="ui-label" htmlFor="fUser">User</label>
                        <select id="fUser" className="field" value={user} onChange={e => setUser(e.target.value)}>
                            <option value="">Everyone</option>
                            {users.map(u => <option key={u.id} value={u.id}>{(u.full_name || '—') + (u.branch ? ' · ' + u.branch : '')}</option>)}
                        </select></div>
                    <div><label className="ui-label" htmlFor="fRoute">Area</label>
                        <select id="fRoute" className="field" value={route} onChange={e => setRoute(e.target.value)}>
                            <option value="">All areas</option>
                            {Object.entries(AREA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                    <div className="col-span-2"><label className="ui-label" htmlFor="fQ">Search</label><input id="fQ" className="field" placeholder="AWB, invoice, action, error…" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} /></div>
                    <label className="col-span-2 lg:col-span-6 flex items-center gap-2 text-xs font-bold text-gray-600"><input id="fFailed" type="checkbox" className="w-4 h-4" checked={failed} onChange={e => setFailed(e.target.checked)} />Only failed / refused attempts</label>
                </form>

                <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                    <table className="rtable w-full text-xs">
                        <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                            <th className="p-3 pl-4 font-extrabold">When</th><th className="p-3 font-extrabold">User</th><th className="p-3 font-extrabold">What</th><th className="p-3 font-extrabold">Record</th><th className="p-3 pr-4 font-extrabold">Result</th>
                        </tr></thead>
                        <tbody id="rows" className="divide-y divide-gray-100">
                            {rows.map((r, i) => (
                                <tr key={i} className={`hover:bg-[#F8F8FA] cursor-pointer ${r.ok ? '' : 'bg-[#FFF5F3]'}`} data-i={i} onClick={() => { setOpen(r); setShowDetail(true); }}>
                                    <td className="p-3 pl-4 whitespace-nowrap" data-label="When">{when(r.at)}</td>
                                    <td className="p-3" data-label="User"><b>{r.user_name || r.user_email || 'Unknown'}</b><span className="block text-[10px] text-gray-400">{[words(r.role), r.branch].filter(Boolean).join(' · ')}</span></td>
                                    <td className="p-3" data-label="What"><span className="pill-tag pill-gray">{AREA[r.route] || r.route}</span>{' ' + what(r)}</td>
                                    <td className="p-3 font-mono" data-label="Record">{r.target || '—'}</td>
                                    <td className="p-3 pr-4" data-label="Result">{r.ok ? <span className="pill-tag pill-green">Done</span>
                                        : <><span className="pill-tag pill-coral">{r.status === 401 || r.status === 403 || r.status === 423 ? 'Refused' : 'Failed'}</span><span className="block text-[10px] text-[#D55C48] mt-0.5">{r.error || ''}</span></>}</td>
                                </tr>
                            ))}
                            {loaded && !rows.length && <tr><td colSpan={5} className="p-10 text-center text-gray-400">Nothing recorded for these filters.</td></tr>}
                        </tbody>
                    </table>
                </div>
                <div className="flex justify-center mt-4"><button id="more" type="button" className={`btn btn-light${more ? '' : ' hidden'}`} onClick={() => { page.current++; load(false); }}>Show more</button></div>
            </div>
        </AppFrame>
    );
}
