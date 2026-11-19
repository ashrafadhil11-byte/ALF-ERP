// Accounts — same page as admin/accounts.html: overview, invoices, receipts, expenses, cash closing, customer balances,
// pricing (rate cards, packages, extra charges, commodities), cost center, suppliers & agents, packing materials,
// inventory (stock, movements, warehouse requests, balances), purchases, reports, journal and chart of accounts.
// One shared form popup (#formModal) is filled by each action, like the old form(title, sub, body, save).
// Data: /api/accounts?view=… and POST /api/accounts { action }
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { CityField, CountryField } from '../components/fields/PlaceFields';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { markClean } from '../lib/guard';
import { toast } from '../lib/toast';
import './accounts.css';

const THREE = ['OMR', 'BHD', 'KWD', 'JOD', 'TND', 'LYD', 'IQD'];
const money = (cur: string | undefined | null, v: unknown) => `${cur ? cur + ' ' : ''}${(Number(v) || 0).toLocaleString('en', { minimumFractionDigits: THREE.includes(cur || '') ? 3 : 2, maximumFractionDigits: THREE.includes(cur || '') ? 3 : 2 })}`;
const fmt = (cur: string | undefined | null, v: unknown) => money(cur, v).replace(/^[A-Z]{3} /, '');
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', bank: 'Bank', payable: 'On account (payable)' };
const PRICE_LABEL: Record<string, string> = { per_kg: 'Per kg', per_box: 'Per box', box_size: 'By box size', per_cbm: 'Per CBM', doc_slab: 'Documents (slab)', vol_band: 'Weight band', per_package: 'Per package' };
const STATUS_PILL: Record<string, string> = { paid: 'pill-green', partial: 'pill-amber', unpaid: 'pill-coral', void: 'pill-gray' };
const TABS: [string, string, boolean?][] = [
    ['overview', 'Overview'], ['invoices', 'Invoices'], ['payments', 'Receipts'], ['expenses', 'Expenses'],
    ['cash', 'Cash closing'], ['balances', 'Customer balances'], ['pricing', 'Pricing'], ['costs', 'Cost center'], ['parties', 'Suppliers & agents'], ['materials', 'Packing materials'], ['inventory', 'Inventory'], ['purchases', 'Purchases'],
    ['reports', 'Reports', true], ['journal', 'Journal', true], ['chart', 'Chart of accounts', true]
];
const SERVICES = [['air', 'Air'], ['sea', 'Sea'], ['customs', 'Customs'], ['delivery', 'Delivery'], ['trucking', 'Trucking'], ['packing', 'Packing'], ['materials', 'Materials']];
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const val = (id: string) => $(id)?.value;
const rowsOf = (sel: string) => [...document.querySelectorAll(sel)].map(x => Object.fromEntries([...x.querySelectorAll<HTMLInputElement>('[data-k]')].map(i => [i.dataset.k!, i.value])));
const req = (t: string) => <>{t + ' '}<span className="req">*</span></>;
const field = (id: string, label: ReactNode, input: ReactNode) => <div><label className="ui-label" htmlFor={id}>{label}</label>{input}</div>;
const XBtn = ({ label, onClick }: { label: string; onClick: () => void }) => <button type="button" className="icon-btn self-center" onClick={onClick} aria-label={label}><Icon name="x" cls="w-3.5 h-3.5" /></button>;
const phones: Record<string, PhoneHandle | null> = {};
const phoneValue = (id: string) => phones[id]?.value ?? '';

// ---------- rows that can be added / removed (lines, bands, sizes…) ----------
function useRows<T>(initial: T[]) {
    const seq = useRef(initial.length);
    const [rows, setRows] = useState(() => initial.map((item, k) => ({ k, item })));
    return {
        rows,
        push: (item: T) => setRows(r => [...r, { k: ++seq.current, item }]),
        remove: (k: number) => setRows(r => r.filter(x => x.k !== k))
    };
}

