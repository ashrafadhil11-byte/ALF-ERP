// Customers — same page as admin/customers.html: list built from every booking, profile with KPIs, details,
// receivers, shipments and invoices; merge a duplicate. Data: GET/POST /api/customers
import { Fragment, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { PageLink } from '../components/PageLink';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { markClean } from '../lib/guard';
import { day, money } from '../lib/money';
import { session } from '../lib/session';
import { toast } from '../lib/toast';
import './customers.css';

type Amount = { currency: string; amount: number };
type Customer = { id: number; name?: string; customer_no?: string; phone?: string; civil_id?: string; whatsapp?: string; email?: string; tags?: string[]; address?: string; notes?: string; blocked?: boolean;
    branch_code?: string; first_booking_at?: string; created_at?: string; last_booking_at?: string; balance: Amount[]; stats?: { shipments?: number; kg?: number; last_shipment_at?: string } };
type Profile = { customer: Customer; stats?: { shipments?: number; kg?: number }; spent: Amount[]; balance: Amount[];
    contacts: { id: number; name: string; times_used: number; phone?: string; address?: string; city?: string; country?: string }[];
    bookings: { awb: string; booked_at?: string; consignee?: string; dest_city?: string; dest_country?: string; pieces?: number; chargeable_weight?: number; weight?: number; current_status?: string }[];
    invoices: { invoice_no: string; awb?: string; issued_at?: string; currency: string; total: number; balance: number; status: string }[] };

const SP: Record<string, string> = { paid: 'pill-green', partial: 'pill-amber', unpaid: 'pill-coral', void: 'pill-gray' };
const initials = (n?: string) => (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const EMPTY = { name: '', civil_id: '', email: '', tags: '', address: '', notes: '', blocked: false };

function CloseX() {
    const dismiss = useDismiss();
    return <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>;
}

export function Customers() {
    const [params] = useSearchParams();
    const isOps = ['super_admin', 'head_office', 'branch_manager'].includes(session.role());
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('');
    const [list, setList] = useState<Customer[]>([]);
    const [more, setMore] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const page = useRef(0);
    const first = useRef(true);

    const [current, setCurrent] = useState<Profile | null>(null);
    const [showProfile, setShowProfile] = useState(false);
    const [f, setF] = useState(EMPTY);
    const wa = useRef<PhoneHandle>(null);

    const [showMerge, setShowMerge] = useState(false);
    const [mq, setMq] = useState('');
    const [mList, setMList] = useState<Customer[] | null>(null);
    const mSearch = useRef<HTMLInputElement>(null);

    async function load(reset = true) {
        if (reset) page.current = 0;
        try {
            const d = await api<{ customers: Customer[]; more: boolean }>(`/api/customers?q=${encodeURIComponent(search.trim())}&page=${page.current}${filter ? '&filter=' + filter : ''}`);
            setList(prev => (reset ? [] : prev).concat(d.customers)); setMore(!!d.more);
        } catch (e) { toast(false, (e as Error).message); if (reset) setList([]); }
        setLoaded(true);
    }
    useEffect(() => {
        const t = setTimeout(async () => {
            await load();
            if (first.current) { first.current = false; const id = params.get('id'); if (id) openProfile(+id); }
        }, first.current ? 0 : 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, filter]);

    async function openProfile(id: number) {
        let d: Profile;
        try { d = await api<Profile>(`/api/customers?id=${id}`); } catch (e) { return toast(false, (e as Error).message); }
        const c = d.customer;
        setCurrent(d);
        setF({ name: c.name || '', civil_id: c.civil_id || '', email: c.email || '', tags: (c.tags || []).join(', '), address: c.address || '', notes: c.notes || '', blocked: !!c.blocked });
        if (c.whatsapp) wa.current?.setValue(c.whatsapp); else wa.current?.reset();
        setShowProfile(true);
    }
    const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setF(v => ({ ...v, [k]: k === 'blocked' ? (e.target as HTMLInputElement).checked : e.target.value }));

    async function save(e: React.FormEvent) {
        e.preventDefault();
        const c = current!.customer;
        try {
            await api('/api/customers', { method: 'POST', body: { action: 'save', id: c.id, name: f.name, civil_id: f.civil_id, whatsapp: wa.current?.value || '', email: f.email, tags: f.tags, address: f.address, notes: f.notes, ...(isOps ? { blocked: f.blocked } : {}) } });
            toast(true, 'Saved.');
            markClean(document.getElementById('profile'));   // saved: closing no longer asks
            await openProfile(c.id); load();
        } catch (err) { toast(false, (err as Error).message); }
    }
    async function removeReceiver(id: number) {
        if (!await confirm({ title: 'Remove this receiver?', message: 'Only from the saved list — shipments are not changed.', confirmText: 'Remove' })) return;
        try { await api('/api/customers', { method: 'POST', body: { action: 'contact_delete', id } }); openProfile(current!.customer.id); } catch (err) { toast(false, (err as Error).message); }
    }

    // merge
    useEffect(() => {
        if (!showMerge) return;
        const t = setTimeout(async () => {
            const q = mq.trim(); if (q.length < 2) { setMList(null); return; }
            const d = await api<{ customers: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}`).catch(() => ({ customers: [] as Customer[] }));
            setMList(d.customers.filter(c => c.id !== current?.customer.id));
        }, 300);
        return () => clearTimeout(t);
    }, [mq, showMerge, current]);
    const openMerge = () => { setMq(''); setMList(null); setShowMerge(true); setTimeout(() => mSearch.current?.focus(), 50); };
    async function merge(c: Customer) {
        const keep = current!.customer;
        if (!await confirm({ title: `Merge ${c.name} into ${keep.name}?`, message: 'Their shipments, invoices and receivers move here. This cannot be undone.', confirmText: 'Merge', danger: true })) return;
        try { await api('/api/customers', { method: 'POST', body: { action: 'merge', keep: keep.id, drop: c.id } }); setShowMerge(false); toast(true, 'Merged.'); openProfile(keep.id); load(); }
        catch (err) { toast(false, (err as Error).message); }
    }

    const d = current, c = d?.customer;
    const kpi = (label: string, val: React.ReactNode, cls = '') => <div className="bg-[#F8F8FA] rounded-2xl p-3"><p className="sd-label">{label}</p><div className={`text-lg font-extrabold ${cls}`}>{val}</div></div>;
    const amounts = (a: Amount[]) => a.map((s, i) => <span key={i} className="block money text-base">{money(s.currency, s.amount)}</span>);

    const popups = <>
        <Modal id="profile" open={showProfile} onClose={() => setShowProfile(false)} panelClassName="max-w-4xl">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <span id="pAvatar" className="w-12 h-12 rounded-2xl bg-[#111827] text-white flex items-center justify-center font-extrabold text-lg flex-shrink-0">{c ? initials(c.name) : ''}</span>
                    <div className="min-w-0"><h3 id="pName" className="text-xl font-extrabold truncate">{c?.name}</h3>
                        <p id="pSub" className="text-xs text-gray-400">{c ? [c.customer_no, c.phone, c.branch_code && 'since ' + day(c.first_booking_at || c.created_at)].filter(Boolean).join(' · ') : ''}</p></div>
                </div>
                <CloseX />
            </div>
            <div className="my-5 space-y-5 overflow-y-auto custom-scrollbar pr-1">
                <div id="pKpis" className="grid grid-cols-2 lg:grid-cols-4 gap-3">{d && <>
                    {kpi('Shipments', d.stats?.shipments ?? 0)}
                    {kpi('Shipped', `${Math.round(+(d.stats?.kg || 0))} kg`)}
                    {kpi('Invoiced', d.spent.length ? amounts(d.spent) : '—')}
                    {kpi('Balance due', d.balance.length ? amounts(d.balance) : <span className="text-emerald-600">Nothing</span>, d.balance.length ? 'text-[#D55C48]' : '')}
                </>}</div>
                <form id="pForm" onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-[#F8F8FA] rounded-[1.5rem] p-4">
                    <div><label className="ui-label" htmlFor="fName">Name</label><input id="fName" className="field" required value={f.name} onChange={set('name')} /></div>
                    <div><label className="ui-label">Phone</label><input id="fPhone" className="field soft" readOnly title="The phone links bookings to this customer" value={c?.phone || ''} /></div>
                    <div><label className="ui-label" htmlFor="fCivil">Civil ID / passport</label><input id="fCivil" className="field" value={f.civil_id} onChange={set('civil_id')} /></div>
                    <div><label className="ui-label" htmlFor="fWa">WhatsApp</label><PhoneField ref={wa} country="OM" inputProps={{ id: 'fWa', className: 'field', placeholder: 'WhatsApp number' }} /></div>
                    <div><label className="ui-label" htmlFor="fEmail">Email</label><input id="fEmail" type="email" className="field" value={f.email} onChange={set('email')} /></div>
                    <div><label className="ui-label" htmlFor="fTags">Tags</label><input id="fTags" className="field" placeholder="e.g. VIP, corporate" value={f.tags} onChange={set('tags')} /></div>
                    <div className="sm:col-span-2 lg:col-span-3"><label className="ui-label" htmlFor="fAddr">Address</label><input id="fAddr" className="field" value={f.address} onChange={set('address')} /></div>
                    <div className="sm:col-span-2 lg:col-span-3"><label className="ui-label" htmlFor="fNotes">Notes</label><textarea id="fNotes" rows={2} className="field" value={f.notes} onChange={set('notes')}></textarea></div>
                    <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap justify-between gap-2 items-center">
                        <label id="blockWrap" className={`flex items-center gap-2 text-xs font-bold text-[#D55C48]${isOps ? '' : ' hidden'}`}><input id="fBlocked" type="checkbox" className="w-4 h-4" checked={f.blocked} onChange={set('blocked')} />Blocked (warn staff at booking)</label>
                        <div className="flex gap-2"><button type="button" id="mergeBtn" className={`btn btn-light btn-sm${isOps ? '' : ' hidden'}`} onClick={openMerge}><Icon name="layers" />Merge a duplicate</button><button className="btn btn-dark btn-sm">Save details</button></div>
                    </div>
                </form>
                <div>
                    <p className="sd-label mb-2">Receivers <span id="pRcvCount" className="text-gray-400">{d ? `· ${d.contacts.length}` : ''}</span></p>
                    <div id="pReceivers" className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {d && (d.contacts.length ? d.contacts.map(r => (
                            <div key={r.id} className="flex items-start justify-between gap-2 bg-white border border-gray-100 rounded-2xl p-3">
                                <div className="min-w-0 text-xs"><p className="font-extrabold">{r.name + ' '}<span className="text-[10px] text-gray-400 font-bold">{'× ' + r.times_used}</span></p>
                                    <p className="text-gray-500">{r.phone || ''}</p><p className="text-[11px] text-gray-400 truncate">{[r.address, r.city, r.country].filter(Boolean).join(', ')}</p></div>
                                <button type="button" className="icon-btn !w-7 !h-7" data-rdel={r.id} aria-label="Remove receiver" onClick={() => removeReceiver(r.id)}><Icon name="x" cls="w-3 h-3" /></button>
                            </div>)) : <p className="text-xs text-gray-400">No receivers yet.</p>)}
                    </div>
                </div>
                <div>
                    <p className="sd-label mb-2">Shipments</p>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden"><table className="rtable w-full text-xs">
                        <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100"><th className="p-3 pl-4 font-extrabold">AWB</th><th className="p-3 font-extrabold">Date</th><th className="p-3 font-extrabold">Receiver</th><th className="p-3 font-extrabold">Pcs / kg</th><th className="p-3 pr-4 font-extrabold">Status</th></tr></thead>
                        <tbody id="pShip" className="divide-y divide-gray-100">{d && (d.bookings.length ? d.bookings.map(b => (
                            <tr key={b.awb}><td className="p-3 pl-4 font-extrabold font-mono" data-label="AWB"><PageLink page="shipments.html" search={`?awb=${encodeURIComponent(b.awb)}`} className="hover:text-coral-600">{b.awb}</PageLink></td>
                                <td className="p-3" data-label="Date">{day(b.booked_at)}</td><td className="p-3" data-label="Receiver">{b.consignee || '—'}<span className="block text-[10px] text-gray-400">{[b.dest_city, b.dest_country].filter(Boolean).join(', ')}</span></td>
                                <td className="p-3" data-label="Pcs / kg">{`${b.pieces ?? '—'} / ${b.chargeable_weight ?? b.weight ?? '—'}`}</td>
                                <td className="p-3 pr-4" data-label="Status"><span className="pill-tag pill-gray">{b.current_status || ''}</span></td></tr>
                        )) : <tr><td colSpan={5} className="p-6 text-center text-gray-400">No shipments.</td></tr>)}</tbody></table></div>
                </div>
                <div>
                    <p className="sd-label mb-2">Invoices</p>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden"><table className="rtable w-full text-xs">
                        <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100"><th className="p-3 pl-4 font-extrabold">Invoice</th><th className="p-3 font-extrabold">Date</th><th className="p-3 font-extrabold text-right">Total</th><th className="p-3 font-extrabold text-right">Balance</th><th className="p-3 pr-4 font-extrabold">Status</th></tr></thead>
                        <tbody id="pInv" className="divide-y divide-gray-100">{d && (d.invoices.length ? d.invoices.map(i => (
                            <tr key={i.invoice_no}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Invoice">{i.invoice_no}{i.awb && <span className="block text-[10px] text-gray-400 font-sans">{i.awb}</span>}</td>
                                <td className="p-3" data-label="Date">{day(i.issued_at)}</td><td className="p-3 text-right money" data-label="Total">{money(i.currency, i.total)}</td>
                                <td className="p-3 text-right money" data-label="Balance">{+i.balance && i.status !== 'void' ? money(i.currency, i.balance) : '—'}</td>
                                <td className="p-3 pr-4" data-label="Status"><span className={`pill-tag ${SP[i.status]}`}>{i.status}</span></td></tr>
                        )) : <tr><td colSpan={5} className="p-6 text-center text-gray-400">No invoices.</td></tr>)}</tbody></table></div>
                </div>
            </div>
        </Modal>

        <Modal id="mergeModal" open={showMerge} onClose={() => setShowMerge(false)} panelClassName="max-w-lg">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 className="text-lg font-extrabold">Merge a duplicate</h3><p id="mSub" className="text-xs text-gray-400 mt-0.5">{c && showMerge ? `Everything from the duplicate moves into ${c.customer_no} ${c.name}.` : ''}</p></div>
                <CloseX />
            </div>
            <div className="my-5 space-y-3">
                <input id="mSearch" ref={mSearch} className="field" placeholder="Find the duplicate by name, phone or civil ID" autoComplete="off" aria-label="Find duplicate" value={mq} onChange={e => setMq(e.target.value)} />
                <div id="mList" className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">
                    {mList && (mList.length ? mList.map(m => (
                        <button key={m.id} type="button" data-merge={m.id} onClick={() => merge(m)} className="w-full flex items-center justify-between gap-3 bg-[#F8F8FA] hover:bg-[#FFF5F3] rounded-2xl px-4 py-3 text-left">
                            <span className="min-w-0 text-xs"><b>{m.name}</b> <span className="text-gray-400 font-mono">{m.customer_no}</span><span className="block text-gray-500">{[m.phone, m.civil_id].filter(Boolean).join(' · ')}</span></span>
                            <span className="pill-tag pill-gray">{`${m.stats?.shipments ?? 0} shipments`}</span></button>
                    )) : <p className="text-xs text-gray-400 text-center p-4">No other customer matches.</p>)}
                </div>
            </div>
        </Modal>
    </>;

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="user" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Customers</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Built from every booking • matched by phone or civil ID</p>
                        </div>
                    </div>
                </section>

                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                    <input id="search" className="field" placeholder="Search name, phone, civil ID or customer no." autoComplete="off" aria-label="Search customers" value={search} onChange={e => setSearch(e.target.value)} />
                    <div className="flex gap-1 bg-[#F8F8FA] p-1 rounded-full self-start">
                        <button type="button" className="opt px-3 py-2 rounded-full text-[11px] font-extrabold" data-filter="" aria-pressed={filter === ''} onClick={() => setFilter('')}>All</button>
                        <button type="button" className="opt px-3 py-2 rounded-full text-[11px] font-extrabold" data-filter="blocked" aria-pressed={filter === 'blocked'} onClick={() => setFilter('blocked')}>Blocked</button>
                    </div>
                </div>
                <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden">
                    <table className="rtable w-full text-xs">
                        <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                            <th className="p-3 pl-4 font-extrabold">Customer</th><th className="p-3 font-extrabold">Phone</th><th className="p-3 font-extrabold">Civil ID</th>
                            <th className="p-3 font-extrabold text-right">Shipments</th><th className="p-3 font-extrabold">Last shipment</th><th className="p-3 pr-4 font-extrabold text-right">Balance due</th>
                        </tr></thead>
                        <tbody id="rows" className="divide-y divide-gray-100">
                            {list.map(cu => (
                                <tr key={cu.id} className={`hover:bg-[#F8F8FA] cursor-pointer ${cu.blocked ? 'bg-[#FFF5F3]' : ''}`} data-c={cu.id} onClick={() => openProfile(cu.id)}>
                                    <td className="p-3 pl-4" data-label="Customer"><span className="font-extrabold">{cu.name}</span>{cu.blocked && <> <span className="pill-tag pill-coral">Blocked</span></>}{(cu.tags || []).map(t => <Fragment key={t}>{' '}<span className="pill-tag pill-gray">{t}</span></Fragment>)}<span className="block text-[10px] text-gray-400 font-mono">{cu.customer_no || ''}</span></td>
                                    <td className="p-3" data-label="Phone">{cu.phone || '—'}</td>
                                    <td className="p-3" data-label="Civil ID">{cu.civil_id || '—'}</td>
                                    <td className="p-3 text-right font-extrabold" data-label="Shipments">{cu.stats?.shipments ?? 0}<span className="block text-[10px] text-gray-400 font-medium">{`${Math.round(+(cu.stats?.kg || 0))} kg`}</span></td>
                                    <td className="p-3" data-label="Last shipment">{day(cu.stats?.last_shipment_at || cu.last_booking_at)}</td>
                                    <td className="p-3 pr-4 text-right" data-label="Balance due">{cu.balance.length ? cu.balance.map((b, i) => <span key={i} className="block font-extrabold text-[#D55C48] money">{money(b.currency, b.amount)}</span>) : '—'}</td>
                                </tr>
                            ))}
                            {loaded && !list.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">{search ? 'No customer matches.' : 'Customers appear here automatically as bookings are made.'}</td></tr>}
                        </tbody>
                    </table>
                </div>
                <div className="flex justify-center mt-4"><button id="more" type="button" className={`btn btn-light${more ? '' : ' hidden'}`} onClick={() => { page.current++; load(false); }}>Show more</button></div>
            </div>
        </AppFrame>
    );
}
