// Reports (Money & Stock) — profit & loss, balance sheet and trial balance per currency, for all branches or one.
// Print opens the report on its own as an A4 accounting document; Export saves it as a spreadsheet (CSV).
// Full-accounting roles only (same as the Reports tab it replaces in Accounts). Data: GET /api/accounts?view=ledger
import { Fragment, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { acc, buildReports, day, fmt, KIND_TITLE, periodText, reportHtml, toCsv, type Kind, type Ledger, type Report } from '../lib/reports';
import { session } from '../lib/session';
import { toast } from '../lib/toast';
import './accounts.css';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const rangeOf = (r: string) => {
    const t = iso(new Date());
    return { to: t, from: r === 'today' ? t : r === 'year' ? `${t.slice(0, 4)}-01-01` : `${t.slice(0, 8)}01` };
};

export function Reports() {
    if (!session.isAdmin()) return <Navigate to="/accounts" replace />;
    return <ReportsPage />;
}

function ReportsPage() {
    const [branches, setBranches] = useState<{ branch_code: string; branch_name: string; currency?: string }[]>([]);
    const [f, setF] = useState(() => ({ ...rangeOf('month'), branch: '' }));
    const [range, setRange] = useState('month');
    const [kind, setKind] = useState<Kind>(() => (['pl', 'bs', 'tb'].includes(new URLSearchParams(location.search).get('report') || '') ? new URLSearchParams(location.search).get('report') as Kind : 'pl'));
    const [d, setD] = useState<Ledger | null>(null);
    const [error, setError] = useState('');
    const [n, setN] = useState(0);
    const seq = useRef(0);

    useEffect(() => { api('/api/accounts?view=overview').then(o => setBranches(o.branches || [])).catch(() => { /* the filter just stays on all branches */ }); }, []);
    useEffect(() => {
        const mine = ++seq.current;
        setD(null); setError('');
        const p = new URLSearchParams({ from: f.from, to: f.to, ...(f.branch ? { branch: f.branch } : {}) });
        api<Ledger>(`/api/accounts?view=ledger&${p}`)
            .then(x => { if (mine === seq.current) { setD(x); setN(k => k + 1); } })
            .catch(e => { if (mine === seq.current) setError((e as Error).message); });
    }, [f]);
    const pick = (k: Kind) => { setKind(k); history.replaceState(null, '', `?report=${k}`); };
    const branchName = f.branch ? (branches.find(b => b.branch_code === f.branch)?.branch_name || f.branch) : 'All branches';
    const reports: Report[] = d ? buildReports(kind, d) : [];

    const print = () => {
        if (!d) return;
        const w = window.open('', '_blank'); if (!w) return toast(false, 'Allow pop-ups to print.');
        w.document.write(reportHtml(kind, d, branchName, session.name()));
        w.document.close();
        w.onload = () => setTimeout(() => w.print(), 300);
    };
    const exportCsv = () => {
        if (!d) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([toCsv(kind, d, branchName)], { type: 'text/csv;charset=utf-8' }));
        a.download = `${KIND_TITLE[kind].toLowerCase().replace(/[^a-z]+/g, '-')}-${f.branch || 'all'}-${f.to}.csv`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    const sectionRows = (cur: string, title: string, lines: { code: string; name: string; amount: number }[], total: number) => <>
        <tr><td colSpan={3} className="pt-4 sd-label">{title}</td></tr>
        {lines.length ? lines.map((l, i) => <tr key={i}><td className="text-gray-400 tabular-nums w-14">{l.code}</td><td>{l.name}</td><td className="text-right money">{acc(cur, l.amount)}</td></tr>)
            : <tr><td></td><td className="text-gray-400">No entries</td><td className="text-right text-gray-300">—</td></tr>}
        <tr className="font-bold"><td></td><td>{`Total ${title.toLowerCase()}`}</td><td className="text-right money border-t border-gray-200">{acc(cur, total)}</td></tr>
    </>;
    const card = (r: Report) => (
        <div key={r.currency} className="bg-white rounded-[1.5rem] border border-gray-100 p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div><p className="font-extrabold">{`${KIND_TITLE[kind]} · ${r.currency}`}</p><p className="text-[11px] text-gray-400">{d ? periodText(kind, d) : ''}</p></div>
                {r.kind !== 'pl' && <span className={`pill-tag ${r.balanced ? 'pill-green' : 'pill-coral'}`}>{r.balanced ? 'Balanced' : 'Out of balance'}</span>}
            </div>
            {r.kind === 'tb'
                ? <table className="rep w-full text-xs"><thead><tr className="sd-label text-left"><th className="w-14">Code</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody>
                    {r.lines.map((l, i) => <tr key={i}><td className="text-gray-400 tabular-nums">{l.code}</td><td>{l.name}</td><td className="text-right money">{l.debit ? fmt(r.currency, l.debit) : ''}</td><td className="text-right money">{l.credit ? fmt(r.currency, l.credit) : ''}</td></tr>)}
                    <tr className="total"><td></td><td>Total</td><td className="text-right money">{fmt(r.currency, r.debit)}</td><td className="text-right money">{fmt(r.currency, r.credit)}</td></tr></tbody></table>
                : <table className="rep w-full text-xs"><tbody>
                    {r.sections.map(s => <Fragment key={s.title}>{sectionRows(r.currency, s.title, s.lines, s.total)}</Fragment>)}
                    {r.kind === 'pl'
                        ? <tr className="total"><td></td><td>{`Net ${r.net >= 0 ? 'profit' : 'loss'}`}</td><td className={`text-right money ${r.net < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`}>{`${r.currency} ${acc(r.currency, r.net)}`}</td></tr>
                        : <tr className="total"><td></td><td>Total liabilities &amp; equity</td><td className="text-right money">{`${r.currency} ${acc(r.currency, r.liabEquity)}`}</td></tr>}
                </tbody></table>}
        </div>
    );

    return (
        <AppFrame>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col xl:flex-row xl:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="clipboard" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Reports</span><span className="pill-tag pill-gray">Full accounting</span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{'Profit & loss • balance sheet • trial balance — per currency'}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <div><label className="ui-label" htmlFor="rBranch">Branch</label><select id="rBranch" className="field !py-2 !w-52" value={f.branch} onChange={e => setF({ ...f, branch: e.target.value })}>
                            <option value="">All branches</option>{branches.map(b => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} · ${b.currency || ''}`}</option>)}</select></div>
                        <div><label className="ui-label" htmlFor="rFrom">From</label><input id="rFrom" type="date" className="field !py-2 !w-40" value={f.from} onChange={e => { setF({ ...f, from: e.target.value }); setRange(''); }} /></div>
                        <div><label className="ui-label" htmlFor="rTo">To</label><input id="rTo" type="date" className="field !py-2 !w-40" value={f.to} onChange={e => { setF({ ...f, to: e.target.value }); setRange(''); }} /></div>
                        <div className="flex gap-1 bg-[#F8F8FA] p-1 rounded-full">
                            {([['today', 'Today'], ['month', 'Month'], ['year', 'Year']] as const).map(([k, l]) => <button key={k} type="button" className="opt px-3 py-1.5 rounded-full text-[11px] font-extrabold" data-range={k} aria-pressed={range === k} onClick={() => { setRange(k); setF({ ...f, ...rangeOf(k) }); }}>{l}</button>)}
                        </div>
                    </div>
                </section>

                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex gap-1 bg-[#F8F8FA] p-1 rounded-full">
                        {(['pl', 'bs', 'tb'] as Kind[]).map(k => <button key={k} type="button" className="opt px-3 py-1.5 rounded-full text-[11px] font-extrabold" data-report={k} aria-pressed={k === kind} onClick={() => pick(k)}>{KIND_TITLE[k]}</button>)}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button id="exportBtn" type="button" className="btn btn-light" disabled={!d} onClick={exportCsv}><Icon name="upload" />Export (Excel)</button>
                        <button id="printBtn" type="button" className="btn btn-dark" disabled={!d} onClick={print}><Icon name="clipboard" />Print report</button>
                    </div>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">{`${branchName} · ${kind === 'pl' ? `${day(f.from)} – ${day(f.to)}` : `as at ${day(f.to)}`} · each currency is reported on its own.`}</p>

                {error ? <p className="p-6 text-xs text-coral-600 bg-[#FFF5F3] rounded-2xl">{error}</p>
                    : !d ? <div className="h-40 flex items-center justify-center text-xs font-bold text-gray-300 animate-pulse">{'Loading…'}</div>
                        : <div key={n + kind} className="grid grid-cols-1 xl:grid-cols-2 gap-4 ui-fade">{reports.length ? reports.map(card) : <p className="col-span-full p-10 text-center text-xs text-gray-400 bg-[#F8F8FA] rounded-[2rem]">No postings yet.</p>}</div>}
            </div>
        </AppFrame>
    );
}
