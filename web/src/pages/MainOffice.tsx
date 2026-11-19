// Main Office — the company's own cash and bank accounts. Cashiers (Staff & Users → Main Office cashier) and the super
// admin only, after unlocking with their PIN (same PIN and 30-minute unlock as the warehouse).
//   Overview      balances, today's cash, what each branch owes / has sent, cash still on the way, recent movements
//   Approvals     cash sent by branches (confirm the amount received) · payment requests from branches (pay / reject)
//   Payments      unpaid agent / supplier bills of any branch, paid from Main Office cash or bank
//   Expenses      Main Office's own costs, or a cost paid for a branch (it shows in that branch's profit & loss)
//   Transfers     deposit, withdraw, bank to bank, float to a branch
//   Cash & bank   all cash and bank accounts, statements, add a bank account (Main Office or a branch)
//   Cash closing  the daily count of Main Office Cash
// Data: /api/main-office with the unlock token in the x-office-token header.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { toast } from '../lib/toast';
import './warehouse.css';

const THREE = ['OMR', 'BHD', 'KWD', 'JOD', 'TND', 'LYD', 'IQD'];
const KEY = 'alf_mo_token';
const iso = (d = new Date()) => d.toISOString().slice(0, 10);
const day = (v?: string) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = (v?: string) => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
type Tok = { token: string; expires_at: string };
type Mode = 'enter' | 'set' | 'change';
type Tab = 'overview' | 'approvals' | 'payments' | 'expenses' | 'transfers' | 'accounts' | 'cash';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['approvals', 'Approvals'], ['payments', 'Payments'], ['expenses', 'Expenses'], ['transfers', 'Transfers'], ['accounts', 'Cash & bank'], ['cash', 'Cash closing']];
type Money = { account_code: string; name: string; kind: string; bank_name?: string; account_no?: string; balance: number };
type Dlg = { kind: 'receive' | 'pay_request' | 'reject' | 'pay_bill' | 'expense' | 'transfer' | 'bank' | 'statement' | 'void' | 'split'; data?: any };
const COST_TYPES: [string, string][] = [['freight', 'Freight (airline / shipping line)'], ['customs', 'Customs & clearance'], ['trucking', 'Trucking / transport'], ['handling', 'Handling / terminal'], ['other', 'Other']];

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
const field = (id: string, label: ReactNode, input: ReactNode, cls = '') => <div className={cls}><label className="ui-label" htmlFor={id}>{label}</label>{input}</div>;

