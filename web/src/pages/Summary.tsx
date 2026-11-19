// Daily summary — one look at a day: bookings, money in and out, deliveries, pickups, exceptions, what is still waiting.
// Managers see their branch; head office sees the company total and every branch. Data: GET /api/summary?date=
// The evening run (8 pm Oman) saves the day and the bell says it is ready; this page always shows live numbers.
import { useEffect, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import type { IconName } from '../lib/icons';
import { PageLink } from '../components/PageLink';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

type Day = { day: string; branch: string | null; branch_name?: string; branches?: number; bookings: number; kg: number; invoiced: Record<string, number>; received: Record<string, number>;
    expenses: Record<string, number>; cash_closed?: boolean; cash_not_closed?: string[]; delivered: number; delivery_failed: number; pickups: number; pickups_done: number; pickups_open: number;
    exceptions: number; waiting: { cargo_in: number; cash_in: number; payment_requests: number; materials_in: number }; unpaid: Record<string, number>; unpaid_count: number };
type Resp = { day: string; today: string; branches: Day[]; total: Day | null };

const iso = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const label = (d: string, today: string) => d === today ? 'Today' : d === shift(today, -1) ? 'Yesterday' : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
const money = (o: Record<string, number>) => Object.entries(o || {}).map(([c, v]) => `${c} ${(+v).toFixed(3)}`);
// receipts come as "OMR cash": add them up per currency, and keep the split by method
const byCur = (o: Record<string, number>) => Object.entries(o || {}).reduce((m, [k, v]) => { const c = k.split(' ')[0]; m[c] = (m[c] || 0) + +v; return m; }, {} as Record<string, number>);
const methods = (o: Record<string, number>) => Object.entries(o || {}).map(([k, v]) => `${k.split(' ')[1]} ${(+v).toFixed(3)}`).join(' · ');

function Tile({ icon, label: l, value, sub, tone = '' }: { icon: IconName; label: string; value: React.ReactNode; sub?: string; tone?: string }) {
    return <div className={`rounded-2xl p-3.5 bg-[#F8F8FA] ${tone}`}><p className="sd-label flex items-center gap-1.5"><Icon name={icon} cls="w-3.5 h-3.5" />{l}</p>
        <div className="text-lg font-extrabold tabular-nums mt-1 leading-tight">{value}</div>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

function DayCard({ d, big = false }: { d: Day; big?: boolean }) {
    const got = byCur(d.received), wait = d.waiting || { cargo_in: 0, cash_in: 0, payment_requests: 0, materials_in: 0 };
    const waiting: [string, number, string][] = ([['cargo manifest(s) to receive', wait.cargo_in, 'consolidation.html?tab=inbound'], ['cash transfer(s) to confirm', wait.cash_in, 'accounts.html?tab=money'],
        ['payment request(s) with Main Office', wait.payment_requests, 'accounts.html?tab=money'], ['material delivery(ies) to receive', wait.materials_in, 'accounts.html?tab=inventory']] as [string, number, string][]).filter(w => w[1] > 0);
    const notClosed = d.branch ? !d.cash_closed && (d.bookings > 0 || Object.keys(got).length > 0) : (d.cash_not_closed || []).length > 0;
    return <section data-summary={d.branch || 'company'} className={`rounded-[1.75rem] border border-gray-100 bg-white p-5 ${big ? 'shadow-[0_20px_50px_-25px_rgba(17,24,39,.25)]' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-base font-extrabold">{d.branch ? d.branch_name || d.branch : `Whole company · ${d.branches} branches`}</h3>
            {notClosed ? <span className="pill-tag pill-coral">{d.branch ? 'Cash not closed' : `Cash not closed: ${(d.cash_not_closed || []).join(', ')}`}</span>
                : <span className="pill-tag pill-green">{d.branch ? (d.cash_closed ? 'Cash closed' : 'Quiet day') : 'All cash closed'}</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile icon="box" label="Bookings" value={d.bookings} sub={`${d.kg} kg`} />
            <Tile icon="cash" label="Received" value={Object.keys(got).length ? money(got).map(m => <span key={m} className="block">{m}</span>) : '—'} sub={methods(d.received)} />
            <Tile icon="clipboard" label="Invoiced" value={money(d.invoiced).length ? money(d.invoiced).map(m => <span key={m} className="block">{m}</span>) : '—'} />
            <Tile icon="wallet" label="Expenses" value={money(d.expenses).length ? money(d.expenses).map(m => <span key={m} className="block">{m}</span>) : '—'} />
            <Tile icon="truck" label="Delivered" value={d.delivered} sub={d.delivery_failed ? `${d.delivery_failed} failed attempt(s)` : 'no failed attempts'} tone={d.delivery_failed ? '!bg-amber-50' : ''} />
            <Tile icon="pin" label="Pickups" value={`${d.pickups_done} / ${d.pickups}`} sub={d.pickups_open ? `${d.pickups_open} still open` : 'all done'} tone={d.pickups_open ? '!bg-amber-50' : ''} />
            <Tile icon="alert" label="Exceptions" value={d.exceptions} sub="holds, failed, returns" tone={d.exceptions ? '!bg-[#FFF5F3]' : ''} />
            <Tile icon="hash" label="Unpaid invoices" value={d.unpaid_count} sub={money(d.unpaid).join(' · ') || 'nothing owed'} tone={d.unpaid_count ? '!bg-[#FFF5F3]' : ''} />
        </div>
        {waiting.length > 0 && <div className="mt-4 bg-[#111827] text-white rounded-2xl p-3.5"><p className="text-[10px] font-extrabold uppercase tracking-wider text-white/60 mb-1.5">Still waiting</p>
            <ul className="space-y-1">{waiting.map(([t, n, href]) => <li key={t} className="text-xs flex items-center justify-between gap-3"><span>{`${n} ${t}`}</span>
                <PageLink page={href.split('?')[0] as never} search={'?' + href.split('?')[1]} className="text-[#E86D58] font-extrabold hover:underline">Open</PageLink></li>)}</ul></div>}
    </section>;
}

export function Summary() {
    const [date, setDate] = useState(() => new URLSearchParams(location.search).get('date') || iso());
    const [d, setD] = useState<Resp | null>(null);
    useEffect(() => {
        setD(null);
        history.replaceState(null, '', `?date=${date}`);
        api<Resp>(`/api/summary?date=${date}`).then(setD).catch(e => toast(false, (e as Error).message));
    }, [date]);
    const today = d?.today || iso();
    return <AppFrame>
        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
            <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                    <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="chart" /></div>
                    <div><div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Daily summary</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Saved every evening at 8 pm • live numbers here</p></div>
                </div>
                <div className="flex items-center gap-2 self-start">
                    <div className="flex items-center gap-1 bg-[#F8F8FA] p-1 rounded-full">
                        <button type="button" className="icon-btn" aria-label="Day before" onClick={() => setDate(shift(date, -1))}><Icon name="arrowLeft" cls="w-4 h-4" /></button>
                        <input type="date" className="bg-transparent text-xs font-extrabold px-2 outline-none" max={today} aria-label="Day" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
                        <button type="button" className="icon-btn" aria-label="Day after" disabled={date >= today} onClick={() => setDate(shift(date, 1))}><Icon name="arrowRight" cls="w-4 h-4" /></button></div>
                </div>
            </section>
            <h2 className="text-xl font-extrabold mb-4" id="sumDay">{label(date, today)}</h2>
            {!d ? <div className="h-64 rounded-[1.75rem] bg-gray-50 animate-pulse" /> : <div className="space-y-4">
                {d.total && <DayCard d={d.total} big />}
                {d.branches.map(b => <DayCard key={b.branch || ''} d={b} big={!d.total} />)}
            </div>}
        </div>
    </AppFrame>;
}