function InvoiceLines() {
    const { rows, push, remove } = useRows<any>([{ description: 'Freight charges' }]);
    return <>
        <div id="iLines" className="space-y-2">{rows.map(({ k, item: l }) => (
            <div key={k} className="grid grid-cols-[110px_1fr_70px_110px_32px] gap-2" data-line="">
                <select className="field text-xs" data-k="kind" aria-label="Type" defaultValue={l.kind || 'charge'}>{[['freight', 'Freight'], ['package', 'Package'], ['charge', 'Charge']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                <input className="field" placeholder="Description" defaultValue={l.description || ''} data-k="description" aria-label="Description" />
                <input className="field" type="number" min="0" step="any" defaultValue={l.qty || 1} data-k="qty" aria-label="Qty" />
                <input className="field" type="number" min="0" step="0.001" defaultValue={l.rate || ''} placeholder="Rate" data-k="rate" aria-label="Rate" />
                <XBtn label="Remove line" onClick={() => remove(k)} /></div>))}</div>
        <button type="button" className="btn btn-light btn-sm mt-2" onClick={() => push({})}><Icon name="plus" />Add line</button>
    </>;
}

function JournalLines({ opts }: { opts: any[] }) {
    const { rows, push, remove } = useRows<object>([{}, {}]);
    const [diff, setDiff] = useState<{ text: string; cls: string }>({ text: '', cls: 'text-xs font-bold' });
    const calc = () => {
        let d = 0; document.querySelectorAll('#jLines [data-jl]').forEach(x => { d += (+(x.querySelector('[data-k=debit]') as HTMLInputElement).value || 0) - (+(x.querySelector('[data-k=credit]') as HTMLInputElement).value || 0); });
        setDiff({ text: Math.abs(d) < 0.0005 ? '✓ Balanced' : `Difference ${money('', d)}`, cls: `text-xs font-bold ${Math.abs(d) < 0.0005 ? 'text-emerald-600' : 'text-[#D55C48]'}` });
    };
    return <>
        <div id="jLines" className="space-y-2 mt-4" onInput={calc}>{rows.map(({ k }) => (
            <div key={k} className="grid grid-cols-[1fr_100px_100px_32px] gap-2" data-jl=""><select className="field text-xs" data-k="account" aria-label="Account">{opts.map(a => <option key={a.code} value={a.code}>{`${a.code} · ${a.name}`}</option>)}</select>
                <input className="field" type="number" min="0" step="0.001" placeholder="Debit" data-k="debit" aria-label="Debit" /><input className="field" type="number" min="0" step="0.001" placeholder="Credit" data-k="credit" aria-label="Credit" />
                <XBtn label="Remove" onClick={() => remove(k)} /></div>))}</div>
        <div className="flex justify-between items-center mt-2"><button type="button" className="btn btn-light btn-sm" onClick={() => push({})}><Icon name="plus" />Add line</button><span id="jDiff" className={diff.cls}>{diff.text}</span></div>
    </>;
}

function PurchaseRow({ products, onRemove }: { products: any[]; onRemove: () => void }) {
    const [hideDesc, setHideDesc] = useState(true);
    return <div className="grid grid-cols-[1fr_80px_100px_32px] gap-2" data-pl=""><select className="field text-xs" data-k="product_id" aria-label="Item" onChange={e => setHideDesc(Boolean(e.target.value))}>
        <option value="">Other / not a stock item</option>{products.map(p => <option key={p.id} value={p.id}>{`${p.name} (${p.unit}${p.track_stock ? '' : ', consumable'})`}</option>)}</select>
        <input className="field" type="number" min="0" step="any" placeholder="Qty" data-k="qty" aria-label="Qty" /><input className="field" type="number" min="0" step="0.0001" placeholder="Unit cost" data-k="unit_cost" aria-label="Unit cost" />
        <XBtn label="Remove" onClick={onRemove} />
        <input className={`field text-xs col-span-3${hideDesc ? ' hidden' : ''}`} placeholder="Description" data-k="description" aria-label="Description" /></div>;
}
function PurchaseLines({ d }: { d: any }) {
    const { rows, push, remove } = useRows<object>([{}]);
    const [total, setTotal] = useState('');
    const calc = () => { let t = 0; document.querySelectorAll('#puLines [data-pl]').forEach(x => { t += (+(x.querySelector('[data-k=qty]') as HTMLInputElement).value || 0) * (+(x.querySelector('[data-k=unit_cost]') as HTMLInputElement).value || 0); }); setTotal(`Total ${money(d.currency, t)}`); };
    const products = d.products.filter((p: any) => p.active);
    return <>
        <div id="puLines" className="space-y-2" onInput={calc}>{rows.map(({ k }) => <PurchaseRow key={k} products={products} onRemove={() => remove(k)} />)}</div>
        <div className="flex justify-between items-center mt-2"><button type="button" className="btn btn-light btn-sm" onClick={() => push({})}><Icon name="plus" />Add item</button><span id="puTotal" className="text-sm font-extrabold">{total}</span></div>
    </>;
}

function SaleLines({ d, sellable }: { d: any; sellable: any[] }) {
    const { rows, push, remove } = useRows<object>([{}]);
    const [total, setTotal] = useState(() => `Total ${money(d.currency, +sellable[0].sell_price)}`);
    const calc = () => { let t = 0; document.querySelectorAll('#saLines [data-sl]').forEach(x => { t += (+(x.querySelector('[data-k=qty]') as HTMLInputElement).value || 0) * (+(x.querySelector('[data-k=rate]') as HTMLInputElement).value || 0); }); setTotal(`Total ${money(d.currency, t)}`); };
    return <>
        <div id="saLines" className="space-y-2" onInput={calc} onChange={e => {
            const t = e.target as HTMLSelectElement;
            if (t.dataset.k === 'product_id') { (t.closest('[data-sl]')!.querySelector('[data-k=rate]') as HTMLInputElement).value = t.selectedOptions[0].dataset.price!; calc(); }
        }}>{rows.map(({ k }) => (
            <div key={k} className="grid grid-cols-[1fr_80px_100px_32px] gap-2" data-sl=""><select className="field text-xs" data-k="product_id" aria-label="Item">{sellable.map(p => <option key={p.id} value={p.id} data-price={p.sell_price}>{`${p.name}${p.track_stock ? ` · ${+p.qty} ${p.unit} left` : ''}`}</option>)}</select>
                <input className="field" type="number" min="0" step="any" defaultValue="1" data-k="qty" aria-label="Qty" /><input className="field" type="number" min="0" step="0.001" defaultValue={sellable[0].sell_price} data-k="rate" aria-label="Price" />
                <XBtn label="Remove" onClick={() => remove(k)} /></div>))}</div>
        <div className="flex justify-between items-center mt-2"><button type="button" className="btn btn-light btn-sm" onClick={() => push({})}><Icon name="plus" />Add item</button><span id="saTotal" className="text-sm font-extrabold">{total}</span></div>
    </>;
}

function RateBody({ r, d, id, full, branches, onMethod }: { r: any; d: any; id: any; full: boolean; branches: any[]; onMethod: (m: string) => void }) {
    const [method, setMethodS] = useState(r.method);
    const bands = useRows<any>(r.bands.length ? r.bands : [{}]);
    const sizes = useRows<any>(r.sizes?.length ? r.sizes : [{}]);
    const setMethod = (m: string) => {
        setMethodS(m); onMethod(m);
        const com = $('rCom') as unknown as HTMLSelectElement;
        if (m === 'doc_slab' && com && com.value === '*' && [...com.options].some(o => o.value === 'DOC')) com.value = 'DOC';
    };
    useEffect(() => { onMethod(r.method); /* eslint-disable-next-line */ }, []);
    const countries = (window.ALF_COUNTRIES || []).filter((c: any) => !d.destinations.some((x: any) => x.country_code === c.c));
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {full && field('xBranch', 'Branch', <select id="xBranch" className="field" disabled={!!id} defaultValue={r.branch_code}>{branches.map(b => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} · ${b.currency || ''}`}</option>)}</select>)}
        {field('rDest', 'Destination', <select id="rDest" className="field" defaultValue={r.dest_country_code}><option value="*">Any destination</option>{d.destinations.map((x: any) => <option key={x.country_code} value={x.country_code}>{`${x.country_name} (${x.country_code})`}</option>)}{countries.map((c: any) => <option key={c.c} value={c.c}>{`${c.n} (${c.c})`}</option>)}</select>)}
        {field('rCargo', 'Cargo type', <select id="rCargo" className="field" defaultValue={r.cargo_type_code}><option value="*">Any cargo</option>{d.cargo_types.map((c: any) => <option key={c.code} value={c.code}>{`${c.code} · ${c.name}`}</option>)}</select>)}
        {field('rCom', 'Contents', <select id="rCom" className="field" defaultValue={r.commodity}><option value="*">General (any contents)</option>{d.commodities.filter((c: any) => c.code !== 'GEN').map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>)}
        <div className="sm:col-span-2"><p className="ui-label">Pricing method</p><div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-[#F8F8FA] p-1.5 rounded-[1.25rem]">{Object.entries(PRICE_LABEL).map(([k, v]) => <button key={k} type="button" className="opt py-2 rounded-full text-[11px] font-extrabold" data-method={k} aria-pressed={k === method} onClick={() => setMethod(k)}>{v}</button>)}</div></div>
        <div data-for="simple" className={['vol_band', 'box_size', 'doc_slab'].includes(method) ? 'hidden' : ''}>{field('rRate', <span id="rRateLabel">{({ per_kg: 'Price per kg', per_package: 'Price per package', per_box: 'Price per box', per_cbm: 'Price per CBM (m³)' } as Record<string, string>)[method] || 'Rate'}</span>, <input id="rRate" type="number" min="0" step="0.001" className="field" defaultValue={r.rate ?? ''} />)}</div>
        {field('rMin', 'Minimum charge', <input id="rMin" type="number" min="0" step="0.001" className="field" defaultValue={r.min_charge ?? ''} />)}
        <div data-for="vol_band" className={`sm:col-span-2${method !== 'vol_band' ? ' hidden' : ''}`}><p className="ui-label">Weight bands (chargeable kg)</p><div id="rBands" className="space-y-2">{bands.rows.map(({ k, item: b }) => (
            <div key={k} className="grid grid-cols-[1fr_1fr_32px] gap-2" data-band=""><input className="field" type="number" min="0" step="any" placeholder="Up to kg" defaultValue={b.upto ?? ''} data-k="upto" aria-label="Up to kg" /><input className="field" type="number" min="0" step="0.001" placeholder="Price" defaultValue={b.price ?? ''} data-k="price" aria-label="Price" /><XBtn label="Remove band" onClick={() => bands.remove(k)} /></div>))}</div>
            <button type="button" className="btn btn-light btn-sm mt-2" onClick={() => bands.push({})}><Icon name="plus" />Add band</button>
            <div className="mt-3 max-w-xs">{field('rExtra', 'Each kg above the last band', <input id="rExtra" type="number" min="0" step="0.001" className="field" defaultValue={r.extra_per_kg ?? ''} />)}</div></div>
        <div data-for="doc_slab" className={`sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3${method !== 'doc_slab' ? ' hidden' : ''}`}>
            {field('sBaseKg', 'First slab (kg)', <input id="sBaseKg" type="number" min="0" step="any" className="field" defaultValue={r.slab?.base_kg ?? 0.5} />)}
            {field('sBase', 'Price of first slab', <input id="sBase" type="number" min="0" step="0.001" className="field" defaultValue={r.slab?.base_price ?? ''} />)}
            {field('sStepKg', 'Each extra (kg)', <input id="sStepKg" type="number" min="0" step="any" className="field" defaultValue={r.slab?.step_kg ?? 0.5} />)}
            {field('sStep', 'Price per extra step', <input id="sStep" type="number" min="0" step="0.001" className="field" defaultValue={r.slab?.step_price ?? ''} />)}
            <p className="col-span-full text-[11px] text-gray-400">Actual weight only (no volumetric). E.g. first 0.5 kg = 5.000, each extra 0.5 kg = 2.000 → 1.2 kg = 5 + 2 × 2 = 9.000. For one price per envelope, set a large first slab and no extra price.</p></div>
        <div data-for="box_size" className={`sm:col-span-2${method !== 'box_size' ? ' hidden' : ''}`}><p className="ui-label">Box sizes (cm) — each box is charged at the smallest size it fits</p><div id="rSizes" className="space-y-2">{sizes.rows.map(({ k, item: z }) => (
            <div key={k} className="grid grid-cols-[1fr_64px_64px_64px_90px_32px] gap-2" data-size="">{([['name', 'Name', 'text'], ['l', 'L', 'number'], ['w', 'W', 'number'], ['h', 'H', 'number'], ['price', 'Price', 'number']] as const).map(([fk, ph, t]) => <input key={fk} className="field !px-2" type={t} min="0" step="any" placeholder={ph} defaultValue={z[fk] ?? ''} data-k={fk} aria-label={ph} />)}<XBtn label="Remove size" onClick={() => sizes.remove(k)} /></div>))}</div>
            <button type="button" className="btn btn-light btn-sm mt-2" onClick={() => sizes.push({})}><Icon name="plus" />Add size</button></div>
        <div className="sm:col-span-2">{field('rNote', 'Note', <input id="rNote" className="field" defaultValue={r.note || ''} />)}</div>
        <label className="flex items-center gap-2 text-xs font-bold"><input id="rActive" type="checkbox" className="w-4 h-4" defaultChecked={r.active} />Active</label></div>;
}

function ProductBody({ p, currency, onTrack }: { p: any; currency: string; onTrack: (v: boolean) => void }) {
    const [track, setTrackS] = useState(p.track_stock !== false);
    const setTrack = (v: boolean) => { setTrackS(v); onTrack(v); };
    useEffect(() => { onTrack(p.track_stock !== false); /* eslint-disable-next-line */ }, []);
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('prSku', req('Item code'), <input id="prSku" className="field font-mono uppercase" required defaultValue={p.sku || ''} placeholder="CTN-L" />)}
        {field('prName', req('Name'), <input id="prName" className="field" required defaultValue={p.name || ''} placeholder="Carton box — large" />)}
        {field('prUnit', 'Unit', <select id="prUnit" className="field" defaultValue={p.unit}>{['pcs', 'roll', 'm', 'kg', 'box', 'set'].map(u => <option key={u}>{u}</option>)}</select>)}
        {field('prPrice', `Sell price (${currency})`, <input id="prPrice" type="number" min="0" step="0.001" className="field" defaultValue={+p.sell_price || ''} placeholder="0 = not sold" />)}
        <div className="sm:col-span-2"><p className="ui-label">Stock</p><div className="grid grid-cols-2 gap-1.5 bg-[#F8F8FA] p-1.5 rounded-full">
            <button type="button" className="opt py-2 rounded-full text-[11px] font-extrabold" data-track="1" aria-pressed={track} onClick={() => setTrack(true)}>{'Counted (cartons…)'}</button>
            <button type="button" className="opt py-2 rounded-full text-[11px] font-extrabold" data-track="0" aria-pressed={!track} onClick={() => setTrack(false)}>{'Consumable (tape, bubble…)'}</button></div></div>
        <div data-for-track="" className={track ? '' : 'hidden'}>{field('prReorder', 'Reorder when stock falls to', <input id="prReorder" type="number" min="0" step="any" className="field" defaultValue={+p.reorder_level || ''} />)}</div>
        <label className="flex items-center gap-2 text-xs font-bold"><input id="prActive" type="checkbox" className="w-4 h-4" defaultChecked={p.active} />Active</label></div>;
}

function SupplierBody({ s }: { s: any }) {
    const [country, setCountry] = useState(s.country || '');
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('suName', req('Name'), <input id="suName" className="field" required defaultValue={s.name || ''} />)}
        {field('suKind', 'Type', <select id="suKind" className="field" defaultValue={s.kind}>{[['supplier', 'Supplier'], ['agent', 'Agent (airline, shipping line, customs, delivery)'], ['both', 'Both']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
        {field('suContact', 'Contact person', <input id="suContact" className="field" defaultValue={s.contact_person || ''} />)}
        {field('suPhone', 'Phone', <PhoneField ref={h => { phones.suPhone = h; }} country="OM" defaultValue={s.phone || ''} inputProps={{ id: 'suPhone', className: 'field' }} />)}
        {field('suEmail', 'Email', <input id="suEmail" type="email" className="field" defaultValue={s.email || ''} />)}
        {field('suCountry', 'Country', <CountryField defaultValue={s.country || ''} onChange={n => setCountry(n)} inputProps={{ id: 'suCountry', className: 'field', placeholder: 'Select country', onInput: e => setCountry((e.target as HTMLInputElement).value) }} />)}
        {field('suCity', 'City', <CityField country={country} defaultValue={s.city || ''} inputProps={{ id: 'suCity', className: 'field', placeholder: 'Select or type city' }} />)}
        <div>{field('suAddr', 'Address', <input id="suAddr" className="field" defaultValue={s.address || ''} />)}</div>
        {field('suTax', 'Tax / VAT no.', <input id="suTax" className="field" defaultValue={s.tax_no || ''} />)}
        {field('suTerms', 'Payment terms (days, 0 = cash)', <input id="suTerms" type="number" min="0" max="365" className="field" defaultValue={s.payment_terms_days || 0} />)}
        <div className="sm:col-span-2"><p className="ui-label">Services</p><div className="flex flex-wrap gap-2">{SERVICES.map(([k, l]) => <label key={k} className="flex items-center gap-2 bg-[#F8F8FA] rounded-xl px-3 py-2 text-xs font-bold cursor-pointer"><input type="checkbox" className="w-4 h-4" data-svc={k} defaultChecked={(s.services || []).includes(k)} />{l}</label>)}</div></div>
        <div className="sm:col-span-2">{field('suNotes', 'Notes', <input id="suNotes" className="field" defaultValue={s.notes || ''} />)}</div>
        <label className="flex items-center gap-2 text-xs font-bold"><input id="suActive" type="checkbox" className="w-4 h-4" defaultChecked={s.active} />Active</label></div>;
}

function CostBody({ d, branchSel }: { d: any; branchSel: ReactNode }) {
    const [forC, setForC] = useState('');
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{branchSel}
        {field('cFor', 'For', <select id="cFor" className="field" value={forC} onChange={e => setForC(e.target.value)}><option value="">{'One shipment (enter AWB) …'}</option>{d.consolidations.map((c: any) => <option key={c.id} value={c.id}>{`${c.kind.toUpperCase()} ${c.mawb}${c.closed ? ' (closed)' : ''}`}</option>)}</select>)}
        <div id="cAwbWrap" className={forC ? 'hidden' : ''}>{field('cAwb', 'Shipment AWB', <input id="cAwb" className="field font-mono uppercase" />)}</div>
        {field('cType', 'Cost', <select id="cType" className="field"><option value="freight">Freight (airline / shipping line)</option><option value="customs">{'Customs & clearance'}</option><option value="trucking">Trucking / transport</option><option value="handling">Handling / terminal</option><option value="other">Other</option></select>)}
        {field('cParty', 'Agent / supplier', <select id="cParty" className="field"><option value="">— none —</option>{d.parties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
        {field('cAmt', req('Amount'), <input id="cAmt" type="number" min="0" step="0.001" className="field" required />)}
        {field('cPay', 'Paid by', <select id="cPay" className="field"><option value="credit">On credit (pay later)</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="card">Card</option></select>)}
        {field('cRef', 'Their bill no.', <input id="cRef" className="field" />)}{field('cDate2', 'Date', <input id="cDate2" type="date" className="field" defaultValue={iso(new Date())} />)}
        <div className="sm:col-span-2">{field('cDesc', 'Note', <input id="cDesc" className="field" />)}</div></div>;
}

function RequestBody({ d, full, branches }: { d: any; full: boolean; branches: any[] }) {
    const wh = d.warehouses;
    const [w, setW] = useState(wh[0]?.branch_code);
    const stock = d.warehouse_stock.filter((s: any) => s.branch_code === w);
    return <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{full && field('rqBranch', 'For branch', <select id="rqBranch" className="field">{branches.filter(b => !wh.some((x: any) => x.branch_code === b.branch_code)).map(b => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}</select>)}
            {field('rqWh', 'Warehouse', <select id="rqWh" className="field" value={w} onChange={e => setW(e.target.value)}>{wh.map((x: any) => <option key={x.branch_code} value={x.branch_code}>{x.branch_name}</option>)}</select>)}</div>
        <div id="rqLines" key={w} className="space-y-2 mt-4">{stock.length ? stock.map((s: any) => (
            <div key={s.product_id} className="grid grid-cols-[1fr_110px] gap-2 items-center" data-rq={s.product_id}><span className="text-xs font-bold">{`${s.products.name} `}<span className="text-gray-400 font-medium">{`· ${+s.qty} ${s.products.unit} in warehouse${+s.sell_price ? ` · ${(+s.sell_price).toFixed(3)} each` : ''}`}</span></span><input className="field" type="number" min="0" step="any" placeholder="Qty" aria-label="Quantity" /></div>
        )) : <p className="text-xs text-gray-400">The warehouse has no counted items yet.</p>}</div>
        <div className="mt-4">{field('rqNotes', 'Notes', <input id="rqNotes" className="field" placeholder="e.g. needed by Thursday" />)}</div>
    </>;
}

function FormClose({ text }: { text?: string }) {
    const dismiss = useDismiss();
    return text ? <button type="button" className="btn btn-light" onClick={dismiss}>{text}</button>
        : <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>;
}

type FormSpec = { title: string; sub: string; body: ReactNode; okText: string; extra: ReactNode; hasSave: boolean; n: number };

export function Accounts() {
    const [ctx, setCtx] = useState<any>({ full: false, branches: [], my_branch: null, loaded: false });
    const ctxRef = useRef(ctx); ctxRef.current = ctx;
    const [tab, setTabS] = useState(() => new URLSearchParams(location.search).get('tab') || 'overview');
    const tabRef = useRef(tab); tabRef.current = tab;
    const [range, setRangeS] = useState('month');
    const [dates, setDates] = useState({ from: '', to: '', branch: '' });
    const F = useRef(dates); F.current = dates;
    const cache = useRef<any>({});
    const [view, setView] = useState<{ kind: 'none' } | { kind: 'loading' } | { kind: 'ok'; tab: string; d: any; n: number } | { kind: 'error'; msg: string; n: number; init?: boolean }>({ kind: 'none' });
    const seq = useRef(0);

    const setRange = (r: string) => {
        const t = iso(new Date());
        const next = { ...F.current, to: t, from: r === 'today' ? t : r === 'year' ? `${t.slice(0, 4)}-01-01` : `${t.slice(0, 8)}01` };
        F.current = next; setDates(next); setRangeS(r);
    };
    const qs = (extra: Record<string, string> = {}) => new URLSearchParams({ from: F.current.from, to: F.current.to, ...(ctxRef.current.full && F.current.branch ? { branch: F.current.branch } : {}), ...extra }).toString();
    const curBranch = () => (ctxRef.current.full ? F.current.branch : ctxRef.current.my_branch) || '';
    const needBranch = () => { if (!curBranch()) { toast(false, 'Choose a branch first (top right).'); return false; } return true; };

    // ---------- views: load the data, then draw it ----------
    const LOAD: Record<string, () => Promise<any>> = {
        overview: () => api(`/api/accounts?view=overview&${qs()}`),
        invoices: () => api(`/api/accounts?view=invoices&${qs({ status: cache.current.invStatus || 'open', q: cache.current.invQ || '' })}`),
        payments: () => api(`/api/accounts?view=payments&${qs()}`),
        expenses: async () => { const d = await api(`/api/accounts?view=expenses&${qs()}`); cache.current.categories = d.categories; return d; },
        cash: async () => {
            if (!curBranch()) return { none: true };
            const date = cache.current.cashDate || F.current.to;
            return { ...(await api(`/api/accounts?view=cash&branch=${encodeURIComponent(curBranch())}&date=${date}`)), date };
        },
        balances: () => api(`/api/accounts?view=balances&${qs()}`),
        pricing: async () => { const d = await api(`/api/accounts?view=pricing&${qs()}`); cache.current.rates = d; return d; },
        materials: async () => {
            if (!curBranch()) return { none: true };
            const d = await api(`/api/accounts?view=materials&branch=${encodeURIComponent(curBranch())}`); cache.current.materials = d; return d;
        },
        purchases: async () => { const d = await api(`/api/accounts?view=purchases&${qs()}`); cache.current.suppliers = d.suppliers; return d; },
        parties: async () => { const d = await api(`/api/accounts?view=parties&${qs()}`); cache.current.suppliers = d.parties; return d; },
        costs: async () => {
            if ((cache.current.costSub || 'bills') === 'profit') return { profit: await api(`/api/accounts?view=profit&${qs()}`) };
            const d = await api(`/api/accounts?view=costs&${qs()}`); cache.current.costs = d; return { bills: d };
        },
        inventory: async () => {
            const sub = cache.current.invSub || 'stock';
            if (sub === 'stock' || sub === 'moves') return api(`/api/accounts?view=inventory&${qs(cache.current.invProduct ? { product: cache.current.invProduct } : {})}`);
            if (sub === 'requests') { const d = await api('/api/accounts?view=requests'); cache.current.requests = d; return d; }
            const d = await api('/api/accounts?view=internal'); cache.current.internal = d; return d;
        },
        reports: () => api(`/api/accounts?view=ledger&${qs()}`),
        journal: async () => { const d = await api(`/api/accounts?view=journal&${qs(cache.current.jAcct ? { account: cache.current.jAcct } : {})}`); cache.current.accounts = d.accounts; return d; },
        chart: async () => { const d = await api(`/api/accounts?view=journal&${qs({ from: '1900-01-01' })}`).catch(() => ({ accounts: [] })); cache.current.accounts = d.accounts; return d; }
    };
    async function show(loading = true) {
        const n = ++seq.current, t = LOAD[tabRef.current] ? tabRef.current : 'overview';
        if (loading) setView({ kind: 'loading' });
        try { const d = await LOAD[t](); if (n === seq.current) setView({ kind: 'ok', tab: t, d, n }); }
        catch (e) { if (n === seq.current) setView({ kind: 'error', msg: (e as Error).message, n }); }
        return n;
    }
    const setTab = (t: string) => { tabRef.current = t; setTabS(t); history.replaceState(null, '', `?tab=${t}`); show(); };
    const setCache = (k: string, v: any) => { cache.current[k] = v; return show(); };

    // ---------- start ----------
    useEffect(() => {
        (async () => {
            setRange('month');
            let d: any;
            try { d = await api(`/api/accounts?view=overview&${qs()}`); }
            catch (e) { return setView({ kind: 'error', msg: (e as Error).message, n: 0, init: true }); }
            const c = { full: d.full, branches: d.branches, my_branch: d.my_branch, role: d.role, loaded: true };
            ctxRef.current = c; setCtx(c);
            if (!TABS.some(([k, , f]) => k === tabRef.current && (!f || c.full))) { tabRef.current = 'overview'; setTabS('overview'); }
            show();
        })();
        // eslint-disable-next-line
    }, []);

    // ---------- the shared form popup ----------
    const [formOpen, setFormOpen] = useState(false);
    const [spec, setSpec] = useState<FormSpec>({ title: '', sub: '', body: null, okText: 'Save', extra: null, hasSave: true, n: 0 });
    const [okClass, setOkClass] = useState('btn btn-dark');   // like the old page, a Void form leaves the button coral
    const [saving, setSaving] = useState(false);
    const onSave = useRef<null | (() => Promise<unknown>)>(null);
    function form(title: string, sub: string, body: ReactNode, save: null | (() => Promise<unknown>), okText = 'Save', extra: ReactNode = null) {
        onSave.current = save;
        setSpec(s => ({ title, sub: sub || '', body, okText, extra, hasSave: !!save, n: s.n + 1 }));
        markClean(document.getElementById('formModal'));
        setFormOpen(true);
    }
    const submitForm = async (e: React.FormEvent) => {
        e.preventDefault(); if (!onSave.current) return;
        setSaving(true);
        try { if (await onSave.current() !== false) { setFormOpen(false); show(); } } catch (err) { toast(false, (err as Error).message); }
        setSaving(false);
    };
    const branchSelect = () => ctxRef.current.full ? field('xBranch', req('Branch'), <select id="xBranch" className="field" defaultValue={curBranch()}>{ctxRef.current.branches.map((b: any) => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} · ${b.currency || ''}`}</option>)}</select>) : null;
    const xb = () => ctxRef.current.full ? val('xBranch') : ctxRef.current.my_branch;
    const branchPick = (id: string, sel: string | undefined, disabled: boolean) => ctxRef.current.full ? field(id, 'Branch', <select id={id} className="field" disabled={disabled} defaultValue={sel || curBranch()}>{ctxRef.current.branches.map((b: any) => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} · ${b.currency || ''}`}</option>)}</select>) : null;
    const pickedBranch = (id: string) => ctxRef.current.full ? val(id) : ctxRef.current.my_branch;
    const destOptions = (d: any) => <><option value="*">Any destination</option>{d.destinations.map((x: any) => <option key={x.country_code} value={x.country_code}>{`${x.country_name} (${x.country_code})`}</option>)}
        {(window.ALF_COUNTRIES || []).filter((c: any) => !d.destinations.some((x: any) => x.country_code === c.c)).map((c: any) => <option key={c.c} value={c.c}>{`${c.n} (${c.c})`}</option>)}</>;
    const post = (body: any) => api('/api/accounts', { method: 'POST', body });

    // ---------- actions ----------
    const newInvoice = () => {
        if (!ctxRef.current.full && !ctxRef.current.my_branch) return toast(false, 'No branch on your account.');
        form('New invoice', 'For extra charges or customers without a booking. Bookings are invoiced automatically.', <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{branchSelect()}
                {field('iName', 'Customer', <input id="iName" className="field" />)}{field('iPhone', 'Phone', <PhoneField ref={h => { phones.iPhone = h; }} country="OM" inputProps={{ id: 'iPhone', className: 'field', placeholder: 'Mobile number' }} />)}
                {field('iAwb', 'AWB (optional)', <input id="iAwb" className="field font-mono" />)}
                {field('iPay', 'Payment', <select id="iPay" className="field"><option value="cash">Paid now — cash</option><option value="card">Paid now — card</option><option value="bank">Paid now — bank transfer</option><option value="credit">Credit (pay later)</option></select>)}
            </div>
            <p className="sd-label mt-5 mb-2">Lines</p><InvoiceLines /></>,
        async () => {
            const lines = rowsOf('#iLines [data-line]');
            const r = await post({ action: 'invoice', branch: xb(), customer_name: val('iName'), customer_phone: phoneValue('iPhone'), awb: val('iAwb'), pay_method: val('iPay'), lines });
            toast(true, `${r.invoice_no} created${r.payment ? ' and paid (' + r.payment.receipt_no + ')' : ''}.`);
            setTimeout(() => openInvoice(r.id), 300);
        }, 'Create invoice');
    };
    const newExpense = async () => {
        if (!cache.current.categories) cache.current.categories = (await api(`/api/accounts?view=expenses&${qs()}`)).categories;
        form('Add expense', 'Posted to the ledger straight away.',
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{branchSelect()}
                {field('eCat', req('Category'), <select id="eCat" className="field">{cache.current.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>)}
                {field('eAmt', req('Amount'), <input id="eAmt" type="number" min="0" step="0.001" className="field" required />)}
                {field('eMethod', 'Paid by', <select id="eMethod" className="field">{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>)}
                {field('eDate', 'Date', <input id="eDate" type="date" className="field" defaultValue={iso(new Date())} />)}
                {field('eTo', 'Paid to', <input id="eTo" className="field" placeholder="e.g. Shell, landlord" />)}
                {field('eRef', 'Bill / reference no.', <input id="eRef" className="field" />)}
                <div className="sm:col-span-2">{field('eNotes', 'Notes', <input id="eNotes" className="field" />)}</div></div>,
            async () => {
                const r = await post({ action: 'expense', branch: xb(), account_code: val('eCat'), amount: val('eAmt'), method: val('eMethod'), date: val('eDate'), paid_to: val('eTo'), reference: val('eRef'), notes: val('eNotes') });
                toast(true, `${r.expense_no} saved.`);
            });
    };
    const voidDoc = (action: string, id: any, no: string) => {
        form(`Void ${no}?`, 'The ledger entry is reversed. This cannot be undone.', field('vReason', req('Reason'), <input id="vReason" className="field" required placeholder="e.g. entered twice" />),
            async () => { await post({ action, id, reason: val('vReason') }); toast(true, `${no} voided.`); }, 'Void');
        setOkClass('btn btn-coral');
        setTimeout(() => $('vReason')?.focus(), 50);
    };
    async function openInvoice(id: any) {
        const { invoice: i, payments, branch } = await api(`/api/accounts?view=invoice&id=${id}`);
        cache.current.invoice = { i, payments, branch };
        const KT: Record<string, string> = { package: 'Package', charge: 'Charge', material: 'Material' };
        const open = ['unpaid', 'partial'].includes(i.status);
        const waText = `Al-Farha Cargo invoice ${i.invoice_no}${i.awb ? ' (' + i.awb + ')' : ''}: ${money(i.currency, i.total)}. Balance due: ${money(i.currency, i.balance)}. Thank you.`;
        form(i.invoice_no, `${day(i.issued_at)} · ${i.branch_code}${i.awb ? ' · ' + i.awb : ''}`, <>
            <div className="flex flex-wrap justify-between gap-3 mb-4"><div><p className="sd-label">Bill to</p><p className="font-extrabold">{i.customer_name || '—'}</p><p className="text-xs text-gray-500">{i.customer_phone || ''}</p></div>
                <div className="text-right"><span className={`pill-tag ${STATUS_PILL[i.status]}`}>{i.status}</span>{i.due_date && <p className="text-[11px] text-gray-500 mt-1">{`Due ${day(i.due_date)}`}</p>}{i.void_reason && <p className="text-[11px] text-gray-500 mt-1">{i.void_reason}</p>}</div></div>
            <table className="w-full text-xs"><thead><tr className="sd-label text-left border-b border-gray-100"><th className="py-1.5">Description</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead><tbody>
                {i.lines.map((l: any, n: number) => <tr key={n}><td className="py-1.5">{KT[l.kind] && <span className="pill-tag pill-gray mr-1">{KT[l.kind]}</span>}{l.description}</td><td className="text-right">{l.qty}</td><td className="text-right money">{fmt(i.currency, l.rate)}</td><td className="text-right money">{fmt(i.currency, l.amount)}</td></tr>)}</tbody></table>
            <div className="mt-3 ml-auto max-w-xs text-xs space-y-1">
                <div className="flex justify-between"><span>Subtotal</span><span className="money">{fmt(i.currency, i.subtotal)}</span></div>
                {+i.tax > 0 && <div className="flex justify-between"><span>{`Tax ${i.tax_rate}%`}</span><span className="money">{fmt(i.currency, i.tax)}</span></div>}
                <div className="flex justify-between font-extrabold text-sm border-t border-gray-200 pt-1"><span>Total</span><span className="money">{money(i.currency, i.total)}</span></div>
                <div className="flex justify-between"><span>Paid</span><span className="money">{fmt(i.currency, i.paid)}</span></div>
                <div className={`flex justify-between font-extrabold ${+i.balance ? 'text-[#D55C48]' : ''}`}><span>Balance due</span><span className="money">{money(i.currency, i.balance)}</span></div></div>
            {payments.length > 0 && <><p className="sd-label mt-4 mb-1">Receipts</p><div className="space-y-1">{payments.map((p: any, n: number) => <div key={n} className={`flex justify-between text-xs ${p.void ? 'line-through opacity-50' : ''}`}><span>{`${p.receipt_no} · ${METHOD_LABEL[p.method]} · ${day(p.received_at)}`}</span><span className="money">{fmt(i.currency, p.amount)}</span></div>)}</div></>}
            {open && <div className="bg-[#F8F8FA] rounded-2xl p-4 mt-4 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <div className="sm:col-span-1">{field('pAmt', 'Amount', <input id="pAmt" type="number" step="0.001" min="0" className="field" defaultValue={i.balance} />)}</div>
                <div>{field('pMethod', 'Method', <select id="pMethod" className="field"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option></select>)}</div>
                <div>{field('pRef', 'Reference', <input id="pRef" className="field" placeholder="Optional" />)}</div>
                <button type="button" className="btn btn-dark" onClick={() => takePayment(i.id)}><Icon name="cash" />Receive</button></div>}</>,
            null, '', <>
                <button type="button" className="btn btn-light" onClick={printInvoice}><Icon name="clipboard" />Print</button>
                {i.customer_phone && <a className="btn btn-light" target="_blank" rel="noopener" href={`https://wa.me/${String(i.customer_phone).replace(/\D/g, '')}?text=${encodeURIComponent(waText)}`}><Icon name="message" />WhatsApp</a>}
                {i.status !== 'void' && !payments.some((p: any) => !p.void) && <button type="button" className="btn btn-danger" onClick={() => voidDoc('invoice_void', i.id, i.invoice_no)}>Void</button>}</>);
    }
    const openInvoiceSafe = (id: any) => openInvoice(id).catch(err => toast(false, err.message));
    const takePayment = async (id: any) => {
        try {
            const r = await post({ action: 'payment', invoice_id: id, amount: val('pAmt'), method: val('pMethod'), reference: val('pRef') });
            toast(true, `${r.receipt_no}: ${money(r.currency, r.amount)} received.`);
            await openInvoice(id); if (tabRef.current !== 'overview') show(false);
        } catch (e) { toast(false, (e as Error).message); }
    };
    const printInvoice = () => {
        const { i, payments, branch } = cache.current.invoice;
        const w = window.open('', '_blank'); if (!w) return toast(false, 'Allow pop-ups to print.');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(i.invoice_no)}</title><style>
                body{font-family:Arial,sans-serif;margin:36px;color:#111;font-size:13px}h1{margin:0;font-size:22px}.muted{color:#666}table{width:100%;border-collapse:collapse;margin-top:18px}
                th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f4f4f4;font-size:11px;text-transform:uppercase}.r{text-align:right}.tot td{border:0;padding:4px 8px}.big td{font-weight:bold;font-size:15px;border-top:2px solid #111}
                .stamp{display:inline-block;border:2px solid ${i.status === 'paid' ? '#047857' : '#D55C48'};color:${i.status === 'paid' ? '#047857' : '#D55C48'};padding:4px 12px;border-radius:6px;font-weight:bold;text-transform:uppercase}</style></head><body>
                <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>Al-Farha Cargo</h1><div class="muted">${esc(branch?.branch_name || i.branch_code)}<br>${esc(branch?.address || '')}<br>${esc(branch?.phone_number || '')}</div></div>
                <div style="text-align:right"><h1>INVOICE</h1><div><b>${esc(i.invoice_no)}</b></div><div class="muted">${esc(day(i.issued_at))}${i.due_date ? '<br>Due ' + esc(day(i.due_date)) : ''}</div><div style="margin-top:8px"><span class="stamp">${esc(i.status)}</span></div></div></div>
                <p style="margin-top:22px"><b>Bill to:</b> ${esc(i.customer_name || '')} ${esc(i.customer_phone || '')}${i.awb ? `<br><b>AWB:</b> ${esc(i.awb)}` : ''}</p>
                <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
                ${i.lines.map((l: any) => `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${fmt(i.currency, l.rate)}</td><td class="r">${fmt(i.currency, l.amount)}</td></tr>`).join('')}</tbody></table>
                <table style="width:300px;margin-left:auto" class="tot"><tr><td>Subtotal</td><td class="r">${fmt(i.currency, i.subtotal)}</td></tr>${+i.tax ? `<tr><td>Tax ${i.tax_rate}%</td><td class="r">${fmt(i.currency, i.tax)}</td></tr>` : ''}
                <tr class="big"><td>Total</td><td class="r">${money(i.currency, i.total)}</td></tr><tr><td>Paid</td><td class="r">${fmt(i.currency, i.paid)}</td></tr><tr><td><b>Balance due</b></td><td class="r"><b>${money(i.currency, i.balance)}</b></td></tr></table>
                ${payments.filter((p: any) => !p.void).length ? `<p class="muted">Receipts: ${payments.filter((p: any) => !p.void).map((p: any) => `${esc(p.receipt_no)} (${METHOD_LABEL[p.method]}, ${fmt(i.currency, p.amount)})`).join(', ')}</p>` : ''}
                <p class="muted" style="margin-top:40px">Thank you for shipping with Al-Farha Cargo.</p></body></html>`);
        w.document.close(); w.onload = () => setTimeout(() => w.print(), 300);
    };

    const editRate = (id?: any) => {
        const d = cache.current.rates, r = (id && d.cards.find((x: any) => String(x.id) === String(id))) || { method: 'per_kg', dest_country_code: '*', cargo_type_code: '*', commodity: '*', bands: [], sizes: [], slab: {}, active: true, branch_code: curBranch() };
        form(id ? 'Edit rate card' : 'New rate card', 'Prices are in the branch currency.',
            <RateBody r={r} d={d} id={id} full={ctxRef.current.full} branches={ctxRef.current.branches} onMethod={m => { cache.current.rateMethod = m; }} />,
            async () => {
                const bands = rowsOf('#rBands [data-band]'), sizes = rowsOf('#rSizes [data-size]');
                await post({ action: 'rate_save', id: id || null, branch_code: ctxRef.current.full ? val('xBranch') : ctxRef.current.my_branch, dest_country_code: val('rDest'), cargo_type_code: val('rCargo'), commodity: val('rCom'), sizes, slab: { base_kg: val('sBaseKg'), base_price: val('sBase'), step_kg: val('sStepKg'), step_price: val('sStep') }, method: cache.current.rateMethod, rate: val('rRate'), min_charge: val('rMin'), bands, extra_per_kg: val('rExtra'), note: val('rNote'), active: $('rActive').checked });
                toast(true, 'Rate card saved.');
            }, 'Save', id ? <button type="button" className="btn btn-danger" onClick={() => deleteRate(id)}>Delete</button> : null);
    };
    const deleteRate = async (id: any) => {
        if (!await confirm({ title: 'Delete this rate card?', message: 'Bookings already made keep their charge.', confirmText: 'Delete', danger: true })) return;
        try { await post({ action: 'rate_delete', id }); setFormOpen(false); toast(true, 'Deleted.'); show(); } catch (e) { toast(false, (e as Error).message); }
    };
    const editAccount = (code?: string) => {
        const a = (code && cache.current.accounts.find((x: any) => x.code === code)) || { type: 'expense', active: true };
        form(code ? `Account ${code}` : 'New account', 'Used by expenses, journals and reports.',
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{field('aCode', 'Code (4 digits)', <input id="aCode" className="field font-mono" defaultValue={a.code || ''} readOnly={!!code} pattern="\d{4}" required />)}
                {field('aType', 'Type', <select id="aType" className="field" disabled={!!code} defaultValue={a.type}>{['asset', 'liability', 'equity', 'income', 'expense'].map(t => <option key={t}>{t}</option>)}</select>)}
                <div className="sm:col-span-2">{field('aName', 'Name', <input id="aName" className="field" defaultValue={a.name || ''} required />)}</div>
                <label className="flex items-center gap-2 text-xs font-bold"><input id="aActive" type="checkbox" className="w-4 h-4" defaultChecked={a.active} />Active</label></div>,
            async () => { await post({ action: 'account_save', code: val('aCode'), type: val('aType'), name: val('aName'), active: $('aActive').checked }); toast(true, 'Account saved.'); });
    };
    const newJournal = () => {
        const opts = cache.current.accounts.filter((a: any) => a.active);
        form('Manual journal', 'Debits must equal credits. Use for opening balances, owner cash in/out, corrections.', <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{branchSelect()}{field('jDate', 'Date', <input id="jDate" type="date" className="field" defaultValue={iso(new Date())} />)}
                <div className="sm:col-span-3">{field('jMemo', 'Memo', <input id="jMemo" className="field" required />)}</div></div>
            <JournalLines opts={opts} /></>,
        async () => {
            const lines = rowsOf('#jLines [data-jl]');
            const br = ctxRef.current.branches.find((b: any) => b.branch_code === xb());
            await post({ action: 'journal', branch: xb(), currency: br?.currency, date: val('jDate'), memo: val('jMemo'), lines });
            toast(true, 'Journal posted.');
        }, 'Post');
    };
    const delBtn = (action: string, id: any) => <button type="button" className="btn btn-danger" onClick={() => delPricing(action, id)}>Delete</button>;
    const delPricing = async (action: string, id: any) => {
        if (!await confirm({ title: 'Delete this?', message: 'Bookings already made keep their charges.', confirmText: 'Delete', danger: true })) return;
        try { await post({ action, id }); setFormOpen(false); toast(true, 'Deleted.'); show(); } catch (e) { toast(false, (e as Error).message); }
    };
    const editPackage = (id?: any) => {
        const d = cache.current.rates, p = (id && d.packages.find((x: any) => String(x.id) === String(id))) || { dest_country_code: '*', active: true };
        form(id ? 'Edit package rate' : 'New package rate', 'An all-in price for one item.',
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{branchPick('pkBranch', p.branch_code, !!id)}
                {field('pkDest', 'Destination', <select id="pkDest" className="field" defaultValue={p.dest_country_code}>{destOptions(d)}</select>)}
                <div className="sm:col-span-2">{field('pkName', req('Item / package'), <input id="pkName" className="field" required defaultValue={p.name || ''} placeholder='e.g. TV up to 55"' />)}</div>
                {field('pkPrice', req('Price'), <input id="pkPrice" type="number" min="0" step="0.001" className="field" required defaultValue={p.price ?? ''} />)}
                {field('pkInc', 'Includes', <input id="pkInc" className="field" defaultValue={p.includes || ''} placeholder="Wooden box, customs duty, freight" />)}
                <label className="flex items-center gap-2 text-xs font-bold"><input id="pkActive" type="checkbox" className="w-4 h-4" defaultChecked={p.active} />Active</label></div>,
            async () => { await post({ action: 'package_save', id: id || null, branch_code: pickedBranch('pkBranch') || p.branch_code, dest_country_code: val('pkDest'), name: val('pkName'), price: val('pkPrice'), includes: val('pkInc'), active: $('pkActive').checked }); toast(true, 'Package rate saved.'); },
            'Save', id ? delBtn('package_delete', id) : null);
    };
    const editCharge = (id?: any) => {
        const d = cache.current.rates, c = (id && d.charges.find((x: any) => String(x.id) === String(id))) || { basis: 'per_shipment', active: true, cargo_type_code: '*', dest_country_code: '*' };
        form(id ? 'Edit extra charge' : 'New extra charge', 'Offered in the booking form.',
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{branchPick('chBranch', c.branch_code, !!id)}
                {field('chName', req('Name'), <input id="chName" className="field" required defaultValue={c.name || ''} placeholder="Handling, Packing…" />)}
                {field('chBasis', 'Counted', <select id="chBasis" className="field" defaultValue={c.basis}>{[['per_shipment', 'Per shipment'], ['per_box', 'Per box'], ['per_kg', 'Per kg (chargeable)']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {field('chPrice', req('Price'), <input id="chPrice" type="number" min="0" step="0.001" className="field" required defaultValue={c.price ?? ''} />)}
                {field('chCargo', 'Cargo type', <select id="chCargo" className="field" defaultValue={c.cargo_type_code}><option value="*">Any cargo</option>{d.cargo_types.map((t: any) => <option key={t.code} value={t.code}>{`${t.code} · ${t.name}`}</option>)}</select>)}
                {field('chDest', 'Destination', <select id="chDest" className="field" defaultValue={c.dest_country_code || '*'}>{destOptions(d)}</select>)}
                <label className="sm:col-span-2 flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-4 py-3 border border-gray-100 cursor-pointer"><input id="chAuto" type="checkbox" className="w-4 h-4" defaultChecked={!!c.auto_add} /><span className="text-xs font-bold">Add automatically</span><span className="text-[11px] text-gray-400">— to every booking with this cargo type / destination (staff can still remove it)</span></label>
                <label className="flex items-center gap-2 text-xs font-bold"><input id="chActive" type="checkbox" className="w-4 h-4" defaultChecked={c.active} />Active</label></div>,
            async () => { await post({ action: 'charge_save', id: id || null, branch_code: pickedBranch('chBranch') || c.branch_code, name: val('chName'), basis: val('chBasis'), price: val('chPrice'), cargo_type_code: val('chCargo'), dest_country_code: val('chDest'), auto_add: $('chAuto').checked, active: $('chActive').checked }); toast(true, 'Charge saved.'); },
            'Save', id ? delBtn('charge_delete', id) : null);
    };
    const editCommodity = (code?: string) => {
        const c = (code && cache.current.rates.commodities.find((x: any) => x.code === code)) || { active: true };
        form(code ? `Contents type ${code}` : 'New contents type', 'e.g. Electronics, Perfumes, Documents.',
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{field('coCode', 'Code', <input id="coCode" className="field font-mono uppercase" required defaultValue={c.code || ''} readOnly={!!code} placeholder="ELEC" />)}
                {field('coName', 'Name', <input id="coName" className="field" required defaultValue={c.name || ''} />)}
                <label className="flex items-center gap-2 text-xs font-bold"><input id="coActive" type="checkbox" className="w-4 h-4" defaultChecked={c.active} />Active</label></div>,
            async () => { await post({ action: 'commodity_save', code: val('coCode'), name: val('coName'), active: $('coActive').checked }); toast(true, 'Saved.'); });
    };
    const editProduct = (id?: any) => {
        const p = (id && cache.current.materials?.products.find((x: any) => x.id === id)) || { unit: 'pcs', track_stock: true, active: true };
        form(id ? `Edit ${p.name}` : 'New packing material', `Price and reorder level are for ${curBranch()}.`,
            <ProductBody p={p} currency={cache.current.materials?.currency || ''} onTrack={v => { cache.current.track = v; }} />,
            async () => {
                await post({ action: 'product_save', id: id || null, sku: val('prSku'), name: val('prName'), unit: val('prUnit'), track_stock: cache.current.track, active: $('prActive').checked, branch_code: curBranch(), sell_price: val('prPrice'), reorder_level: val('prReorder') });
                toast(true, 'Item saved.');
            });
    };
    const countStock = (id: any) => {
        const p = cache.current.materials.products.find((x: any) => x.id === id);
        form(`Count ${p.name}`, `System says ${+p.qty} ${p.unit}. The difference is booked at average cost.`,
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{field('scQty', `Counted (${p.unit})`, <input id="scQty" type="number" min="0" step="any" className="field" required defaultValue={+p.qty} />)}{field('scNote', 'Note', <input id="scNote" className="field" placeholder="Monthly count" />)}</div>,
            async () => { const r = await post({ action: 'stock_count', branch: curBranch(), product_id: id, counted: val('scQty'), note: val('scNote') }); toast(true, +r.difference ? `Adjusted by ${+r.difference} ${p.unit}.` : 'No difference.'); }, 'Save count');
    };
    async function ensureMaterials() {
        if (!cache.current.materials || cache.current.materials.branch !== curBranch()) cache.current.materials = await api(`/api/accounts?view=materials&branch=${encodeURIComponent(curBranch())}`);
        return cache.current.materials;
    }
    const newPurchase = async () => {
        if (!needBranch()) return;
        const d = await ensureMaterials();
        form('New purchase', `Into ${curBranch()} · ${d.currency}. Counted items go to stock; consumables and other items are expensed.`, <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {field('puSup', 'Supplier', <select id="puSup" className="field"><option value="">— Cash purchase / no supplier —</option>{d.suppliers.filter((s: any) => s.active).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}
                {field('puPay', 'Paid by', <select id="puPay" className="field"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="credit">Supplier credit (pay later)</option></select>)}
                {field('puBill', 'Supplier bill no.', <input id="puBill" className="field" />)}{field('puDate', 'Date', <input id="puDate" type="date" className="field" defaultValue={iso(new Date())} />)}</div>
            <p className="sd-label mt-5 mb-2">Items</p><PurchaseLines d={d} /></>,
        async () => {
            const lines = rowsOf('#puLines [data-pl]');
            const r = await post({ action: 'purchase', branch: curBranch(), supplier_id: val('puSup') || null, pay_method: val('puPay'), bill_ref: val('puBill'), date: val('puDate'), lines });
            toast(true, `${r.purchase_no} saved — ${money(d.currency, r.total)}.`); cache.current.materials = null;
        }, 'Save purchase');
    };
    const paySupplier = (id: any, no: string, balance: any, cur: string) => {
        form(`Pay supplier · ${no}`, `Owed ${money(cur, balance)}`,
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{field('spAmt', 'Amount', <input id="spAmt" type="number" min="0" step="0.001" className="field" defaultValue={balance} required />)}
                {field('spMethod', 'Method', <select id="spMethod" className="field"><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option></select>)}{field('spRef', 'Reference', <input id="spRef" className="field" />)}</div>,
            async () => { const r = await post({ action: 'supplier_pay', purchase_id: id, amount: val('spAmt'), method: val('spMethod'), reference: val('spRef') }); toast(true, `${r.payment_no}: ${money(cur, r.amount)} paid.`); }, 'Pay');
    };
    const newSale = async () => {
        if (!needBranch()) return;
        const d = await ensureMaterials();
        const sellable = d.products.filter((p: any) => p.active && +p.sell_price > 0);
        if (!sellable.length) return toast(false, 'Set a sell price on at least one packing material first.');
        form('Counter sale', `Packing materials sold at ${curBranch()} (walk-in customers).`, <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{field('saName', 'Customer', <input id="saName" className="field" placeholder="Walk-in" />)}{field('saPhone', 'Phone', <PhoneField ref={h => { phones.saPhone = h; }} country="OM" inputProps={{ id: 'saPhone', className: 'field', placeholder: 'Mobile number' }} />)}
                {field('saPay', 'Payment', <select id="saPay" className="field"><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="credit">Credit</option></select>)}</div>
            <p className="sd-label mt-5 mb-2">Items</p><SaleLines d={d} sellable={sellable} /></>,
        async () => {
            const lines = [...document.querySelectorAll('#saLines [data-sl]')].map(x => ({ kind: 'material', product_id: (x.querySelector('[data-k=product_id]') as HTMLSelectElement).value, qty: (x.querySelector('[data-k=qty]') as HTMLInputElement).value, rate: (x.querySelector('[data-k=rate]') as HTMLInputElement).value }));
            const r = await post({ action: 'invoice', branch: curBranch(), customer_name: val('saName') || 'Walk-in', customer_phone: phoneValue('saPhone'), pay_method: val('saPay'), lines });
            toast(true, `${r.invoice_no} — ${money(r.currency, r.total)}${r.payment ? ' paid' : ''}.`); cache.current.materials = null;
            setTimeout(() => openInvoice(r.id), 300);
        }, 'Complete sale');
    };
    const editSupplier = (id?: any) => {
        const s = (id && (cache.current.suppliers || []).find((x: any) => x.id === id)) || { active: true, kind: 'supplier', services: [] };
        form(id ? s.name : 'New supplier / agent', 'Agents bill MAWB / container and shipment costs; suppliers sell you materials.', <SupplierBody s={s} />,
            async () => {
                await post({ action: 'supplier_save', id: id || null, name: val('suName'), kind: val('suKind'), contact_person: val('suContact'), phone: phoneValue('suPhone'), city: val('suCity'), email: val('suEmail'), country: val('suCountry'), address: val('suAddr'), tax_no: val('suTax'), payment_terms_days: val('suTerms'), services: [...document.querySelectorAll<HTMLInputElement>('[data-svc]:checked')].map(x => x.dataset.svc), notes: val('suNotes'), active: $('suActive').checked });
                toast(true, 'Saved.'); cache.current.suppliers = null;
            });
    };
    const newCost = async () => {
        const d = cache.current.costs || await api(`/api/accounts?view=costs&${qs()}`);
        form('Add cost', 'For a MAWB / container (split across its shipments) or for one shipment.', <CostBody d={d} branchSel={branchSelect()} />,
            async () => {
                const r = await post({ action: 'cost_bill', branch: xb(), consolidation_id: val('cFor') || null, awb: val('cFor') ? null : val('cAwb'), cost_type: val('cType'), supplier_id: val('cParty') || null, amount: val('cAmt'), pay_method: val('cPay'), bill_ref: val('cRef'), date: val('cDate2'), description: val('cDesc') });
                toast(true, `${r.bill_no} saved.`); cache.current.costs = null;
            });
    };
    const payCost = (id: any, no: string, balance: any, cur: string) => {
        form(`Pay · ${no}`, `Owed ${money(cur, balance)}`,
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{field('pcAmt', 'Amount', <input id="pcAmt" type="number" min="0" step="0.001" className="field" defaultValue={balance} required />)}
                {field('pcMethod', 'Method', <select id="pcMethod" className="field"><option value="bank">Bank</option><option value="cash">Cash</option><option value="card">Card</option></select>)}{field('pcRef', 'Reference', <input id="pcRef" className="field" />)}</div>,
            async () => { const r = await post({ action: 'cost_bill_pay', id, amount: val('pcAmt'), method: val('pcMethod'), reference: val('pcRef') }); toast(true, `${r.payment_no}: ${money(cur, r.amount)} paid.`); }, 'Pay');
    };
    const newRequest = () => {
        const d = cache.current.requests;
        form('Request stock', 'From the central warehouse. Price is the warehouse’s price for branches.', <RequestBody d={d} full={ctxRef.current.full} branches={ctxRef.current.branches} />,
            async () => {
                const lines = [...document.querySelectorAll<HTMLElement>('#rqLines [data-rq]')].map(x => ({ product_id: +x.dataset.rq!, qty: x.querySelector('input')!.value })).filter(l => +l.qty > 0);
                const r = await post({ action: 'stock_request', branch: ctxRef.current.full ? val('rqBranch') : ctxRef.current.my_branch, warehouse: val('rqWh'), lines, notes: val('rqNotes') });
                toast(true, `${r.request_no} sent to the warehouse.`);
            }, 'Send request');
    };
    const reqAction = async (action: string, id: any, no: string) => {
        const verb = ({ stock_receive: 'Receive', stock_reject: 'Reject', stock_cancel: 'Cancel' } as Record<string, string>)[action];
        if (action === 'stock_reject') {
            form(`Reject ${no}?`, '', field('rjReason', 'Reason', <input id="rjReason" className="field" placeholder="e.g. out of stock" />),
                async () => { await post({ action, id, reason: val('rjReason') }); toast(true, 'Rejected.'); }, 'Reject');
            return;
        }
        if (!await confirm({ title: `${verb} ${no}?`, message: action === 'stock_receive' ? 'Only after checking the items arrived. They are added to your stock and the branch owes the warehouse.' : 'The request is withdrawn.', confirmText: verb })) return;
        try { await post({ action, id }); toast(true, `${no}: done.`); show(); } catch (e) { toast(false, (e as Error).message); }
    };
    const settle = (warehouse: string, branch: string, owed: any, cur: string) => {
        form(`Settle ${branch} → ${warehouse}`, `Owed ${money(cur, owed)}. Recorded in both branches’ books.`,
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{field('stAmt', 'Amount', <input id="stAmt" type="number" min="0" step="0.001" className="field" defaultValue={owed} required />)}
                {field('stMethod', 'Method', <select id="stMethod" className="field"><option value="bank">Bank</option><option value="cash">Cash</option><option value="card">Card</option></select>)}{field('stRef', 'Reference', <input id="stRef" className="field" />)}</div>,
            async () => { await post({ action: 'internal_settle', warehouse, branch_code: branch, amount: val('stAmt'), method: val('stMethod'), reference: val('stRef') }); toast(true, 'Settled.'); }, 'Settle');
    };
    const closeCash = async (e: React.FormEvent<HTMLFormElement>, cur: string, date: string) => {
        e.preventDefault();
        const f = e.currentTarget, counted = (f.elements.namedItem('counted') as HTMLInputElement).value;
        if (!await confirm({ title: `Close ${cur} cash for ${day(date)}?`, message: 'Any difference is booked as cash over / short. This cannot be undone.', confirmText: 'Close day' })) return;
        try { const r = await post({ action: 'cash_close', branch: curBranch(), currency: cur, date, counted, notes: (f.elements.namedItem('notes') as HTMLInputElement).value }); toast(true, +r.difference ? `Closed with a difference of ${fmt(cur, r.difference)}.` : 'Closed — cash matches.'); show(); }
        catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- drawing ----------
    const table = (head: [string, string?][], rows: ReactNode[], empty: string) => (
        <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden"><table className="rtable w-full text-xs">
            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">{head.map((h, i) => <th key={i} className={`p-3 ${i === 0 ? 'pl-4' : ''} font-extrabold ${/right/.test(h[1] || '') ? 'text-right' : ''}`}>{h[0]}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">{rows.length ? rows : <tr><td colSpan={head.length} className="p-8 text-center text-gray-400">{empty}</td></tr>}</tbody></table></div>
    );
    const toolbar = (left: ReactNode, right: ReactNode) => <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div className="flex flex-wrap gap-2 items-center">{left}</div><div className="flex flex-wrap gap-2">{right}</div></div>;
    const opts = (items: [string, string][], attr: string, cur: string, onPick: (k: string) => void, cls = 'flex gap-1 bg-[#F8F8FA] p-1 rounded-full') =>
        <div className={cls}>{items.map(([k, l]) => <button key={k} type="button" className="opt px-3 py-1.5 rounded-full text-[11px] font-extrabold" {...{ [attr]: k }} aria-pressed={k === cur} onClick={() => onPick(k)}>{l}</button>)}</div>;
    const emptyBox = (t: string, cls = 'p-10') => <p className={`${cls} text-center text-xs text-gray-400 bg-[#F8F8FA] rounded-[2rem]`}>{t}</p>;
    const addBtn = (label: string, onClick: () => void, cls = 'btn btn-coral', icon: 'plus' | 'cash' = 'plus') => <button type="button" className={cls} onClick={onClick}><Icon name={icon} />{label}</button>;
    const voidOrPill = (isVoid: boolean, action: string, id: any, no: string, title?: string) => isVoid ? <span className="pill-tag pill-gray" title={title}>Void</span> : <button type="button" className="btn btn-light btn-sm" onClick={() => voidDoc(action, id, no)}>Void</button>;

    const RENDER: Record<string, (d: any) => ReactNode> = {
        overview: d => <>{toolbar(null, <>{addBtn('New invoice', newInvoice)}{addBtn('Counter sale', newSale, 'btn btn-light', 'cash')}{addBtn('Expense', newExpense, 'btn btn-light')}</>)}
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">{d.currencies.length ? d.currencies.map((c: any) => (
                <div key={c.currency} className="bg-[#F8F8FA] rounded-[2rem] p-5 space-y-4">
                    <div className="flex items-center justify-between"><span className="pill-tag pill-dark">{c.currency}</span><span className="text-[10px] font-bold text-gray-400">{`${day(d.from)} – ${day(d.to)}`}</span></div>
                    <div className="grid grid-cols-2 gap-3">
                        {([['Invoiced', c.invoiced], ['Collected', c.collected], ['Expenses', c.expenses], ['Profit', c.profit]] as [string, number][]).map(([l, v]) => <div key={l} className="bg-white rounded-2xl p-3"><p className="sd-label">{l}</p><p className={`text-lg font-extrabold money ${l === 'Profit' ? (v < 0 ? 'text-[#D55C48]' : 'text-emerald-600') : ''}`}>{fmt(c.currency, v)}</p></div>)}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">{['cash', 'card', 'bank'].map(m => <span key={m} className="pill-tag pill-gray">{`${METHOD_LABEL[m]} ${fmt(c.currency, c[m])}`}</span>)}</div>
                    <div className="flex items-center justify-between bg-white rounded-2xl p-3"><div><p className="sd-label">Owed by customers</p><p className="text-base font-extrabold money">{money(c.currency, c.receivable)}</p></div>
                        {c.overdue ? <span className="pill-tag pill-coral">{`${fmt(c.currency, c.overdue)} overdue`}</span> : <span className="pill-tag pill-green">Nothing overdue</span>}</div>
                </div>)) : emptyBox('No money movements in this period yet. Invoices are created automatically when a booking with a charge is saved.', 'col-span-full p-10')}</div></>,
        invoices: d => {
            const status = cache.current.invStatus || 'open';
            return <>{toolbar(<>{opts([['open', 'Open'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']], 'data-inv-status', status, k => setCache('invStatus', k))}
                <input id="invQ" className="field !py-2 !w-56 text-xs" placeholder="Search invoice, AWB, customer…" defaultValue={cache.current.invQ || ''} onInput={e => {
                    clearTimeout(cache.current.invT); const v = (e.target as HTMLInputElement).value;
                    cache.current.invT = setTimeout(() => { cache.current.invQ = v; show().then(() => setTimeout(() => { const el = $('invQ'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, 0)); }, 350);
                }} /></>, addBtn('New invoice', newInvoice))}
                {table([['Invoice'], ['Customer'], ['Date'], ['Total', 'right'], ['Balance', 'right'], ['Status']], d.invoices.map((i: any) => (
                    <tr key={i.id} className="hover:bg-[#F8F8FA] cursor-pointer" data-inv={i.id} onClick={() => openInvoiceSafe(String(i.id))}>
                        <td className="p-3 pl-4 font-extrabold font-mono" data-label="Invoice">{i.invoice_no}{i.awb && <span className="block text-[10px] text-gray-400 font-sans">{i.awb}</span>}</td>
                        <td className="p-3" data-label="Customer">{i.customer_name || '—'}<span className="block text-[10px] text-gray-400">{i.customer_phone || ''}</span></td>
                        <td className="p-3" data-label="Date">{day(i.issued_at)}{i.terms !== 'cash' && <span className="block text-[10px] text-gray-400">{i.terms === 'credit' ? 'Credit · due ' + day(i.due_date) : 'Pay on delivery'}</span>}</td>
                        <td className="p-3 text-right money" data-label="Total">{money(i.currency, i.total)}</td>
                        <td className="p-3 text-right money" data-label="Balance">{+i.balance ? money(i.currency, i.balance) : '—'}</td>
                        <td className="p-3 pr-4" data-label="Status"><span className={`pill-tag ${STATUS_PILL[i.status]}`}>{i.status}</span></td></tr>)), 'No invoices for this filter.')}</>;
        },
        payments: d => table([['Receipt'], ['For'], ['Customer'], ['Method'], ['Date'], ['Amount', 'right'], ['']], d.payments.map((p: any) => (
            <tr key={p.id} className={p.void ? 'opacity-50' : ''}>
                <td className="p-3 pl-4 font-extrabold font-mono" data-label="Receipt">{p.receipt_no}</td>
                <td className="p-3" data-label="For">{p.invoices?.invoice_no || 'On account'}{p.invoices?.awb && <span className="block text-[10px] text-gray-400">{p.invoices.awb}</span>}</td>
                <td className="p-3" data-label="Customer">{p.customer_name || '—'}</td>
                <td className="p-3" data-label="Method">{`${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ''}`}</td>
                <td className="p-3" data-label="Date">{day(p.received_at)}<span className="block text-[10px] text-gray-400">{p.received_by_name || ''}</span></td>
                <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(p.currency, p.amount)}</td>
                <td className="p-3 pr-4 text-right" data-label="">{voidOrPill(!!p.void, 'payment_void', p.id, p.receipt_no, p.void_reason || '')}</td></tr>)), 'No receipts in this period.'),
        expenses: d => <>{toolbar(null, addBtn('Add expense', newExpense))}
            {table([['No.'], ['Date'], ['Category'], ['Paid to'], ['Method'], ['Amount', 'right'], ['']], d.expenses.map((e: any) => (
                <tr key={e.id} className={e.void ? 'opacity-50' : ''}>
                    <td className="p-3 pl-4 font-extrabold font-mono" data-label="No.">{e.expense_no}</td>
                    <td className="p-3" data-label="Date">{day(e.expense_date)}</td>
                    <td className="p-3" data-label="Category">{e.accounts?.name || e.account_code}</td>
                    <td className="p-3" data-label="Paid to">{e.paid_to || '—'}{e.notes && <span className="block text-[10px] text-gray-400">{e.notes}</span>}</td>
                    <td className="p-3" data-label="Method">{METHOD_LABEL[e.method]}</td>
                    <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(e.currency, e.amount)}</td>
                    <td className="p-3 pr-4 text-right" data-label="">{voidOrPill(!!e.void, 'expense_void', e.id, e.expense_no)}</td></tr>)), 'No expenses in this period.')}</>,
        cash: d => {
            if (d.none) return emptyBox('Choose a branch (top right) to close its cash.');
            const date = d.date;
            const closed = (c: string) => d.closings.find((x: any) => x.currency === c && x.close_date === date);
            return <>{toolbar(<><label className="text-xs font-bold text-gray-500" htmlFor="cashDate">Day</label><input id="cashDate" type="date" className="field !py-2 !w-40" defaultValue={date} max={iso(new Date())} onChange={e => setCache('cashDate', e.target.value)} /></>, null)}
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 mb-6">{d.days.map((c: any) => {
                    const done = closed(c.currency);
                    return <form key={c.currency} className="bg-[#F8F8FA] rounded-[2rem] p-5 space-y-3" data-close={c.currency} onSubmit={e => closeCash(e, c.currency, date)}>
                        <div className="flex items-center justify-between"><span className="pill-tag pill-dark">{c.currency}</span>{done && <span className={`pill-tag ${+done.difference === 0 ? 'pill-green' : 'pill-amber'}`}>{`Closed by ${done.closed_by_name || ''}`}</span>}</div>
                        <div className="bg-white rounded-2xl p-4 text-xs space-y-1.5">
                            <div className="flex justify-between"><span className="text-gray-500">{`Opening (last count${c.last_closed ? ' ' + day(c.last_closed) : ''})`}</span><span className="money font-bold">{fmt(c.currency, c.opening)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">+ Cash received</span><span className="money font-bold text-emerald-600">{fmt(c.currency, c.cash_in)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">− Cash paid out</span><span className="money font-bold text-[#D55C48]">{fmt(c.currency, c.cash_out)}</span></div>
                            <div className="flex justify-between border-t border-gray-100 pt-1.5"><span className="font-extrabold">Should be in the drawer</span><span className="money font-extrabold">{money(c.currency, c.expected)}</span></div>
                        </div>
                        {done ? <p className="text-xs">{'Counted '}<b className="money">{money(c.currency, done.counted)}</b>{' · difference '}<b className={`money ${+done.difference ? 'text-[#D55C48]' : 'text-emerald-600'}`}>{fmt(c.currency, done.difference)}</b>{done.notes ? ` · ${done.notes}` : ''}</p>
                            : <><div className="grid grid-cols-2 gap-2"><input name="counted" type="number" step="0.001" min="0" className="field" placeholder="Counted" required aria-label="Counted cash" /><input name="notes" className="field" placeholder="Note (optional)" aria-label="Note" /></div>
                                <button className="btn btn-dark w-full"><Icon name="check" />{`Close ${c.currency} for ${day(date)}`}</button></>}
                    </form>;
                })}</div><p className="sd-label mb-2">History</p>
                {table([['Date'], ['Currency'], ['Expected', 'right'], ['Counted', 'right'], ['Difference', 'right'], ['By']], d.closings.map((c: any, i: number) => (
                    <tr key={i}><td className="p-3 pl-4" data-label="Date">{day(c.close_date)}</td><td className="p-3" data-label="Currency">{c.currency}</td>
                        <td className="p-3 text-right money" data-label="Expected">{fmt(c.currency, c.expected)}</td><td className="p-3 text-right money" data-label="Counted">{fmt(c.currency, c.counted)}</td>
                        <td className={`p-3 text-right money font-extrabold ${+c.difference ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Difference">{fmt(c.currency, c.difference)}</td><td className="p-3 pr-4" data-label="By">{c.closed_by_name || ''}</td></tr>)), 'No closings yet.')}</>;
        },
        balances: d => table([['Customer'], ['Open invoices'], ['Overdue', 'right'], ['Balance', 'right']], d.customers.map((c: any, i: number) => (
            <tr key={i}>
                <td className="p-3 pl-4" data-label="Customer"><span className="font-extrabold">{c.customer_name || 'Unknown'}</span><span className="block text-[10px] text-gray-400">{c.customer_phone || ''}</span></td>
                <td className="p-3" data-label="Invoices">{c.invoices.map((x: any) => <button key={x.id} type="button" className="pill-tag pill-gray font-mono mr-1 mb-1" data-inv={x.id} onClick={() => openInvoiceSafe(String(x.id))}>{x.invoice_no}</button>)}</td>
                <td className="p-3 text-right money" data-label="Overdue">{c.overdue ? <span className="text-[#D55C48] font-bold">{fmt(c.currency, c.overdue)}</span> : '—'}</td>
                <td className="p-3 pr-4 text-right money font-extrabold" data-label="Balance">{money(c.currency, c.balance)}</td></tr>)), 'Nobody owes anything right now.'),
        pricing: d => {
            const destName = (c: string) => c === '*' ? 'Any destination' : (d.destinations.find((x: any) => x.country_code === c)?.country_name || (window.ALF_COUNTRIES || []).find((x: any) => x.c === c)?.n || c);
            const cargoName = (c: string) => c === '*' ? 'Any cargo' : (d.cargo_types.find((x: any) => x.code === c)?.name || c);
            const comName = (c: string) => !c || c === '*' ? 'General' : (d.commodities.find((x: any) => x.code === c)?.name || c);
            const price = (r: any) => r.method === 'vol_band' ? r.bands.map((b: any) => `≤${b.upto}kg ${fmt(r.currency, b.price)}`).join(' · ') + (+r.extra_per_kg ? ` · +${fmt(r.currency, r.extra_per_kg)}/kg` : '')
                : r.method === 'box_size' ? (r.sizes || []).map((s: any) => `${s.name} ${s.l}×${s.w}×${s.h} ${fmt(r.currency, s.price)}`).join(' · ')
                    : r.method === 'doc_slab' ? `First ${r.slab?.base_kg} kg ${fmt(r.currency, r.slab?.base_price)}${+r.slab?.step_price ? ` + ${fmt(r.currency, r.slab.step_price)} per extra ${r.slab.step_kg} kg` : ''}`
                        : `${money(r.currency, r.rate)} ${PRICE_LABEL[r.method].toLowerCase()}`;
            const sub = cache.current.pricingSub || 'freight';
            const subs: [string, string][] = [['freight', 'Freight rate cards'], ['packages', 'Package rates'], ['charges', 'Extra charges'], ...(ctxRef.current.full ? [['commodities', 'Commodities'] as [string, string]] : [])];
            const bcur = (code: string) => ctxRef.current.branches.find((b: any) => b.branch_code === code)?.currency;
            const note = (t: string) => <p className="text-xs text-gray-500">{t}</p>;
            let body: ReactNode;
            if (sub === 'freight') body = <>{toolbar(note('Most specific card wins: destination + cargo + contents, then wider. Each contents type in a shipment is priced on its own card.'), addBtn('New rate card', () => editRate()))}
                {table([['Branch'], ['Destination'], ['Cargo'], ['Contents'], ['Method'], ['Price'], ['Minimum', 'right']], d.cards.map((r: any) => (
                    <tr key={r.id} className={`${r.active ? '' : 'opacity-50'} hover:bg-[#F8F8FA] cursor-pointer`} data-rate={r.id} onClick={() => editRate(String(r.id))}>
                        <td className="p-3 pl-4 font-extrabold" data-label="Branch">{r.branch_code}</td>
                        <td className="p-3" data-label="Destination">{destName(r.dest_country_code)}</td>
                        <td className="p-3" data-label="Cargo">{cargoName(r.cargo_type_code)}</td>
                        <td className="p-3" data-label="Contents"><span className={`pill-tag ${r.commodity && r.commodity !== '*' ? 'pill-amber' : 'pill-gray'}`}>{comName(r.commodity)}</span></td>
                        <td className="p-3" data-label="Method"><span className="pill-tag pill-gray">{PRICE_LABEL[r.method]}</span></td>
                        <td className="p-3" data-label="Price">{price(r)}</td>
                        <td className="p-3 pr-4 text-right money" data-label="Minimum">{+r.min_charge ? money(r.currency, r.min_charge) : '—'}</td></tr>)), 'No rate cards yet — freight is typed by hand until you add one.')}</>;
            else if (sub === 'packages') body = <>{toolbar(note('All-in prices per item, e.g. a TV including wooden box, customs duty and freight. Picked in the booking form.'), addBtn('New package rate', () => editPackage()))}
                {table([['Branch'], ['Package'], ['Destination'], ['Includes'], ['Price', 'right']], d.packages.map((p: any) => (
                    <tr key={p.id} className={`${p.active ? '' : 'opacity-50'} hover:bg-[#F8F8FA] cursor-pointer`} data-pkg={p.id} onClick={() => editPackage(String(p.id))}>
                        <td className="p-3 pl-4 font-extrabold" data-label="Branch">{p.branch_code}</td><td className="p-3 font-bold" data-label="Package">{p.name}</td>
                        <td className="p-3" data-label="Destination">{destName(p.dest_country_code)}</td><td className="p-3 text-gray-500" data-label="Includes">{p.includes || '—'}</td>
                        <td className="p-3 pr-4 text-right money font-extrabold" data-label="Price">{fmt(bcur(p.branch_code), p.price)}</td></tr>)), 'No package rates yet.')}</>;
            else if (sub === 'charges') {
                const BL: Record<string, string> = { per_shipment: 'Per shipment', per_box: 'Per box', per_kg: 'Per kg' };
                body = <>{toolbar(note('Handling, packing, documentation… Use the same name with a different cargo type for different prices (e.g. Handling Air 2.000 / Sea 2.500 per box). “Auto” charges are added to every matching booking.'), addBtn('New charge', () => editCharge()))}
                    {table([['Branch'], ['Charge'], ['Applies to'], ['Counted'], ['Price', 'right']], d.charges.map((c: any) => (
                        <tr key={c.id} className={`${c.active ? '' : 'opacity-50'} hover:bg-[#F8F8FA] cursor-pointer`} data-chg={c.id} onClick={() => editCharge(String(c.id))}>
                            <td className="p-3 pl-4 font-extrabold" data-label="Branch">{c.branch_code}</td><td className="p-3 font-bold" data-label="Charge">{c.auto_add ? <>{`${c.name} `}<span className="pill-tag pill-dark">Auto</span></> : c.name}</td>
                            <td className="p-3" data-label="Applies to">{`${cargoName(c.cargo_type_code || '*')} · ${destName(c.dest_country_code || '*')}`}</td>
                            <td className="p-3" data-label="Counted"><span className="pill-tag pill-gray">{BL[c.basis]}</span></td>
                            <td className="p-3 pr-4 text-right money font-extrabold" data-label="Price">{fmt(bcur(c.branch_code), c.price)}</td></tr>)), 'No extra charges yet.')}</>;
            } else body = <>{toolbar(note('Contents types staff choose per box (General, Electronics…). Each can have its own rate card.'), addBtn('New type', () => editCommodity()))}
                {table([['Code'], ['Name'], ['']], d.commodities.map((c: any) => (
                    <tr key={c.code} className={`${c.active ? '' : 'opacity-50'} hover:bg-[#F8F8FA] cursor-pointer`} data-com={c.code} onClick={() => editCommodity(c.code)}>
                        <td className="p-3 pl-4 font-mono font-extrabold" data-label="Code">{c.code}</td><td className="p-3" data-label="Name">{c.name}</td><td className="p-3 pr-4" data-label="">{c.active ? '' : 'Inactive'}</td></tr>)), 'No commodities.')}</>;
            return <>{opts(subs, 'data-psub', sub, k => setCache('pricingSub', k), 'flex flex-wrap gap-1 bg-[#F8F8FA] p-1 rounded-full w-fit mb-4')}{body}</>;
        },
        materials: d => {
            if (d.none) return emptyBox('Choose a branch (top right) to see its packing-material stock.');
            return <>{toolbar(<p className="text-xs text-gray-500">{'Stock at '}<b>{curBranch()}</b>{` (${d.currency}). Consumables (bubble roll, tape…) are expensed on purchase and not counted.`}</p>,
                <>{addBtn('Counter sale', newSale, 'btn btn-coral', 'cash')}{addBtn('Purchase', newPurchase, 'btn btn-light')}{addBtn('New item', () => editProduct(), 'btn btn-light')}</>)}
                {table([['Item'], ['Type'], ['In stock', 'right'], ['Avg cost', 'right'], ['Sell price', 'right'], ['']], d.products.map((p: any) => {
                    const low = p.track_stock && +p.qty <= +p.reorder_level;
                    return <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                        <td className="p-3 pl-4" data-label="Item"><span className="font-extrabold">{p.name}</span><span className="block text-[10px] text-gray-400 font-mono">{p.sku}</span></td>
                        <td className="p-3" data-label="Type">{p.track_stock ? <span className="pill-tag pill-gray">Counted</span> : <span className="pill-tag pill-amber" title="Expensed when bought; not counted">Consumable</span>}</td>
                        <td className="p-3 text-right" data-label="In stock">{p.track_stock ? <><span className={`font-extrabold ${low ? 'text-[#D55C48]' : ''}`}>{`${+p.qty} ${p.unit}`}</span>{low && <span className="block text-[10px] text-[#D55C48] font-bold">Reorder</span>}</> : <span className="text-gray-300">—</span>}</td>
                        <td className="p-3 text-right money" data-label="Avg cost">{p.track_stock ? fmt(d.currency, p.avg_cost) : '—'}</td>
                        <td className="p-3 text-right money font-extrabold" data-label="Sell price">{+p.sell_price ? fmt(d.currency, p.sell_price) : <span className="text-gray-300">not sold</span>}</td>
                        <td className="p-3 pr-4 text-right whitespace-nowrap" data-label=""><button type="button" className="btn btn-light btn-sm" onClick={() => editProduct(p.id)}>Edit</button>{p.track_stock && <>{' '}<button type="button" className="btn btn-light btn-sm" onClick={() => countStock(p.id)}>Count</button></>}</td></tr>;
                }), 'No items yet — add cartons, bubble roll, tape…')}
                <p className="sd-label mt-6 mb-2">Recent stock movements</p>
                {table([['When'], ['Item'], ['Type'], ['Qty', 'right'], ['Reference']], d.moves.slice(0, 25).map((m: any, i: number) => (
                    <tr key={i}><td className="p-3 pl-4" data-label="When">{day(m.created_at)}</td><td className="p-3" data-label="Item">{m.products?.name || ''}</td>
                        <td className="p-3" data-label="Type"><span className="pill-tag pill-gray">{m.kind}</span></td><td className={`p-3 text-right font-extrabold ${+m.qty < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Qty">{`${+m.qty > 0 ? '+' : ''}${+m.qty}`}</td>
                        <td className="p-3 pr-4" data-label="Ref">{m.note || ''}</td></tr>)), 'No movements yet.')}</>;
        },
        purchases: d => {
            const sup = (id: any) => d.suppliers.find((s: any) => s.id === id)?.name || '—';
            const owed = d.owed.filter((o: any) => o.balance > 0);
            return <>{toolbar(owed.length ? <><span className="text-xs font-bold text-gray-500 mr-1">Owed to suppliers:</span>{owed.map((o: any, i: number) => <span key={i} className="pill-tag pill-coral">{`${sup(o.supplier_id)}: ${money(o.currency, o.balance)}`}</span>)}</> : <span className="text-xs text-gray-500">Nothing owed to suppliers.</span>,
                addBtn('New purchase', newPurchase))}
                {table([['No.'], ['Date'], ['Supplier'], ['Items'], ['Total', 'right'], ['Status'], ['']], d.purchases.map((p: any) => (
                    <tr key={p.id} className={p.status === 'void' ? 'opacity-50' : ''}>
                        <td className="p-3 pl-4 font-extrabold font-mono" data-label="No.">{p.purchase_no}{p.bill_ref && <span className="block text-[10px] text-gray-400 font-sans">{`Bill ${p.bill_ref}`}</span>}</td>
                        <td className="p-3" data-label="Date">{day(p.purchase_date)}</td>
                        <td className="p-3" data-label="Supplier">{p.suppliers?.name || '—'}</td>
                        <td className="p-3" data-label="Items">{p.lines.map((l: any) => `${+l.qty} × ${l.description}`).join(', ')}</td>
                        <td className="p-3 text-right money font-extrabold" data-label="Total">{money(p.currency, p.total)}</td>
                        <td className="p-3" data-label="Status"><span className={`pill-tag ${STATUS_PILL[p.status]}`}>{p.status === 'unpaid' ? 'owed' : p.status}</span>{+p.balance > 0 && p.status !== 'void' && <span className="block text-[10px] text-[#D55C48] font-bold">{`${fmt(p.currency, p.balance)} due`}</span>}</td>
                        <td className="p-3 pr-4 text-right whitespace-nowrap" data-label="">{['unpaid', 'partial'].includes(p.status) && <><button type="button" className="btn btn-dark btn-sm" onClick={() => paySupplier(p.id, p.purchase_no, p.balance, p.currency)}>Pay</button>{' '}</>}{p.status !== 'void' && <button type="button" className="btn btn-light btn-sm" onClick={() => voidDoc('purchase_void', p.id, p.purchase_no)}>Void</button>}</td></tr>)), 'No purchases in this period.')}</>;
        },
        parties: d => {
            const KL: Record<string, string> = { supplier: 'Supplier', agent: 'Agent', both: 'Supplier & agent' };
            const kf = cache.current.partyKind || 'all';
            return <>{toolbar(opts([['all', 'All'], ['agent', 'Agents'], ['supplier', 'Suppliers']], 'data-pkind', kf, k => setCache('partyKind', k)), addBtn('Add supplier / agent', () => editSupplier()))}
                {table([['Name'], ['Type'], ['Services'], ['Contact'], ['Terms'], ['We owe', 'right']], d.parties.filter((p: any) => kf === 'all' || p.kind === kf || p.kind === 'both').map((p: any) => (
                    <tr key={p.id} className={`${p.active ? '' : 'opacity-50'} hover:bg-[#F8F8FA] cursor-pointer`} data-party={p.id} onClick={() => editSupplier(p.id)}>
                        <td className="p-3 pl-4" data-label="Name"><span className="font-extrabold">{p.name}</span>{p.contact_person && <span className="block text-[10px] text-gray-400">{p.contact_person}</span>}</td>
                        <td className="p-3" data-label="Type"><span className={`pill-tag ${p.kind === 'agent' ? 'pill-dark' : p.kind === 'both' ? 'pill-coral' : 'pill-gray'}`}>{KL[p.kind] || p.kind}</span></td>
                        <td className="p-3" data-label="Services">{(p.services || []).length ? p.services.map((s: string) => <span key={s} className="pill-tag pill-gray mr-1">{s}</span>) : '—'}</td>
                        <td className="p-3" data-label="Contact">{p.phone || ''}{p.email && <span className="block text-[10px] text-gray-400">{p.email}</span>}</td>
                        <td className="p-3" data-label="Terms">{p.payment_terms_days ? `${p.payment_terms_days} days` : 'Cash'}</td>
                        <td className="p-3 pr-4 text-right" data-label="We owe">{p.owed.length ? p.owed.map((o: any, i: number) => <span key={i} className="block font-extrabold text-[#D55C48] money">{money(o.currency, o.balance)}</span>) : '—'}</td></tr>)), 'No suppliers or agents yet.')}</>;
        },
        costs: d => {
            const sub = cache.current.costSub || 'bills';
            const head = opts([['bills', 'Cost bills'], ['profit', 'Profit per shipment']], 'data-csub', sub, k => setCache('costSub', k), 'flex gap-1 bg-[#F8F8FA] p-1 rounded-full w-fit mb-4');
            if (d.profit) {
                const tot: Record<string, { revenue: number; cost: number; profit: number }> = {};
                d.profit.rows.forEach((r: any) => { const t = (tot[r.currency] ||= { revenue: 0, cost: 0, profit: 0 }); t.revenue += +r.revenue; t.cost += +r.direct_cost + +r.allocated_cost; t.profit += +r.profit; });
                return <>{head}<div className="flex flex-wrap gap-2 mb-4">{Object.entries(tot).map(([c, t]) => <div key={c} className="bg-[#F8F8FA] rounded-2xl px-4 py-3 text-xs"><span className="pill-tag pill-dark mr-2">{c}</span>{'Revenue '}<b className="money">{fmt(c, t.revenue)}</b>{' · Cost '}<b className="money">{fmt(c, t.cost)}</b>{' · Profit '}<b className={`money ${t.profit < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`}>{fmt(c, t.profit)}</b>{` ${t.revenue ? `(${(t.profit / t.revenue * 100).toFixed(1)}%)` : ''}`}</div>)}</div>
                    {table([['Shipment'], ['Consignee'], ['Revenue', 'right'], ['Direct cost', 'right'], ['MAWB / container share', 'right'], ['Profit', 'right']], d.profit.rows.map((r: any, i: number) => (
                        <tr key={i}><td className="p-3 pl-4 font-extrabold font-mono" data-label="AWB"><a href={`/app/shipments?awb=${encodeURIComponent(r.awb)}`} className="hover:text-coral-600">{r.awb}</a><span className="block text-[10px] text-gray-400 font-sans">{`${day(r.booked_at)} · ${r.branch_code}`}</span></td>
                            <td className="p-3" data-label="Consignee">{r.consignee || '—'}<span className="block text-[10px] text-gray-400">{r.dest_country || ''}</span></td>
                            <td className="p-3 text-right money" data-label="Revenue">{fmt(r.currency, r.revenue)}</td>
                            <td className="p-3 text-right money" data-label="Direct cost">{+r.direct_cost ? fmt(r.currency, r.direct_cost) : '—'}</td>
                            <td className="p-3 text-right money" data-label="MAWB / container share">{+r.allocated_cost ? fmt(r.currency, r.allocated_cost) : '—'}</td>
                            <td className={`p-3 pr-4 text-right money font-extrabold ${+r.profit < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Profit">{money(r.currency, r.profit)}</td></tr>)), 'No shipments with revenue or costs in this period.')}
                    <p className="text-[11px] text-gray-400 mt-3">Revenue = invoiced before tax. MAWB / container costs are split by chargeable weight (containers by CBM).</p></>;
            }
            const TL: Record<string, string> = { freight: 'Freight', customs: 'Customs', trucking: 'Trucking', handling: 'Handling', other: 'Other' };
            return <>{head}{toolbar(<p className="text-xs text-gray-500">Agent and supplier bills for a MAWB / container (split across its shipments) or for one shipment.</p>, addBtn('Add cost', newCost))}
                {table([['No.'], ['Date'], ['For'], ['Cost'], ['Agent / supplier'], ['Amount', 'right'], ['Status'], ['']], d.bills.bills.map((b: any) => (
                    <tr key={b.id} className={b.status === 'void' ? 'opacity-50' : ''}>
                        <td className="p-3 pl-4 font-extrabold font-mono" data-label="No.">{b.bill_no}{b.bill_ref && <span className="block text-[10px] text-gray-400 font-sans">{`Bill ${b.bill_ref}`}</span>}</td>
                        <td className="p-3" data-label="Date">{day(b.bill_date)}</td>
                        <td className="p-3" data-label="For">{b.consolidations ? <><span className="pill-tag pill-dark">{b.consolidations.kind}</span>{` ${b.consolidations.mawb}`}</> : `Shipment ${b.bookings?.awb || ''}`}</td>
                        <td className="p-3" data-label="Cost">{TL[b.cost_type]}{b.description && <span className="block text-[10px] text-gray-400">{b.description}</span>}</td>
                        <td className="p-3" data-label="Agent / supplier">{b.suppliers?.name || '—'}</td>
                        <td className="p-3 text-right money font-extrabold" data-label="Amount">{money(b.currency, b.amount)}</td>
                        <td className="p-3" data-label="Status"><span className={`pill-tag ${STATUS_PILL[b.status]}`}>{b.status === 'unpaid' ? 'owed' : b.status}</span></td>
                        <td className="p-3 pr-4 text-right whitespace-nowrap" data-label="">{['unpaid', 'partial'].includes(b.status) && <><button type="button" className="btn btn-dark btn-sm" onClick={() => payCost(b.id, b.bill_no, b.balance, b.currency)}>Pay</button>{' '}</>}{b.status !== 'void' && <button type="button" className="btn btn-light btn-sm" onClick={() => voidDoc('cost_bill_void', b.id, b.bill_no)}>Void</button>}</td></tr>)), 'No cost bills in this period.')}</>;
        },
        inventory: d => {
            const sub = cache.current.invSub || 'stock';
            const head = opts([['stock', 'Stock by location'], ['moves', 'Movements'], ['requests', 'Warehouse requests'], ['internal', 'Warehouse balances']], 'data-isub', sub, k => setCache('invSub', k), 'flex flex-wrap gap-1 bg-[#F8F8FA] p-1 rounded-full w-fit mb-4');
            if (sub === 'stock') {
                const bn = (c: string) => d.branches.find((b: any) => b.branch_code === c);
                const byLoc: Record<string, any[]> = {};
                d.stock.forEach((s: any) => (byLoc[s.branch_code] ||= []).push(s));
                const cards = Object.entries(byLoc);
                return <>{head}<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{cards.length ? cards.map(([code, items]) => {
                    const b = bn(code) || {}, value = items.reduce((t, s) => t + (+s.qty) * (+s.avg_cost), 0), low = items.filter(s => +s.qty <= +s.reorder_level).length;
                    return <div key={code} className="bg-[#F8F8FA] rounded-[2rem] p-5">
                        <div className="flex items-start justify-between gap-2 mb-3"><div><p className="font-extrabold">{b.branch_name || code}</p><p className="text-[10px] text-gray-400 font-bold">{`${code}${b.branch_type === 'warehouse' ? ' · Central warehouse' : ''}`}</p></div>
                            <div className="text-right"><p className="sd-label">Stock value</p><p className="font-extrabold money">{money(b.currency, value)}</p>{low > 0 && <span className="pill-tag pill-coral">{`${low} to reorder`}</span>}</div></div>
                        <table className="w-full text-xs bg-white rounded-2xl overflow-hidden"><thead><tr className="sd-label text-left"><th className="p-2 pl-3">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Avg cost</th><th className="p-2 pr-3 text-right">Value</th></tr></thead><tbody>
                            {items.map((s, i) => <tr key={i} className="border-t border-gray-100"><td className="p-2 pl-3 font-bold">{s.products.name}</td><td className={`p-2 text-right font-extrabold ${+s.qty <= +s.reorder_level ? 'text-[#D55C48]' : ''}`}>{`${+s.qty} ${s.products.unit}`}</td><td className="p-2 text-right money">{fmt(b.currency, s.avg_cost)}</td><td className="p-2 pr-3 text-right money">{fmt(b.currency, s.qty * s.avg_cost)}</td></tr>)}</tbody></table></div>;
                }) : emptyBox('No counted stock yet.', 'col-span-full p-10')}</div>
                    <p className="text-[11px] text-gray-400 mt-3">Counted items only (cartons…). Consumables are expensed when bought. Value = quantity × average cost.</p></>;
            }
            if (sub === 'moves') {
                const KL: Record<string, string> = { purchase: 'Purchase', sale: 'Sale', adjust: 'Count', void: 'Void', transfer_out: 'To branch', transfer_in: 'From warehouse' };
                const prods = [...new Map(d.stock.map((s: any) => [s.product_id, s.products.name])).entries()] as [any, string][];
                return <>{head}{toolbar(<select id="mvProd" className="field !py-2 !w-60 text-xs" defaultValue={String(cache.current.invProduct || '')} onChange={e => setCache('invProduct', e.target.value)}><option value="">All items</option>{prods.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>, null)}
                    {table([['When'], ['Location'], ['Item'], ['Type'], ['Qty', 'right'], ['Unit cost', 'right'], ['Reference']], d.moves.map((m: any, i: number) => (
                        <tr key={i}><td className="p-3 pl-4" data-label="When">{day(m.created_at)}<span className="block text-[10px] text-gray-400">{m.created_by_name || ''}</span></td>
                            <td className="p-3" data-label="Location">{m.branch_code}</td><td className="p-3 font-bold" data-label="Item">{m.products?.name || ''}</td>
                            <td className="p-3" data-label="Type"><span className="pill-tag pill-gray">{KL[m.kind] || m.kind}</span></td>
                            <td className={`p-3 text-right font-extrabold ${+m.qty < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`} data-label="Qty">{`${+m.qty > 0 ? '+' : ''}${+m.qty} ${m.products?.unit || ''}`}</td>
                            <td className="p-3 text-right money" data-label="Unit cost">{(+m.unit_cost).toFixed(3)}</td><td className="p-3 pr-4" data-label="Reference">{m.note || ''}</td></tr>)), 'No stock movements in this period.')}</>;
            }
            if (sub === 'requests') {
                const SP: Record<string, string> = { requested: 'pill-amber', dispatched: 'pill-dark', received: 'pill-green', rejected: 'pill-coral', cancelled: 'pill-gray' };
                const full = ctxRef.current.full, me = full ? null : ctxRef.current.my_branch;
                const isWh = (code: string) => d.warehouses.some((w: any) => w.branch_code === code);
                return <>{head}{toolbar(d.warehouses.length ? <p className="text-xs text-gray-500">Branches request counted items; the warehouse sends them at its price for branches and the branch owes the warehouse until head office settles.</p> : <p className="text-xs text-[#D55C48] font-bold">No central warehouse yet — set a branch’s type to “Central warehouse” in Branch Network.</p>,
                    d.warehouses.length && (full || !isWh(ctxRef.current.my_branch)) ? addBtn('Request stock', newRequest) : null)}
                    {table([['Request'], ['From → to'], ['Items'], ['Value', 'right'], ['Status'], ['']], d.requests.map((r: any) => {
                        const iAmWh = full || me === r.warehouse, iAmBr = full || me === r.branch_code;
                        return <tr key={r.id}><td className="p-3 pl-4 font-extrabold font-mono" data-label="Request">{r.request_no}<span className="block text-[10px] text-gray-400 font-sans">{`${day(r.requested_at)} · ${r.requested_by || ''}`}</span></td>
                            <td className="p-3" data-label="From → to">{`${r.warehouse} → `}<b>{r.branch_code}</b></td>
                            <td className="p-3" data-label="Items">{r.lines.map((l: any) => `${l.qty_sent != null ? `${+l.qty_sent}/${+l.qty_requested}` : +l.qty_requested} × ${l.name}`).join(', ')}{r.notes && <span className="block text-[10px] text-gray-400">{r.notes}</span>}{r.reject_reason && <span className="block text-[10px] text-[#D55C48]">{r.reject_reason}</span>}</td>
                            <td className="p-3 text-right money font-extrabold" data-label="Value">{+r.total ? money(r.currency, r.total) : '—'}</td>
                            <td className="p-3" data-label="Status"><span className={`pill-tag ${SP[r.status]}`}>{r.status}</span></td>
                            <td className="p-3 pr-4 text-right whitespace-nowrap" data-label="">
                                {r.status === 'requested' && iAmWh && <a href="/app/warehouse" className="btn btn-dark btn-sm">Open warehouse</a>}
                                {r.status === 'requested' && iAmBr && !iAmWh && <button type="button" className="btn btn-light btn-sm" onClick={() => reqAction('stock_cancel', r.id, r.request_no)}>Cancel</button>}
                                {r.status === 'dispatched' && iAmBr && <button type="button" className="btn btn-coral btn-sm" onClick={() => reqAction('stock_receive', r.id, r.request_no)}>Receive</button>}</td></tr>;
                    }), 'No requests yet.')}</>;
            }
            return <>{head}{table([['Branch'], ['Owes'], ['Balance', 'right'], ['']], d.balances.map((b: any, i: number) => (
                <tr key={i}><td className="p-3 pl-4 font-extrabold" data-label="Branch">{b.branch_code}</td><td className="p-3" data-label="Owes">{b.warehouse}</td>
                    <td className={`p-3 text-right money font-extrabold ${b.owed > 0 ? 'text-[#D55C48]' : ''}`} data-label="Balance">{money(b.currency, b.owed)}</td>
                    <td className="p-3 pr-4 text-right" data-label="">{ctxRef.current.full && b.owed > 0 && <button type="button" className="btn btn-dark btn-sm" onClick={() => settle(b.warehouse, b.branch_code, b.owed, b.currency)}>Settle</button>}</td></tr>)), 'No internal balances.')}
                <p className="sd-label mt-6 mb-2">Settlements</p>
                {table([['Date'], ['Branch → warehouse'], ['Method'], ['Amount', 'right']], d.settlements.map((x: any, i: number) => (
                    <tr key={i}><td className="p-3 pl-4" data-label="Date">{day(x.settled_at)}</td><td className="p-3" data-label="Branch → warehouse">{`${x.branch_code} → ${x.warehouse}`}</td><td className="p-3" data-label="Method">{`${METHOD_LABEL[x.method]}${x.reference ? ' · ' + x.reference : ''}`}</td><td className="p-3 pr-4 text-right money font-extrabold" data-label="Amount">{money(x.currency, x.amount)}</td></tr>)), 'No settlements yet.')}</>;
        },
        reports: d => {
            const kind = cache.current.report || 'pl';
            const byCur = (rows: any[]) => rows.reduce((m: Record<string, any[]>, r) => ((m[r.currency] ||= []).push(r), m), {});
            const amt = (r: any, natural: string) => natural === 'debit' ? r.debit - r.credit : r.credit - r.debit;
            const section = (title: string, rows: any[], natural: string, cur: string) => {
                const t = rows.reduce((s, r) => s + amt(r, natural), 0);
                return { rows: <><tr><td colSpan={2} className="pt-4 sd-label">{title}</td></tr>{rows.map((r, i) => <tr key={i}><td>{`${r.account_code} · ${r.name}`}</td><td className="text-right money">{fmt(cur, amt(r, natural))}</td></tr>)}
                    <tr className="font-bold"><td>{`Total ${title.toLowerCase()}`}</td><td className="text-right money">{fmt(cur, t)}</td></tr></>, total: t };
            };
            const cards: ReactNode[] = [];
            if (kind === 'tb') Object.entries(byCur(d.to_date)).forEach(([cur, rows]) => {
                const dr = rows.reduce((s, r) => s + Math.max(0, r.debit - r.credit), 0), cr = rows.reduce((s, r) => s + Math.max(0, r.credit - r.debit), 0);
                cards.push(<div key={cur} className="bg-white rounded-[1.5rem] border border-gray-100 p-5"><p className="font-extrabold mb-2">{`Trial balance · ${cur} · to ${day(d.to)}`}</p><table className="rep w-full text-xs"><thead><tr className="sd-label text-left"><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody>
                    {rows.map((r, i) => { const n = r.debit - r.credit; return <tr key={i}><td>{`${r.account_code} · ${r.name}`}</td><td className="text-right money">{n > 0 ? fmt(cur, n) : ''}</td><td className="text-right money">{n < 0 ? fmt(cur, -n) : ''}</td></tr>; })}
                    <tr className="total"><td>{`Total ${Math.abs(dr - cr) < 0.0005 ? '✓ balanced' : '⚠ out of balance'}`}</td><td className="text-right money">{fmt(cur, dr)}</td><td className="text-right money">{fmt(cur, cr)}</td></tr></tbody></table></div>);
            });
            else if (kind === 'pl') Object.entries(byCur(d.period)).forEach(([cur, rows]) => {
                const inc = section('Income', rows.filter(r => r.type === 'income'), 'credit', cur), exp = section('Expenses', rows.filter(r => r.type === 'expense'), 'debit', cur);
                cards.push(<div key={cur} className="bg-white rounded-[1.5rem] border border-gray-100 p-5"><p className="font-extrabold mb-2">{`Profit & loss · ${cur} · ${day(d.from)} – ${day(d.to)}`}</p><table className="rep w-full text-xs"><tbody>{inc.rows}{exp.rows}
                    <tr className="total"><td>{`Net ${inc.total - exp.total >= 0 ? 'profit' : 'loss'}`}</td><td className={`text-right money ${inc.total - exp.total < 0 ? 'text-[#D55C48]' : 'text-emerald-600'}`}>{money(cur, inc.total - exp.total)}</td></tr></tbody></table></div>);
            });
            else Object.entries(byCur(d.to_date)).forEach(([cur, rows]) => {
                const a = section('Assets', rows.filter(r => r.type === 'asset'), 'debit', cur), l = section('Liabilities', rows.filter(r => r.type === 'liability'), 'credit', cur);
                const eqRows = rows.filter(r => r.type === 'equity'), earnings = rows.filter(r => ['income', 'expense'].includes(r.type)).reduce((s, r) => s + r.credit - r.debit, 0);
                const e = section('Equity', [...eqRows, { account_code: '—', name: 'Retained earnings (profit to date)', debit: 0, credit: earnings }], 'credit', cur);
                cards.push(<div key={cur} className="bg-white rounded-[1.5rem] border border-gray-100 p-5"><p className="font-extrabold mb-2">{`Balance sheet · ${cur} · at ${day(d.to)}`}</p><table className="rep w-full text-xs"><tbody>{a.rows}{l.rows}{e.rows}
                    <tr className="total"><td>{`Liabilities + equity ${Math.abs(a.total - l.total - e.total) < 0.0005 ? '✓' : '⚠'}`}</td><td className="text-right money">{money(cur, l.total + e.total)}</td></tr></tbody></table></div>);
            });
            return <>{toolbar(opts([['pl', 'Profit & loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance']], 'data-report', kind, k => setCache('report', k)),
                <button type="button" className="btn btn-light" onClick={() => window.print()}><Icon name="clipboard" />Print</button>)}
                <p className="text-[11px] text-gray-400 mb-3">{`${d.branch ? 'Branch ' + d.branch : 'All branches'} · each currency is reported on its own.`}</p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{cards.length ? cards : emptyBox('No postings yet.', 'col-span-full p-10')}</div></>;
        },
        journal: d => {
            const name = (c: string) => d.accounts.find((a: any) => a.code === c)?.name || c;
            return <>{toolbar(<select id="jAcct" className="field !py-2 !w-64 text-xs" defaultValue={cache.current.jAcct || ''} onChange={e => setCache('jAcct', e.target.value)}><option value="">All accounts</option>{d.accounts.map((a: any) => <option key={a.code} value={a.code}>{`${a.code} · ${a.name}`}</option>)}</select>,
                addBtn('Manual journal', newJournal))}
                {table([['Date'], ['Memo'], ['Lines'], ['Cur.']], d.entries.map((e: any) => (
                    <tr key={e.id}>
                        <td className="p-3 pl-4" data-label="Date">{day(e.entry_date)}<span className="block text-[10px] text-gray-400">{`#${e.id} · ${e.branch_code}`}</span></td>
                        <td className="p-3" data-label="Memo"><span className="font-bold">{e.memo || ''}</span><span className="block text-[10px] text-gray-400">{`${e.source} · ${e.created_by_name || ''}`}</span></td>
                        <td className="p-3" data-label="Lines">{e.journal_lines.map((l: any, i: number) => <div key={i} className="flex justify-between gap-4"><span className={+l.credit ? 'pl-4 text-gray-500' : ''}>{`${l.account_code} ${name(l.account_code)}`}</span><span className="money">{+l.debit ? 'Dr ' + fmt(e.currency, l.debit) : 'Cr ' + fmt(e.currency, l.credit)}</span></div>)}</td>
                        <td className="p-3 pr-4" data-label="Currency"><span className="pill-tag pill-gray">{e.currency}</span></td></tr>)), 'No journal entries in this period.')}</>;
        },
        chart: d => <>{toolbar(<p className="text-xs text-gray-500">Codes: 1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx expenses.</p>, addBtn('New account', () => editAccount()))}
            {table([['Code'], ['Name'], ['Type'], ['']], d.accounts.map((a: any) => (
                <tr key={a.code} className={`${a.active ? '' : 'opacity-50'} hover:bg-[#F8F8FA] cursor-pointer`} data-acct={a.code} onClick={() => editAccount(a.code)}>
                    <td className="p-3 pl-4 font-mono font-extrabold" data-label="Code">{a.code}</td><td className="p-3" data-label="Name">{a.name}</td>
                    <td className="p-3" data-label="Type"><span className="pill-tag pill-gray">{a.type}</span></td><td className="p-3 pr-4" data-label="">{a.active ? '' : 'Inactive'}</td></tr>)), 'No accounts.')}</>
    };

    const filterChanged = (k: 'from' | 'to' | 'branch', v: string) => { const next = { ...F.current, [k]: v }; F.current = next; setDates(next); setRangeS(''); show(); };

    const popups = (
        <Modal id="formModal" open={formOpen} onClose={() => setFormOpen(false)} panelClassName="max-w-2xl" form={{ id: 'form', onSubmit: submitForm }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div><h3 id="formTitle" className="text-lg font-extrabold">{spec.title}</h3><p id="formSub" className="text-xs text-gray-400 mt-0.5">{spec.sub}</p></div>
                <FormClose />
            </div>
            <div id="formBody" className="my-5 overflow-y-auto custom-scrollbar pr-1"><Fragment key={spec.n}>{spec.body}</Fragment></div>
            <div className="flex flex-wrap justify-between gap-2 pt-4 border-t border-gray-100">
                <div id="formExtra" className="flex flex-wrap gap-2">{spec.extra}</div>
                <div className="flex gap-2"><FormClose text="Close" /><button id="formOk" className={`${okClass}${spec.hasSave ? '' : ' hidden'}`} disabled={saving}>{spec.okText}</button></div>
            </div>
        </Modal>
    );

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
                <section className="flex flex-col xl:flex-row xl:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="cash" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Accounts</span><span id="scopePill" className="pill-tag pill-gray">{ctx.loaded ? (ctx.full ? 'Full accounting' : `Branch ${ctx.my_branch || ''}`) : ''}</span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{'Invoices • receipts • expenses • cash • reports — per currency'}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <div id="branchWrap" className={ctx.full ? '' : 'hidden'}><label className="ui-label" htmlFor="fBranch">Branch</label><select id="fBranch" className="field !py-2 !w-52" value={dates.branch} onChange={e => filterChanged('branch', e.target.value)}>
                            {ctx.full && <><option value="">All branches</option>{ctx.branches.map((b: any) => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} · ${b.currency || ''}`}</option>)}</>}</select></div>
                        <div><label className="ui-label" htmlFor="fFrom">From</label><input id="fFrom" type="date" className="field !py-2 !w-40" value={dates.from} onChange={e => filterChanged('from', e.target.value)} /></div>
                        <div><label className="ui-label" htmlFor="fTo">To</label><input id="fTo" type="date" className="field !py-2 !w-40" value={dates.to} onChange={e => filterChanged('to', e.target.value)} /></div>
                        <div className="flex gap-1 bg-[#F8F8FA] p-1 rounded-full">
                            {([['today', 'Today'], ['month', 'Month'], ['year', 'Year']] as const).map(([k, l]) => <button key={k} type="button" className="opt px-3 py-1.5 rounded-full text-[11px] font-extrabold" data-range={k} aria-pressed={range === k} onClick={() => { setRange(k); show(); }}>{l}</button>)}
                        </div>
                    </div>
                </section>

                <div id="tabs" className="flex flex-wrap gap-1.5 bg-[#F8F8FA] p-1.5 rounded-[1.5rem] w-fit mb-5" role="tablist">
                    {ctx.loaded && TABS.filter(([, , fullOnly]) => !fullOnly || ctx.full).map(([k, l]) => <button key={k} type="button" className="tab px-4 py-2 rounded-full text-xs font-extrabold" data-tab={k} aria-selected={k === tab} onClick={() => setTab(k)}>{l}</button>)}
                </div>
                <div id="panel">
                    {view.kind === 'loading' ? <div className="h-40 flex items-center justify-center text-xs font-bold text-gray-300 animate-pulse">{'Loading…'}</div>
                        : view.kind === 'error' ? <div key={view.n} className="ui-fade">{view.init ? <p className="p-10 text-center text-sm text-gray-500 bg-[#F8F8FA] rounded-[2rem]">{view.msg}</p> : <p className="p-6 text-xs text-coral-600 bg-[#FFF5F3] rounded-2xl">{view.msg}</p>}</div>
                            : view.kind === 'ok' ? <div key={view.n} className="ui-fade">{RENDER[view.tab](view.d)}</div> : null}
                </div>
            </div>
        </AppFrame>
    );
}