export function MainOffice() {
    const [cur, setCur] = useState('OMR');
    const fmt = (v: unknown, c = cur) => { const d = THREE.includes(c) ? 3 : 2; return (+(v as number) || 0).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d }); };
    const money = (v: unknown, c = cur) => `${c} ${fmt(v, c)}`;

    // ---------- unlock (this tab only; locks itself after 30 minutes) ----------
    const tok = useRef<Tok | null>((() => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } })());
    const valid = () => !!tok.current && new Date(tok.current.expires_at) > new Date();
    const [status, setStatus] = useState<any>(null);
    const [phase, setPhase] = useState<'loading' | 'error' | 'noaccess' | 'nomo' | 'gate' | 'work'>('loading');
    const [loadErr, setLoadErr] = useState('');
    const [mode, setMode] = useState<Mode>('enter');
    const [pins, setPins] = useState({ cur: '', pin: '', pin2: '' });
    const [gBusy, setGBusy] = useState(false);
    const [left, setLeft] = useState('');
    const gCur = useRef<HTMLInputElement>(null), gPin = useRef<HTMLInputElement>(null);
    const [tab, setTab] = useState<Tab>(() => (TABS.some(t => t[0] === new URLSearchParams(location.search).get('tab')) ? new URLSearchParams(location.search).get('tab') as Tab : 'overview'));
    const tabRef = useRef(tab); tabRef.current = tab;
    const [view, setView] = useState<{ tab: Tab; d: any; n: number } | null>(null);
    const [paneErr, setPaneErr] = useState<string | null>(null);
    const [pending, setPending] = useState(0);

    const lock = (msg?: string) => { tok.current = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } gate('enter'); if (msg) toast(false, msg); };
    const mo = <T = any,>(path: string, opts: { method?: string; body?: unknown } = {}) =>
        api<T>(path, { ...opts, headers: { 'x-office-token': tok.current?.token || '' } }).catch(err => {
            if ((err as ApiError).status === 423 && valid()) lock('Locked — enter your PIN again.');
            throw err;
        });
    function gate(m: Mode) {
        setMode(m); setPins({ cur: '', pin: '', pin2: '' }); setPhase('gate');
        setTimeout(() => (m === 'change' ? gCur.current : gPin.current)?.focus(), 50);
    }
    const tickRef = useRef<() => void>(() => {});
    tickRef.current = () => {
        if ((phase !== 'work' && phase !== 'gate') || !tok.current) return;
        if (!valid()) return lock('Main Office locked after 30 minutes.');
        const s = Math.max(0, Math.round((+new Date(tok.current.expires_at) - Date.now()) / 1000));
        setLeft(`Unlocked · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    useEffect(() => { const t = setInterval(() => tickRef.current(), 1000); return () => clearInterval(t); }, []);
    useEffect(() => {
        const vis = () => { if (!document.hidden && tok.current && !valid()) lock('Main Office locked.'); };
        document.addEventListener('visibilitychange', vis);
        return () => document.removeEventListener('visibilitychange', vis);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    function open() { setPhase('work'); tickRef.current(); show(tabRef.current); }
    useEffect(() => {
        (async () => {
            let st: any;
            try { st = await api('/api/main-office?view=status'); } catch (e) { setLoadErr((e as Error).message); setPhase('error'); return; }
            setStatus(st); setCur(st.main_office?.currency || 'OMR');
            if (!st.access) return setPhase('noaccess');
            if (!st.main_office) return setPhase('nomo');
            if (!st.has_pin) return gate('set');
            if (valid() && st.unlocked) return open();
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
            const out = await api<Tok>('/api/main-office', { method: 'POST', body: mode === 'enter' ? { action: 'unlock', pin } : { action: 'set_pin', pin, current_pin: mode === 'change' ? pins.cur.trim() : undefined } });
            tok.current = { token: out.token, expires_at: out.expires_at };
            try { sessionStorage.setItem(KEY, JSON.stringify(tok.current)); } catch { /* private mode */ }
            if (mode !== 'enter') toast(true, 'PIN saved. It is also your warehouse PIN.');
            setStatus((s: any) => ({ ...s, has_pin: true })); open();
        } catch (err) {
            toast(false, (err as Error).message); setPins(p => ({ ...p, pin: '' }));
            if ((err as ApiError).status === 423) { setStatus((s: any) => ({ ...s, locked_until: new Date(Date.now() + 15 * 60e3).toISOString() })); gate('enter'); }
        } finally { setGBusy(false); }
    }

    // ---------- tabs ----------
    const VIEW: Record<Tab, string> = { overview: 'overview', approvals: 'approvals', payments: 'bills', expenses: 'expenses', transfers: 'transfers', accounts: 'accounts', cash: 'cash' };
    async function show(t: Tab = tabRef.current) {
        try {
            const d = await mo(`/api/main-office?view=${VIEW[t]}`);
            if (t === 'overview') setPending(d.pending.transfers + d.pending.requests);
            if (t === 'approvals') setPending(d.transfers.length + d.requests.length);
            setPaneErr(null); setView(v => ({ tab: t, d, n: (v?.n || 0) + 1 }));
        } catch (e) {
            if ((e as ApiError).status !== 423) { setPaneErr((e as Error).message); setView(v => ({ tab: t, d: null, n: (v?.n || 0) + 1 })); }
        }
    }
    const pick = (t: Tab) => { tabRef.current = t; setTab(t); history.replaceState(null, '', `?tab=${t}`); show(t); };

    // ---------- popups ----------
    const [dlg, setDlg] = useState<Dlg | null>(null);
    const [f, setF] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [rows, setRows] = useState<{ branch: string; amount: string }[]>([]);   // split bill: one row per branch
    const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));
    const openDlg = (kind: Dlg['kind'], data?: any, init: Record<string, string> = {}) => { setF(init); setDlg({ kind, data }); };
    const moneyOf = (): Money[] => view?.d?.money || [];
    const payFrom = (id = 'fPay') => field(id, 'Pay from', <select id={id} className="field" value={f.pay_account || ''} onChange={set('pay_account')} required>
        <option value="">Choose cash or bank…</option>{moneyOf().map(m => <option key={m.account_code} value={m.account_code}>{`${m.kind === 'cash' ? 'Main Office Cash' : m.name} — ${money(m.balance)}`}</option>)}</select>);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!dlg) return;
        const k = dlg.kind, d = dlg.data;
        const post = (body: any) => mo('/api/main-office', { method: 'POST', body });
        setBusy(true);
        try {
            if (k === 'receive') {
                const got = +f.received, diff = got - +d.amount;
                if (diff !== 0 && !await confirm({ title: diff < 0 ? `${money(-diff)} short?` : `${money(diff)} over?`, message: `${d.transfer_no}: sent ${money(d.amount)}, received ${money(got)}. The difference is recorded as cash ${diff < 0 ? 'short' : 'over'} at Main Office.`, confirmText: 'Confirm' })) return;
                const r = await post({ action: 'receive', id: d.id, received: f.received, notes: f.notes });
                toast(true, `${r.transfer_no} received.`);
            } else if (k === 'pay_request') {
                const r = await post({ action: 'pay_request', id: d.id, pay_account: f.pay_account, reference: f.reference });
                toast(true, `${r.request_no} paid — ${r.expense_no} booked to ${d.branch_name}.`);
            } else if (k === 'reject') {
                await post({ action: 'reject_request', id: d.id, reason: f.reason }); toast(true, `${d.request_no} rejected.`);
            } else if (k === 'pay_bill') {
                const r = await post({ action: 'pay_bill', kind: d.kind, id: d.id, amount: f.amount, pay_account: f.pay_account, reference: f.reference });
                toast(true, `${r.payment_no}: ${money(r.amount)} paid for ${d.no}.`);
            } else if (k === 'expense') {
                const r = await post({ action: 'expense', branch: f.branch, account_code: f.account_code, amount: f.amount, pay_account: f.pay_account, paid_to: f.paid_to, reference: f.reference, date: f.date, notes: f.notes });
                toast(true, `${r.expense_no} saved.`);
            } else if (k === 'transfer') {
                const toBranch = f.to_branch || status.main_office.branch_code;
                const r = await post({ action: 'transfer', from_account: f.from_account, to_branch: toBranch, to_account: f.to_account, amount: f.amount, reference: f.reference, notes: f.notes, date: f.date });
                toast(true, r.status === 'sent' ? `${r.transfer_no} sent — the branch confirms when the cash arrives.` : `${r.transfer_no} done.`);
            } else if (k === 'bank') {
                const r = await post({ action: 'bank_add', branch: f.branch, name: f.name, bank: f.bank, account_no: f.account_no });
                toast(true, `Bank account added (ledger ${r.account_code}).`);
            } else if (k === 'split') {
                const shares = rows.filter(r => r.branch && +r.amount > 0);
                const sum = Math.round(shares.reduce((t, r) => t + +r.amount, 0) * 1000), total = Math.round(+f.amount * 1000);
                if (!shares.length) { toast(false, 'Add the branches and their shares.'); return; }
                if (sum !== total) { toast(false, `The shares add up to ${fmt(sum / 1000)}, the bill is ${fmt(total / 1000)}.`); return; }
                const r = await post({ action: 'bill_split', supplier_id: f.supplier_id, cost_type: f.cost_type, bill_ref: f.bill_ref, date: f.date, description: f.description, consolidation_id: f.mode === 'ship' ? f.consolidation_id : null, shares });
                toast(true, `${r.bill_no} saved — ${money(r.total)} shared out to ${shares.length} branch${shares.length > 1 ? 'es' : ''}. Pay it from the list when due.`);
            } else if (k === 'void') {
                await post({ action: d.cancel ? 'transfer_cancel' : 'expense_void', id: d.id, reason: f.reason });
                toast(true, d.cancel ? `${d.no} cancelled — the cash is back in Main Office.` : `${d.no} voided.`);
            }
            setDlg(null); show();
        } catch (err) { toast(false, (err as Error).message); }
        finally { setBusy(false); }
    }
    const closeDay = async (e: React.FormEvent) => {
        e.preventDefault();
        const date = view?.d?.date;
        if (!await confirm({ title: `Close Main Office cash for ${day(date)}?`, message: 'Any difference is booked as cash over / short. This cannot be undone.', confirmText: 'Close day' })) return;
        try {
            const r = await mo('/api/main-office', { method: 'POST', body: { action: 'cash_close', counted: f.counted, notes: f.cnotes, date } });
            toast(true, +r.difference ? `Closed with a difference of ${money(r.difference)}.` : 'Closed — cash matches.');
            setF({}); show();
        } catch (err) { toast(false, (err as Error).message); }
    };
    async function openSplit() {
        try {
            const o = await mo('/api/main-office?view=split_options');
            setRows([{ branch: '', amount: '' }]);
            openDlg('split', o, { cost_type: 'freight', date: iso(), mode: 'hand' });
        } catch (e) { toast(false, (e as Error).message); }
    }
    async function shareOut() {
        if (!f.consolidation_id) return toast(false, 'Choose the consolidation.');
        if (!(+f.amount > 0)) return toast(false, 'Enter the bill total first.');
        try {
            const d = await mo(`/api/main-office?view=split_preview&consolidation=${encodeURIComponent(f.consolidation_id)}&amount=${encodeURIComponent(f.amount)}`);
            if (!d.shares.length) return toast(false, 'That consolidation has no shipments yet.');
            setRows(d.shares.map((x: any) => ({ branch: x.branch, amount: String(x.amount) })));
        } catch (e) { toast(false, (e as Error).message); }
    }
    async function statement(a: any) {
        try { const d = await mo(`/api/main-office?view=statement&branch=${encodeURIComponent(a.branch_code)}&account=${encodeURIComponent(a.account_code)}`); openDlg('statement', { ...a, lines: d.lines }); }
        catch (e) { toast(false, (e as Error).message); }
    }

    // ---------- panes ----------
    const tile = (label: string, value: string, sub?: string, tone = '') => (
        <div className="bg-[#F8F8FA] rounded-[1.5rem] p-4"><p className="sd-label">{label}</p><p className={`text-xl font-extrabold money ${tone}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>
    );
    const status3 = (s: string) => <span className={`pill-tag ${s === 'received' || s === 'paid' ? 'pill-green' : s === 'sent' || s === 'requested' ? 'pill-amber' : 'pill-gray'}`}>{s === 'sent' ? 'on the way' : s}</span>;
    const officeRows = (offices: any[]) => offices.filter(o => +o.owes || +o.in_transit).map(o => (
        <tr key={o.branch_code}><td className="p-3 pl-4 font-bold" data-label="Branch">{o.branch_name}<span className="block text-[10px] text-gray-400">{o.branch_code}</span></td>
            <td className={`p-3 text-right money font-extrabold ${+o.owes > 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Balance">{+o.owes > 0 ? `owes ${money(o.owes, o.currency)}` : `sent ${money(-o.owes, o.currency)}`}</td>
            <td className="p-3 pr-4 text-right money" data-label="On the way">{+o.in_transit ? money(o.in_transit, o.currency) : '—'}</td></tr>
    ));

    function Overview(d: any) {
        const total = d.money.reduce((s: number, m: Money) => s + +m.balance, 0);
        const transit = d.offices.reduce((s: number, o: any) => s + (o.currency === cur ? +o.in_transit : 0), 0);
        const owed = d.offices.reduce((s: number, o: any) => s + (o.currency === cur && +o.owes > 0 ? +o.owes : 0), 0);
        return <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                {tile('Total cash & bank', money(total), `${d.money.length} account${d.money.length === 1 ? '' : 's'}`)}
                {d.money.map((m: Money) => <div key={m.account_code}>{tile(m.kind === 'cash' ? 'Main Office Cash' : m.name, money(m.balance), m.kind === 'cash' ? 'in the drawer' : [m.bank_name, m.account_no].filter(Boolean).join(' · ') || 'bank')}</div>)}
                {tile('On the way from branches', money(transit), 'sent, not yet confirmed', transit ? 'text-amber-600' : '')}
                {tile('Branches owe Main Office', money(owed), 'costs paid for them, less cash sent', owed ? 'text-[#D55C48]' : '')}
            </div>
            {d.pending.transfers + d.pending.requests > 0 && <button type="button" className="w-full flex items-center justify-between gap-3 bg-[#FFF8EC] border border-amber-100 rounded-2xl px-4 py-3 mb-5 text-left" onClick={() => pick('approvals')}>
                <span className="text-xs font-bold text-amber-800">{`${d.pending.transfers ? `${d.pending.transfers} cash transfer${d.pending.transfers > 1 ? 's' : ''} to confirm` : ''}${d.pending.transfers && d.pending.requests ? ' · ' : ''}${d.pending.requests ? `${d.pending.requests} payment request${d.pending.requests > 1 ? 's' : ''}` : ''}`}</span>
                <span className="btn btn-dark btn-sm">Review</span></button>}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div>
                    <p className="sd-label mb-2">{`Main Office Cash today · ${day(iso())}`}</p>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 p-4 text-xs space-y-1.5 mb-4">
                        <div className="flex justify-between"><span className="text-gray-500">Opening</span><span className="money font-bold">{fmt(d.today.opening)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">+ In</span><span className="money font-bold text-emerald-600">{fmt(d.today.cash_in)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">− Out</span><span className="money font-bold text-[#D55C48]">{fmt(d.today.cash_out)}</span></div>
                        <div className="flex justify-between border-t border-gray-100 pt-1.5"><span className="font-extrabold">Should be in the drawer</span><span className="money font-extrabold">{money(d.today.expected)}</span></div>
                    </div>
                    <p className="sd-label mb-2">Branch balances with Main Office</p>
                    <Table heads={[['Branch'], ['Balance', 'right'], ['On the way', 'right']]} empty="Nothing owed either way.">{officeRows(d.offices)}</Table>
                </div>
                <div>
                    <p className="sd-label mb-2">Recent cash & bank movements</p>
                    <Table heads={[['When'], ['What'], ['Account'], ['In', 'right'], ['Out', 'right']]} empty="No movements yet.">
                        {d.moves.map((l: any, i: number) => <tr key={i}><td className="p-3 pl-4 whitespace-nowrap" data-label="When">{day(l.journal_entries.entry_date)}</td>
                            <td className="p-3" data-label="What">{l.journal_entries.memo}<span className="block text-[10px] text-gray-400">{l.journal_entries.created_by_name || ''}</span></td>
                            <td className="p-3" data-label="Account">{(d.money.find((m: Money) => m.account_code === l.account_code) || {}).name || l.account_code}</td>
                            <td className="p-3 text-right money text-emerald-600" data-label="In">{+l.debit ? fmt(l.debit) : ''}</td>
                            <td className="p-3 pr-4 text-right money text-[#D55C48]" data-label="Out">{+l.credit ? fmt(l.credit) : ''}</td></tr>)}
                    </Table>
                </div>
            </div>
        </>;
    }
    function Approvals(d: any) {
        return <>
            <p className="sd-label mb-2">Cash sent by branches — confirm what arrived</p>
            <div className="mb-6"><Table heads={[['Transfer'], ['From'], ['Sent'], ['Amount', 'right'], ['']]} empty="Nothing on the way.">
                {d.transfers.map((t: any) => <tr key={t.id}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Transfer">{t.transfer_no}{t.reference && <span className="block text-[10px] text-gray-400 font-sans">{`Ref ${t.reference}`}</span>}</td>
                    <td className="p-3" data-label="From">{t.from_name}{t.notes && <span className="block text-[10px] text-gray-400">{t.notes}</span>}</td>
                    <td className="p-3" data-label="Sent">{when(t.sent_at)}<span className="block text-[10px] text-gray-400">{t.sent_by_name || ''}</span></td>
                    <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(t.amount, t.currency)}</td>
                    <td className="p-3 pr-4 text-right" data-label=""><button type="button" className="btn btn-dark btn-sm" onClick={() => openDlg('receive', t, { received: String(+t.amount) })}>Confirm received</button></td></tr>)}
            </Table></div>
            <p className="sd-label mb-2">Payment requests from branches</p>
            <Table heads={[['Request'], ['Branch'], ['For'], ['Amount', 'right'], ['']]} empty="No requests waiting.">
                {d.requests.map((r: any) => <tr key={r.id}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Request">{r.request_no}<span className="block text-[10px] text-gray-400 font-sans">{`${when(r.requested_at)} · ${r.requested_by_name || ''}`}</span></td>
                    <td className="p-3" data-label="Branch">{r.branch_name}</td>
                    <td className="p-3" data-label="For"><b>{r.account_name}</b>{r.payee && ` · ${r.payee}`}<span className="block text-[10px] text-gray-500">{r.reason}</span></td>
                    <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(r.amount, r.currency)}</td>
                    <td className="p-3 pr-4 text-right whitespace-nowrap" data-label=""><button type="button" className="btn btn-coral btn-sm" onClick={() => openDlg('pay_request', r)}>Pay</button>{' '}<button type="button" className="btn btn-light btn-sm" onClick={() => openDlg('reject', r)}>Reject</button></td></tr>)}
            </Table>
        </>;
    }
    function Payments(d: any) {
        return <><div className="flex flex-wrap items-center justify-between gap-3 mb-3"><p className="text-xs text-gray-500">Unpaid agent and supplier bills of every branch. Paying one here takes the money from Main Office; the bill's branch then owes Main Office the amount.</p>
            <button type="button" className="btn btn-coral" onClick={openSplit}><Icon name="plus" />Split an agent bill</button></div>
            <Table heads={[['Bill'], ['Branch'], ['Agent / supplier'], ['Total', 'right'], ['Owed', 'right'], ['']]} empty="No unpaid bills.">
                {d.bills.map((b: any) => <tr key={b.kind + b.id}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Bill">{b.no}<span className="block text-[10px] text-gray-400 font-sans">{`${day(b.date)} · ${b.about}${b.ref ? ' · bill ' + b.ref : ''}`}</span></td>
                    <td className="p-3" data-label="Branch">{b.branch_name || b.branch_code}</td>
                    <td className="p-3" data-label="Agent / supplier">{b.party || '—'}</td>
                    <td className="p-3 text-right money" data-label="Total">{money(b.total, b.currency)}</td>
                    <td className="p-3 text-right money font-extrabold text-[#D55C48]" data-label="Owed">{money(b.owed, b.currency)}</td>
                    <td className="p-3 pr-4 text-right" data-label="">{b.currency === cur ? <button type="button" className="btn btn-dark btn-sm" onClick={() => openDlg('pay_bill', b, { amount: String(b.owed) })}>Pay</button> : <span className="text-[10px] text-gray-400">{b.currency}</span>}</td></tr>)}
            </Table></>;
    }
    function Expenses(d: any) {
        return <><div className="flex justify-end mb-3"><button type="button" className="btn btn-coral" onClick={() => openDlg('expense', null, { branch: status.main_office.branch_code, date: iso() })}><Icon name="plus" />Add expense</button></div>
            <Table heads={[['No.'], ['Date'], ['For'], ['Category'], ['Paid to'], ['Paid from'], ['Amount', 'right'], ['']]} empty="No expenses paid by Main Office yet.">
                {d.expenses.map((x: any) => <tr key={x.id} className={x.void ? 'opacity-50' : ''}><td className="p-3 pl-4 font-extrabold font-mono" data-label="No.">{x.expense_no}</td>
                    <td className="p-3" data-label="Date">{day(x.expense_date)}</td>
                    <td className="p-3" data-label="For">{x.branch_code === status.main_office.branch_code ? 'Main Office' : x.branch_name}</td>
                    <td className="p-3" data-label="Category">{x.accounts?.name || x.account_code}</td>
                    <td className="p-3" data-label="Paid to">{x.paid_to || '—'}{x.notes && <span className="block text-[10px] text-gray-400">{x.notes}</span>}</td>
                    <td className="p-3" data-label="Paid from">{x.paid_from_account === '1000' ? 'Cash' : (d.money.find((m: Money) => m.account_code === x.paid_from_account) || {}).name || x.paid_from_account}</td>
                    <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(x.amount, x.currency)}</td>
                    <td className="p-3 pr-4 text-right" data-label="">{x.void ? <span className="pill-tag pill-gray">Void</span> : <button type="button" className="btn btn-light btn-sm" onClick={() => openDlg('void', { id: x.id, no: x.expense_no })}>Void</button>}</td></tr>)}
            </Table></>;
    }
    function Transfers(d: any) {
        const M = status.main_office.branch_code;
        return <><div className="flex justify-end mb-3"><button type="button" className="btn btn-coral" onClick={() => openDlg('transfer', null, { to_branch: M, date: iso() })}><Icon name="plus" />New transfer</button></div>
            <Table heads={[['Transfer'], ['Date'], ['From'], ['To'], ['Amount', 'right'], ['Status'], ['']]} empty="No transfers yet.">
                {d.transfers.map((t: any) => {
                    const acct = (b: string, a: string) => a === '1000' ? `${b === M ? 'Main Office' : (b === t.from_branch ? t.from_name : t.to_name)} cash` : `${(d.banks.find((x: any) => x.branch_code === b && x.account_code === a) || {}).name || 'Bank'}${b === M ? '' : ` (${b === t.from_branch ? t.from_name : t.to_name})`}`;
                    return <tr key={t.id}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Transfer">{t.transfer_no}{t.reference && <span className="block text-[10px] text-gray-400 font-sans">{`Ref ${t.reference}`}</span>}</td>
                        <td className="p-3" data-label="Date">{day(t.transfer_date)}</td>
                        <td className="p-3" data-label="From">{acct(t.from_branch, t.from_account)}</td>
                        <td className="p-3" data-label="To">{acct(t.to_branch, t.to_account)}</td>
                        <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(t.amount, t.currency)}{t.received_amount != null && +t.received_amount !== +t.amount && <span className="block text-[10px] text-[#D55C48]">{`received ${fmt(t.received_amount)}`}</span>}</td>
                        <td className="p-3" data-label="Status">{status3(t.status)}</td>
                        <td className="p-3 pr-4 text-right" data-label="">{t.status === 'sent' && t.from_branch === M && <button type="button" className="btn btn-light btn-sm" onClick={() => openDlg('void', { id: t.id, no: t.transfer_no, cancel: true })}>Cancel</button>}</td></tr>;
                })}
            </Table></>;
    }
    function Accounts(d: any) {
        return <><div className="flex justify-end mb-3"><button type="button" className="btn btn-coral" onClick={() => openDlg('bank', null, { branch: status.main_office.branch_code })}><Icon name="plus" />Add bank account</button></div>
            <Table heads={[['Account'], ['Held by'], ['Bank'], ['Balance', 'right'], ['']]} empty="No accounts.">
                {d.accounts.map((a: any) => <tr key={a.branch_code + a.account_code}><td className="p-3 pl-4 font-extrabold" data-label="Account">{a.name}<span className="block text-[10px] text-gray-400 font-mono">{a.account_code}</span></td>
                    <td className="p-3" data-label="Held by">{a.branch_code === status.main_office.branch_code ? 'Main Office' : a.branch_name}</td>
                    <td className="p-3" data-label="Bank">{a.kind === 'cash' ? 'Cash' : [a.bank_name, a.account_no].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="p-3 text-right money font-extrabold" data-label="Balance">{money(a.balance, a.currency)}</td>
                    <td className="p-3 pr-4 text-right" data-label=""><button type="button" className="btn btn-light btn-sm" onClick={() => statement(a)}>Statement</button></td></tr>)}
            </Table></>;
    }
    function Cash(d: any) {
        const done = d.closings.find((c: any) => c.close_date === d.date);
        return <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <form className="bg-[#F8F8FA] rounded-[2rem] p-5 space-y-3" onSubmit={closeDay}>
                <div className="flex items-center justify-between"><span className="pill-tag pill-dark">{d.currency}</span><span className="text-[11px] font-bold text-gray-400">{day(d.date)}</span></div>
                <div className="bg-white rounded-2xl p-4 text-xs space-y-1.5">
                    <div className="flex justify-between"><span className="text-gray-500">{`Opening (last count${d.day.last_closed ? ' ' + day(d.day.last_closed) : ''})`}</span><span className="money font-bold">{fmt(d.day.opening)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">+ Cash in</span><span className="money font-bold text-emerald-600">{fmt(d.day.cash_in)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">− Cash out</span><span className="money font-bold text-[#D55C48]">{fmt(d.day.cash_out)}</span></div>
                    <div className="flex justify-between border-t border-gray-100 pt-1.5"><span className="font-extrabold">Should be in the drawer</span><span className="money font-extrabold">{money(d.day.expected)}</span></div>
                </div>
                {done ? <p className="text-xs">{`Closed by ${done.closed_by_name || ''} · counted ${money(done.counted)} · difference ${fmt(done.difference)}`}</p>
                    : <><div className="grid grid-cols-2 gap-2"><input type="number" step="0.001" min="0" className="field" placeholder="Counted" required aria-label="Counted cash" value={f.counted || ''} onChange={set('counted')} /><input className="field" placeholder="Note (optional)" aria-label="Note" value={f.cnotes || ''} onChange={set('cnotes')} /></div>
                        <button className="btn btn-dark w-full"><Icon name="check" />{`Close Main Office cash for ${day(d.date)}`}</button></>}
            </form>
            <div><p className="sd-label mb-2">History</p>
                <Table heads={[['Date'], ['Expected', 'right'], ['Counted', 'right'], ['Difference', 'right'], ['By']]} empty="No closings yet.">
                    {d.closings.map((c: any) => <tr key={c.id}><td className="p-3 pl-4" data-label="Date">{day(c.close_date)}</td><td className="p-3 text-right money" data-label="Expected">{fmt(c.expected)}</td><td className="p-3 text-right money" data-label="Counted">{fmt(c.counted)}</td>
                        <td className={`p-3 text-right money font-extrabold ${+c.difference ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Difference">{fmt(c.difference)}</td><td className="p-3 pr-4" data-label="By">{c.closed_by_name || ''}</td></tr>)}
                </Table></div>
        </div>;
    }

    // ---------- popup contents ----------
    function dialogBody(): [string, string, ReactNode, string] {
        if (!dlg) return ['', '', null, ''];
        const d = dlg.data, k = dlg.kind, M = status?.main_office?.branch_code;
        if (k === 'receive') return [`Confirm ${d.transfer_no}`, `${d.from_name} sent ${money(d.amount, d.currency)} on ${when(d.sent_at)}.`, <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('fGot', 'Amount received (counted)', <input id="fGot" type="number" step="0.001" min="0" className="field" required value={f.received || ''} onChange={set('received')} />)}
            {field('fNotes', 'Note', <input id="fNotes" className="field" placeholder="Optional" value={f.notes || ''} onChange={set('notes')} />)}</div>, 'Confirm received'];
        if (k === 'pay_request') return [`Pay ${d.request_no}`, `${money(d.amount, d.currency)} for ${d.branch_name} — ${d.account_name}${d.payee ? ' · ' + d.payee : ''}. Booked as the branch's expense, paid from Main Office.`,
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{payFrom()}{field('fRef', 'Reference', <input id="fRef" className="field" placeholder="Receipt / cheque no." value={f.reference || ''} onChange={set('reference')} />)}</div>, 'Pay'];
        if (k === 'reject') return [`Reject ${d.request_no}?`, `${d.branch_name} asked for ${money(d.amount, d.currency)}: ${d.reason}`,
            field('fReason', 'Reason', <input id="fReason" className="field" required value={f.reason || ''} onChange={set('reason')} />), 'Reject'];
        if (k === 'pay_bill') return [`Pay ${d.no}`, `${d.branch_name || d.branch_code} · ${d.party || 'no supplier'} · owed ${money(d.owed, d.currency)}`,
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{field('fAmt', 'Amount', <input id="fAmt" type="number" step="0.001" min="0" className="field" required value={f.amount || ''} onChange={set('amount')} />)}{payFrom()}{field('fRef', 'Reference', <input id="fRef" className="field" value={f.reference || ''} onChange={set('reference')} />)}</div>, 'Pay'];
        if (k === 'expense') {
            const v = view?.d || {};
            return ['Add expense', 'For Main Office itself, or a cost paid for a branch (it shows in that branch’s profit & loss and the branch owes Main Office).', <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field('fFor', 'Cost belongs to', <select id="fFor" className="field" value={f.branch || ''} onChange={set('branch')}>{(v.branches || []).map((b: any) => <option key={b.branch_code} value={b.branch_code}>{b.branch_code === M ? 'Main Office' : b.branch_name}</option>)}</select>)}
                {field('fCat', 'Category', <select id="fCat" className="field" required value={f.account_code || ''} onChange={set('account_code')}><option value="">Choose…</option>{(v.categories || []).map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>)}
                {field('fAmt', 'Amount', <input id="fAmt" type="number" step="0.001" min="0" className="field" required value={f.amount || ''} onChange={set('amount')} />)}
                {payFrom()}
                {field('fTo', 'Paid to', <input id="fTo" className="field" placeholder="e.g. landlord, agent" value={f.paid_to || ''} onChange={set('paid_to')} />)}
                {field('fRef', 'Bill / reference no.', <input id="fRef" className="field" value={f.reference || ''} onChange={set('reference')} />)}
                {field('fDate', 'Date', <input id="fDate" type="date" className="field" max={iso()} value={f.date || ''} onChange={set('date')} />)}
                {field('fNotes', 'Notes', <input id="fNotes" className="field" value={f.notes || ''} onChange={set('notes')} />)}</div>, 'Save expense'];
        }
        if (k === 'transfer') {
            const v = view?.d || {}, toBranch = f.to_branch || M;
            const destinations = toBranch === M ? moneyOf().filter(m => m.account_code !== f.from_account).map(m => [m.account_code, m.kind === 'cash' ? 'Main Office Cash' : m.name])
                : [['1000', 'Branch cash drawer (branch confirms)'], ...(v.banks || []).filter((b: any) => b.branch_code === toBranch).map((b: any) => [b.account_code, `${b.name} (bank)`])];
            return ['New transfer', 'Deposit cash, withdraw, move between banks, or send a float to a branch. A transfer is never an expense.', <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field('fFrom', 'From', <select id="fFrom" className="field" required value={f.from_account || ''} onChange={set('from_account')}><option value="">Choose…</option>{moneyOf().map(m => <option key={m.account_code} value={m.account_code}>{`${m.kind === 'cash' ? 'Main Office Cash' : m.name} — ${money(m.balance)}`}</option>)}</select>)}
                {field('fToB', 'To', <select id="fToB" className="field" value={toBranch} onChange={e => setF(x => ({ ...x, to_branch: e.target.value, to_account: '' }))}><option value={M}>Main Office</option>{(v.branches || []).map((b: any) => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}</select>)}
                {field('fToA', 'Into', <select id="fToA" className="field" required value={f.to_account || ''} onChange={set('to_account')}><option value="">Choose…</option>{destinations.map(([c, n]: any) => <option key={c} value={c}>{n}</option>)}</select>)}
                {field('fAmt', 'Amount', <input id="fAmt" type="number" step="0.001" min="0" className="field" required value={f.amount || ''} onChange={set('amount')} />)}
                {field('fDate', 'Date', <input id="fDate" type="date" className="field" max={iso()} value={f.date || ''} onChange={set('date')} />)}
                {field('fRef', 'Reference', <input id="fRef" className="field" placeholder="Deposit slip / cheque no." value={f.reference || ''} onChange={set('reference')} />)}
                {field('fNotes', 'Notes', <input id="fNotes" className="field" value={f.notes || ''} onChange={set('notes')} />, 'sm:col-span-2')}</div>, 'Transfer'];
        }
        if (k === 'bank') {
            const v = view?.d || {};
            return ['Add bank account', 'Held by Main Office, or by a branch that has its own account. It gets its own balance and statement.', <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field('fHold', 'Held by', <select id="fHold" className="field" value={f.branch || ''} onChange={set('branch')}>{(v.branches || []).map((b: any) => <option key={b.branch_code} value={b.branch_code}>{b.branch_code === M ? 'Main Office' : b.branch_name}</option>)}</select>)}
                {field('fName', 'Name', <input id="fName" className="field" required placeholder="e.g. Bank Muscat — current" value={f.name || ''} onChange={set('name')} />)}
                {field('fBank', 'Bank', <input id="fBank" className="field" placeholder="Bank Muscat" value={f.bank || ''} onChange={set('bank')} />)}
                {field('fNo', 'Account no.', <input id="fNo" className="field" value={f.account_no || ''} onChange={set('account_no')} />)}</div>, 'Add account'];
        }
        if (k === 'split') {
            const sum = rows.reduce((t, r) => t + (+r.amount || 0), 0), total = +f.amount || 0, off = Math.round((sum - total) * 1000) !== 0;
            const used = new Set(rows.map(r => r.branch));
            const setRow = (i: number, k2: 'branch' | 'amount', v: string) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k2]: v } : r));
            return ['Split an agent bill', 'One bill for shipments of several branches. Main Office owes the agent and pays it; each branch carries its share as its own cost and owes Main Office that share.', <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {field('sSup', 'Agent / supplier', <select id="sSup" className="field" required value={f.supplier_id || ''} onChange={set('supplier_id')}><option value="">Choose…</option>{(d.suppliers || []).map((x: any) => <option key={x.id} value={x.id}>{x.name + (x.kind === 'supplier' ? '' : ' (agent)')}</option>)}</select>)}
                    {field('sType', 'Cost', <select id="sType" className="field" value={f.cost_type || 'freight'} onChange={set('cost_type')}>{COST_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>)}
                    {field('sRef', 'Their bill no.', <input id="sRef" className="field" value={f.bill_ref || ''} onChange={set('bill_ref')} />)}
                    {field('sDate', 'Bill date', <input id="sDate" type="date" className="field" max={iso()} value={f.date || ''} onChange={set('date')} />)}
                    {field('sAmt', 'Bill total', <input id="sAmt" type="number" step="0.001" min="0" className="field" required value={f.amount || ''} onChange={set('amount')} />)}
                    {field('sDesc', 'Note', <input id="sDesc" className="field" placeholder="e.g. week 47 shipments" value={f.description || ''} onChange={set('description')} />)}
                </div>
                <div className="grid grid-cols-2 gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full">
                    <button type="button" className="opt py-2 rounded-full text-[11px] font-extrabold" aria-pressed={f.mode === 'ship'} onClick={() => setF(x => ({ ...x, mode: 'ship' }))}>By shipments (weight / CBM)</button>
                    <button type="button" className="opt py-2 rounded-full text-[11px] font-extrabold" aria-pressed={f.mode !== 'ship'} onClick={() => setF(x => ({ ...x, mode: 'hand' }))}>By hand</button>
                </div>
                {f.mode === 'ship' && <div className="flex flex-col sm:flex-row gap-2 items-end">
                    {field('sCons', 'Consolidation (MAWB / container / bag)', <select id="sCons" className="field" value={f.consolidation_id || ''} onChange={set('consolidation_id')}><option value="">Choose…</option>{(d.consolidations || []).map((c: any) => <option key={c.id} value={c.id}>{`${String(c.kind).toUpperCase()} ${c.mawb}${c.dest_country ? ' · ' + c.dest_country : ''}${c.closed ? ' (closed)' : ''}`}</option>)}</select>, 'flex-1 w-full')}
                    <button type="button" className="btn btn-dark" onClick={shareOut}>Share out by shipments</button></div>}
                <div className="space-y-2" id="sRows">
                    {rows.map((r, i) => <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <select className="field col-span-7" aria-label="Branch" value={r.branch} onChange={e => setRow(i, 'branch', e.target.value)}><option value="">Branch…</option>
                            {(d.branches || []).map((b: any) => <option key={b.branch_code} value={b.branch_code} disabled={b.branch_code !== r.branch && used.has(b.branch_code)}>{b.branch_type === 'main_office' ? 'Main Office (its own share)' : b.branch_name}</option>)}</select>
                        <input type="number" step="0.001" min="0" className="field col-span-4" aria-label="Share" placeholder="Share" value={r.amount} onChange={e => setRow(i, 'amount', e.target.value)} />
                        <button type="button" className="icon-btn col-span-1 justify-self-end" aria-label="Remove" onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : [{ branch: '', amount: '' }])}><Icon name="x" cls="w-3.5 h-3.5" /></button>
                    </div>)}
                    <div className="flex items-center justify-between gap-2">
                        <button type="button" className="btn btn-light btn-sm" onClick={() => setRows(rs => [...rs, { branch: '', amount: '' }])}><Icon name="plus" />Add branch</button>
                        <span className={`text-xs font-extrabold ${off ? 'text-[#D55C48]' : 'text-emerald-600'}`}>{`Shares ${fmt(sum)} of ${fmt(total)}${off ? ` — ${sum > total ? 'over' : 'short'} by ${fmt(Math.abs(sum - total))}` : ' ✓'}`}</span>
                    </div>
                </div></div>, 'Save bill'];
        }
        if (k === 'void') return [d.cancel ? `Cancel ${d.no}?` : `Void ${d.no}?`, d.cancel ? 'The cash comes back to Main Office.' : 'Both sides are reversed: the cost and the money paid.',
            field('fReason', 'Reason', <input id="fReason" className="field" required value={f.reason || ''} onChange={set('reason')} />), d.cancel ? 'Cancel transfer' : 'Void'];
        // statement
        let run = 0;
        return [`${d.name} — statement`, `${d.branch_code === M ? 'Main Office' : d.branch_name} · balance ${money(d.balance, d.currency)}`, <Table heads={[['Date'], ['What'], ['In', 'right'], ['Out', 'right'], ['Balance', 'right']]} empty="No movements yet.">
            {d.lines.map((l: any, i: number) => { run += +l.debit - +l.credit; return <tr key={i}><td className="p-3 pl-4 whitespace-nowrap" data-label="Date">{day(l.journal_entries.entry_date)}</td><td className="p-3" data-label="What">{l.journal_entries.memo}</td>
                <td className="p-3 text-right money text-emerald-600" data-label="In">{+l.debit ? fmt(l.debit, d.currency) : ''}</td><td className="p-3 text-right money text-[#D55C48]" data-label="Out">{+l.credit ? fmt(l.credit, d.currency) : ''}</td>
                <td className="p-3 pr-4 text-right money font-bold" data-label="Balance">{fmt(run, d.currency)}</td></tr>; })}
        </Table>, ''];
    }
    const [dTitle, dSub, dBody, dOk] = dialogBody();
    const popups = (
        <Modal id="moModal" open={!!dlg} onClose={() => setDlg(null)} panelClassName={dlg?.kind === 'statement' || dlg?.kind === 'split' ? 'max-w-3xl' : 'max-w-xl'} form={{ id: 'moForm', onSubmit: submit }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 className="text-lg font-extrabold">{dTitle}</h3><p className="text-xs text-gray-400 mt-0.5">{dSub}</p></div>
                <CloseX />
            </div>
            <div className="my-5 overflow-y-auto custom-scrollbar">{dBody}</div>
            {dOk && <div className="flex justify-end gap-2 pt-4 border-t border-gray-100"><button className={`btn ${dlg?.kind === 'reject' || dlg?.kind === 'void' ? 'btn-coral' : 'btn-dark'}`} disabled={busy}>{dOk}</button></div>}
        </Modal>
    );

    const gTitle = phase === 'loading' ? 'Loading…' : phase === 'error' ? 'Could not load' : phase === 'noaccess' ? 'Main Office cashiers only' : phase === 'nomo' ? 'No Main Office yet'
        : mode === 'set' ? 'Set your PIN' : mode === 'change' ? 'Change your PIN' : 'Unlock Main Office';
    const gText = phase === 'loading' ? '' : phase === 'error' ? loadErr
        : phase === 'noaccess' ? 'Ask the super admin to turn on "Main Office cashier" for your account in Staff & Users.'
            : phase === 'nomo' ? 'The super admin adds it in Branch Network → Add branch → type "Main Office".'
                : mode === 'set' ? 'Pick 4–6 digits only you know. The same PIN opens the warehouse.'
                    : mode === 'change' ? 'Enter your current PIN, then the new one twice.'
                        : status?.locked_until ? `Too many wrong PINs — try again after ${new Date(status.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`
                            : 'Enter your PIN. It stays unlocked for 30 minutes in this tab.';
    const working = phase === 'work', changingFromWork = phase === 'gate' && mode === 'change';
    const pinField = (ref: React.Ref<HTMLInputElement> | null, id: string, k: 'cur' | 'pin' | 'pin2', placeholder: string, label: string, hidden: boolean) => (
        <input id={id} ref={ref} className={`field pin-box${hidden ? ' hidden' : ''}`} type="password" inputMode="numeric" pattern="\d*" maxLength={6} placeholder={placeholder} aria-label={label} autoComplete="off"
            value={pins[k]} onChange={e => setPins({ ...pins, [k]: e.target.value })} />
    );
    const RENDER: Record<Tab, (d: any) => ReactNode> = { overview: Overview, approvals: Approvals, payments: Payments, expenses: Expenses, transfers: Transfers, accounts: Accounts, cash: Cash };
    const pane = !view ? null : paneErr ? <p className="text-center text-gray-400 p-10">{paneErr}</p> : view.d ? RENDER[view.tab](view.d) : null;

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="cash" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Main Office</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{'Cash & bank • approvals • payments • PIN protected'}</p>
                        </div>
                    </div>
                    <div className={`${working || changingFromWork ? '' : 'hidden '}flex items-center gap-2 self-start sm:self-auto`}>
                        <span className="pill-tag pill-green">{left}</span>
                        <button type="button" className="btn btn-light btn-sm" onClick={() => gate('change')}><Icon name="key" />Change PIN</button>
                        <button type="button" id="moLock" className="btn btn-dark btn-sm" onClick={() => lock()}><Icon name="lock" />Lock</button>
                    </div>
                </section>

                <div id="gate" className={`${working ? 'hidden ' : ''}max-w-sm mx-auto py-8 text-center`}>
                    <div className="w-16 h-16 rounded-3xl bg-[#111827] text-white flex items-center justify-center mx-auto mb-4"><Icon name="lock" cls="w-7 h-7" /></div>
                    <h2 className="text-xl font-extrabold">{gTitle}</h2>
                    <p className="text-xs text-gray-500 mt-1 mb-5">{gText}</p>
                    <form id="moGate" className={`space-y-3${phase === 'gate' ? '' : ' hidden'}`} autoComplete="off" onSubmit={submitGate}>
                        {pinField(gCur, 'mCurrent', 'cur', 'Current', 'Current PIN', mode !== 'change')}
                        {pinField(gPin, 'mPin', 'pin', mode === 'enter' ? '••••' : 'New PIN', 'PIN', false)}
                        {pinField(null, 'mPin2', 'pin2', 'Again', 'Repeat PIN', mode === 'enter')}
                        <button id="mBtn" className="btn btn-coral w-full justify-center" disabled={gBusy}>{mode === 'enter' ? 'Unlock' : 'Save PIN'}</button>
                        <button type="button" className={`btn btn-light w-full justify-center${changingFromWork ? '' : ' hidden'}`} onClick={() => setPhase('work')}>Cancel</button>
                    </form>
                </div>

                <div id="work" className={working ? '' : 'hidden'}>
                    <div className="flex flex-wrap gap-1 bg-[#F8F8FA] p-1 rounded-full self-start w-fit mb-5" role="tablist">
                        {TABS.map(([k, l]) => <button key={k} type="button" className="opt px-4 py-2 rounded-full text-[11px] font-extrabold" data-tab={k} aria-pressed={tab === k} onClick={() => pick(k)}>{k === 'approvals' && pending ? `${l} · ${pending}` : l}</button>)}
                    </div>
                    <div key={view?.n || 0} className="ui-fade">{pane}</div>
                </div>
            </div>
        </AppFrame>
    );
}
