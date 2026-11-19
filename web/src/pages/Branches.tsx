// Branch Network — same page as admin/branches.html (super admin and head office only): Branches (cards, add / edit /
// dismiss, country → state → city, postcode lookup, reference preview, attendance location), Destination codes and
// Cargo types. Data: /api/branches, /api/codes
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/RowMenu';
import { Combobox, type ComboboxHandle } from '../components/fields/Combobox';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { PostalLookup, type Place } from '../components/fields/PostalLookup';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { citiesOf, countries, countryItems, statesOf, type Item } from '../lib/geo';
import { hrefFor } from '../lib/pages';
import { session } from '../lib/session';
import { toast } from '../lib/toast';
import type { IconName } from '../lib/icons';
import './branches.css';

const flag = (cc?: string) => cc ? `https://flagcdn.com/w40/${cc.toLowerCase()}.png` : '';
const findCountry = (text?: string) => { const t = String(text || '').trim().toLowerCase(); return countries().find(c => c.n.toLowerCase() === t || c.c.toLowerCase() === t) || null; };
// common Al-Farha city → branch code suggestions
const CITY_CODE_MAP: Record<string, string> = { SALALAH: 'ALFSLL', SANAIYA: 'ALFSNY', SANNAYYA: 'ALFSNY', MUSCAT: 'ALFMCT', SEEB: 'ALFSEB', SOHAR: 'ALFSHR', NIZWA: 'ALFNZW',
    THUMRAIT: 'ALFTMT', DUQM: 'ALFDQM', PAYANGADI: 'ALFPYD', KANNUR: 'ALFKNR', KOZHIKODE: 'ALFCCJ', KOCHI: 'ALFCOK', RIYADH: 'ALFRUH', JEDDAH: 'ALFJED', DUBAI: 'ALFDXB' };
const TAB_LABEL = { branches: 'Add branch', destinations: 'Add destination code', cargo: 'Add cargo type' } as const;
type Tab = keyof typeof TAB_LABEL;
const isDismissed = (b: any) => (b.status || '') === 'Dismissed';
const CURRENCIES = ['OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'INR', 'NPR', 'LKR', 'PKR', 'BDT', 'PHP', 'EGP', 'USD'];
const TZS = ['Asia/Muscat', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Colombo', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Manila', 'Africa/Cairo', 'Europe/London'];

function CloseX({ cls }: { cls: string }) {
    const dismiss = useDismiss();
    return <button type="button" onClick={dismiss} aria-label="Close" className={cls}><Icon name="x" /></button>;
}
function CancelBtn() {
    const dismiss = useDismiss();
    return <button type="button" className="btn btn-light" onClick={dismiss}>Cancel</button>;
}

export function Branches() {
    const allowed = ['super_admin', 'head_office'].includes(session.role());
    useEffect(() => { if (!allowed) { const t = hrefFor('super-dashboard.html'); location.replace('to' in t ? '/app' + t.to : t.href); } }, [allowed]);

    const [branches, setBranches] = useState<any[] | null>(null);
    const [managers, setManagers] = useState<any[]>([]);
    const [destinations, setDestinations] = useState<any[] | null>(null);
    const [cargoTypes, setCargoTypes] = useState<any[] | null>(null);
    const [tab, setTabState] = useState<Tab>(() => { try { const s = localStorage.getItem('alf_branch_tab') as Tab; return s in TAB_LABEL ? s : 'branches'; } catch { return 'branches'; } });
    const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem('alf_branch_tab', t); } catch { /* ignore */ } };
    const [q, setQ] = useState(''), [statusF, setStatusF] = useState('active');

    async function loadAll() {
        try {
            const [b, c] = await Promise.all([api('/api/branches'), api('/api/codes')]);
            setBranches(b.branches || []); setManagers(b.managers || []);
            setDestinations(c.destinations || []); setCargoTypes(c.cargo_types || []);
        } catch (e) { toast(false, (e as Error).message); }
    }
    useEffect(() => { loadAll(); }, []);

    // ---------- branch form ----------
    const [bOpen, setBOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const blank = { name: '', code: '', manual: false, digit: '', postal: '', po: '', street: '', manager: '', currency: 'OMR', taxName: 'VAT', taxRate: '0', hub: false, type: 'branch', lat: '', lng: '', fence: '200', tz: 'Asia/Muscat', pvDest: '', pvCargo: '' };
    const [f, setF] = useState(blank);
    const fRef = useRef(f); fRef.current = f;
    const [, bump] = useState(0);
    const rerender = () => bump(n => n + 1);
    const [stateOn, setStateOn] = useState(false), [cityOn, setCityOn] = useState(false);
    const [statePh, setStatePh] = useState('Select country first'), [cityPh, setCityPh] = useState('Select state first');
    const [bBusy, setBBusy] = useState(false), [hereBusy, setHereBusy] = useState(false);
    const countryBox = useRef<ComboboxHandle>(null), stateBox = useRef<ComboboxHandle>(null), cityBox = useRef<ComboboxHandle>(null);
    const curState = useRef<Item | null>(null);
    const phone = useRef<PhoneHandle>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    const countryText = () => countryBox.current?.text || '';
    const composeAddress = () => [f.street, f.po, cityBox.current?.text || '', stateBox.current?.text || '', f.postal, countryText()].map(v => v.trim()).filter(Boolean).join(', ') || '—';
    const suggestCode = (next: typeof f) => {
        if (next.manual) return next;
        const city = cityBox.current?.text || '';
        const words = `${next.po} ${city} ${next.name}`.toUpperCase();
        const hit = Object.entries(CITY_CODE_MAP).find(([k]) => words.includes(k));
        const src = (city || next.po || next.name.replace(/al[- ]?farha|cargo/gi, '')).toUpperCase().replace(/[^A-Z]/g, '');
        return { ...next, code: hit ? hit[1] : (src.length >= 3 ? `ALF${src.slice(0, 3)}` : next.code) };
    };
    const nextFreeDigit = (ed: any) => {
        const used = new Set((branches || []).filter(b => (!ed || b.id !== ed.id) && (b.branch_type || 'branch') === 'branch').map(b => String(b.booking_code)));
        for (let i = 1; i < 100; i++) if (!used.has(String(i))) return String(i);
        return '';
    };
    // Main Office and the warehouse make no bookings: their digit is 0 and need not be unique
    const noBookings = f.type !== 'branch';
    const digit = noBookings ? '0' : f.digit.trim() || '?';
    const clash = noBookings ? undefined : (branches || []).find(b => (!editing || b.id !== editing.id) && (b.branch_type || 'branch') === 'branch' && String(b.booking_code) === digit);

    const openBranch = async (code?: string) => {
        const ed = code ? branches!.find(b => b.branch_code === code) : null;
        const b = ed || {};
        setEditing(ed);
        const c = findCountry(b.country || 'Oman');
        const activeDest = (destinations || []).filter(d => d.active);
        setF({ ...blank, name: b.branch_name || '', code: b.branch_code || '', manual: !!ed, digit: b.booking_code || nextFreeDigit(ed), postal: b.postal_code || '', po: b.post_office || '',
            street: ed ? (b.address || '').split(',')[0] : '', manager: b.manager_id || '', currency: b.currency || 'OMR', taxName: b.tax_name || 'VAT', taxRate: String(b.tax_rate ?? 0),
            hub: Boolean(b.is_hub), type: b.branch_type || 'branch', lat: b.lat ?? '', lng: b.lng ?? '', fence: String(b.geofence_m ?? 200), tz: b.timezone || 'Asia/Muscat',
            pvDest: activeDest.some(d => d.code === '3') ? '3' : activeDest[0]?.code || 'DE', pvCargo: (cargoTypes || []).filter(t => t.active)[0]?.code || '' });
        phone.current?.reset(c ? c.c : 'OM');
        if (b.phone_number) phone.current?.setValue(b.phone_number, c ? c.c : 'OM');
        setBOpen(true); setTimeout(() => nameRef.current?.focus(), 0);
        await countryBox.current?.setValue(c ? c.c : '');
        curState.current = null; stateBox.current?.reload(); cityBox.current?.reload();
        setStateOn(!!c); setStatePh(c ? 'Select or type state' : 'Select country first');
        await stateBox.current?.setValue(b.state || '');
        curState.current = stateBox.current?.value || null;
        setCityOn(!!curState.current || !!b.location); setCityPh('Select or type city');
        await cityBox.current?.setValue(b.location || '');
        rerender();
    };
    const onCountry = (it: Item | null) => {
        if (it) phone.current?.setCountry(it.value, { soft: true });
        curState.current = null;
        stateBox.current?.reload(); stateBox.current?.clear(); cityBox.current?.reload(); cityBox.current?.clear();
        setStateOn(!!it); setStatePh(it ? 'Select or type state' : 'Select country first');
        setCityOn(false); setCityPh('Select state first');
        if (it) stateBox.current?.preload();
        rerender();
    };
    const onState = (it: Item | null) => {
        curState.current = it;
        cityBox.current?.reload(); cityBox.current?.clear();
        setCityOn(!!it); setCityPh(it ? 'Select or type city' : 'Select state first');
        if (it) cityBox.current?.preload();
        rerender();
    };
    const onCity = (it: Item | null) => {
        setF(v => suggestCode({ ...v, postal: it?.postalCode || v.postal }));   // Oman towns carry their postal code
        rerender();
    };
    const onPostalPick = async (l: Place) => {
        const street = [l.building && `Bldg ${l.building}`, l.street, l.shortAddress && `Short address ${l.shortAddress}`, l.additionalNumber && `Addl no ${l.additionalNumber}`].filter(Boolean).join(', ');
        setF(v => ({ ...v, postal: l.postalCode || v.postal, po: l.postOffice || '', street: street || v.street }));
        await stateBox.current?.setValue(l.state || '');
        curState.current = stateBox.current?.value || null; setCityOn(true);
        await cityBox.current?.setValue(l.city || l.postOffice || '');
        setF(v => suggestCode(v)); rerender();
    };
    const useHere = () => {
        if (!navigator.geolocation) return toast(false, 'This device cannot share its location.');
        setHereBusy(true);
        navigator.geolocation.getCurrentPosition(p => {
            setF(v => ({ ...v, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); setHereBusy(false);
            toast(true, `Location set (accurate to about ${Math.round(p.coords.accuracy)} m).`);
        }, err => { setHereBusy(false); toast(false, err.code === 1 ? 'Location is blocked for this site — allow it in the browser.' : 'Could not get the location.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
    const lat = parseFloat(f.lat), lng = parseFloat(f.lng), mapOk = Number.isFinite(lat) && Number.isFinite(lng);

    async function saveBranch(e: React.FormEvent) {
        e.preventDefault();
        const c = findCountry(countryText());
        const city = (cityBox.current?.text || '').trim();
        const vals: Record<string, string> = { b_name: f.name, b_code: f.code, b_digit: noBookings ? '0' : f.digit, b_city: city, b_phone: phone.current?.value || '' };
        const need = ([['b_name', 'Branch name'], ['b_code', 'Branch code'], ['b_digit', 'AWB digit'], ['b_city', 'City'], ['b_phone', 'Phone']] as [string, string][]).find(([id]) => !vals[id].trim())
            || (!phone.current?.valid ? ['b_phone', 'a valid phone number'] : null);
        if (need) { toast(false, `${need[1]} is required.`); return document.getElementById(need[0])?.focus(); }
        if (!c) { toast(false, 'Choose a country from the list.'); return document.getElementById('b_country')?.focus(); }
        if (clash) return toast(false, `AWB digit ${digit} is already used by ${clash.branch_name}. Each branch needs its own digit.`);
        const mgr = managers.find(m => m.id === f.manager);
        const address = composeAddress();
        const body = {
            id: editing?.id, branchName: f.name.trim(), branchCode: f.code.trim(), bookingCode: noBookings ? '0' : f.digit.trim(),
            country: c.n, postalCode: f.postal.trim(), postOffice: f.po.trim(), state: (stateBox.current?.text || '').trim(),
            location: city, address: address === '—' ? city : address,
            phoneNumber: phone.current!.value, managerId: mgr ? mgr.id : null, managerName: mgr ? (mgr.full_name || mgr.username) : 'Unassigned',
            currency: f.currency, taxName: f.taxName.trim(), taxRate: f.taxRate, isHub: f.hub, branchType: f.type,
            lat: String(f.lat).trim(), lng: String(f.lng).trim(), geofence: f.fence, timezone: f.tz, status: editing?.status
        };
        if (!await confirm({ title: editing ? `Save changes to ${body.branchName}?` : 'Create this branch?', confirmText: editing ? 'Save changes' : 'Create branch',
            message: <><b>{body.branchName}</b>{` · ${body.branchCode} · AWB digit `}<b>{body.bookingCode}</b><br />{`${body.location}, ${body.country} · ${body.currency}`}</> })) return;
        setBBusy(true);
        try { await api('/api/branches', { method: editing ? 'PUT' : 'POST', body }); toast(true, editing ? 'Branch updated.' : 'Branch created.'); setBOpen(false); loadAll(); }
        catch (err) { toast(false, (err as Error).message); }
        setBBusy(false);
    }
    const setStatus = async (b: any, status: string) => {
        const dismiss = status === 'Dismissed';
        if (!await confirm(dismiss
            ? { title: `Dismiss ${b.branch_name}?`, message: 'It disappears from booking and transfer choices. Its history stays, and you can reactivate it any time.', confirmText: 'Dismiss', danger: true }
            : { title: `Reactivate ${b.branch_name}?`, message: 'It becomes available again for bookings and transfers.', confirmText: 'Reactivate' })) return;
        try { await api('/api/branches', { method: 'PATCH', body: { id: b.id, status } }); toast(true, dismiss ? 'Branch dismissed.' : 'Branch reactivated.'); loadAll(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const branchMenu = (btn: Element, b: any) => openMenu(btn, <>
        <button type="button" onClick={() => openBranch(b.branch_code)}><Icon name="edit" />{' Edit branch'}</button>
        <hr />
        {isDismissed(b) ? <button type="button" onClick={() => setStatus(b, 'Optimal')}><Icon name="checkCircle" />{' Reactivate'}</button>
            : <button type="button" className="danger" onClick={() => setStatus(b, 'Dismissed')}><Icon name="ban" />{' Dismiss branch'}</button>}
    </>);

    // ---------- destination codes ----------
    const [dOpen, setDOpen] = useState(false);
    const [destEditing, setDestEditing] = useState<any>(null);
    const [dCode, setDCode] = useState(''), [dActive, setDActive] = useState(true);
    const dCountry = useRef<ComboboxHandle>(null);
    const dCodeRef = useRef<HTMLInputElement>(null);
    const openDest = (cc?: string) => {
        const ed = cc ? destinations!.find(d => d.country_code === cc) : null;
        setDestEditing(ed);
        const used = new Set((destinations || []).map(d => d.code));
        let free = ''; for (let i = 1; i < 100; i++) if (!used.has(String(i))) { free = String(i); break; }
        setDCode(ed ? ed.code : free); setDActive(ed ? ed.active : true);
        if (ed) dCountry.current?.setText(countries().find(x => x.c === cc)?.n || ed.country_name); else dCountry.current?.clear();
        setDOpen(true);
        setTimeout(() => (ed ? dCodeRef.current : document.getElementById('d_country') as HTMLInputElement)?.focus(), 0);
    };
    const saveDest = async (e: React.FormEvent) => {
        e.preventDefault();
        const c = destEditing ? countries().find(x => x.c === destEditing.country_code) || { c: destEditing.country_code, n: destEditing.country_name } : findCountry(dCountry.current?.text);
        if (!c) return toast(false, 'Choose a country from the list.');
        try {
            await api('/api/codes', { method: 'POST', body: { type: 'destination', country_code: c.c, country_name: c.n, code: dCode.trim(), active: dActive } });
            toast(true, `${c.n} → code ${dCode.trim()}`); setDOpen(false); loadAll();
        } catch (err) { toast(false, (err as Error).message); }
    };
    const deleteDest = async (d: any) => {
        if (!await confirm({ title: `Remove code ${d.code} (${d.country_name})?`, message: <>{`New ${d.country_name} bookings will use `}<b>{d.country_code}</b> and the shared 2-letter series. Existing references don't change.</>, confirmText: 'Remove', danger: true })) return;
        try { await api(`/api/codes?type=destination&key=${encodeURIComponent(d.country_code)}`, { method: 'DELETE' }); toast(true, 'Removed.'); loadAll(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const destMenu = (btn: Element, d: any) => openMenu(btn, <>
        <button type="button" onClick={() => openDest(d.country_code)}><Icon name="edit" />{' Edit code'}</button><hr />
        <button type="button" className="danger" onClick={() => deleteDest(d)}><Icon name="trash" />{' Remove'}</button>
    </>);

    // ---------- cargo types ----------
    const [cOpen, setCOpen] = useState(false);
    const [cargoEditing, setCargoEditing] = useState<any>(null);
    const [cf, setCf] = useState({ code: '', name: '', desc: '', sort: '', active: true });
    const cCodeRef = useRef<HTMLInputElement>(null), cNameRef = useRef<HTMLInputElement>(null);
    const openCargo = (code?: string) => {
        const ed = code ? cargoTypes!.find(t => t.code === code) : null;
        setCargoEditing(ed);
        setCf({ code: ed?.code || '', name: ed?.name || '', desc: ed?.description || '', sort: String(ed?.sort ?? ((cargoTypes || []).length + 1) * 10), active: ed ? ed.active : true });
        setCOpen(true); setTimeout(() => (ed ? cNameRef.current : cCodeRef.current)?.focus(), 0);
    };
    const saveCargo = async (e: React.FormEvent) => {
        e.preventDefault();
        try { await api('/api/codes', { method: 'POST', body: { type: 'cargo', code: cf.code.trim(), name: cf.name.trim(), description: cf.desc.trim(), sort: cf.sort, active: cf.active } }); toast(true, 'Cargo type saved.'); setCOpen(false); loadAll(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const primary = () => tab === 'branches' ? openBranch() : tab === 'destinations' ? openDest() : openCargo();

    if (!allowed) return null;
    const list = (branches || []).filter(b => (!statusF || (statusF === 'dismissed') === isDismissed(b)) &&
        (!q.trim() || [b.branch_name, b.branch_code, b.location, b.country, b.manager_name].some(v => String(v || '').toLowerCase().includes(q.trim().toLowerCase()))));
    const active = (branches || []).filter(b => !isDismissed(b));
    const tile = (label: string, n: number, dark = false) => <div key={label} className={`${dark ? 'bg-[#111827] text-white' : 'bg-[#F8F8FA] border border-gray-100'} rounded-[1.5rem] p-4`}>
        <p className="text-[10px] font-extrabold uppercase text-gray-400">{label}</p><p className="text-2xl font-extrabold mt-1">{n}</p></div>;
    const exDigit = (active[0] || {}).booking_code || '1';
    const exCargo = ((cargoTypes || []).find(t => t.active) || {}).code || '1';
    const cargoIcon = (n: string): IconName => /air/i.test(n) ? 'plane' : /sea|ocean/i.test(n) ? 'ship' : /road|land|truck/i.test(n) ? 'truck' : 'box';

    const popups = <>
        <Modal id="branchModal" open={bOpen} onClose={() => setBOpen(false)} panelClassName="max-w-3xl" form={{ id: 'branchForm', noValidate: true, autoComplete: 'off', onSubmit: saveBranch }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div>
                    <h3 id="branchFormTitle" className="text-lg font-extrabold">{editing ? `Edit ${editing.branch_name}` : 'Add branch'}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Identity, location, contact and finance settings.</p>
                </div>
                <CloseX cls="icon-btn bg-[#F8F8FA]" />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar my-5 pr-1 space-y-6">
                <fieldset className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Identity</legend>
                    <div className="sm:col-span-3"><label className="ui-label" htmlFor="b_name">Branch name <span className="req">*</span></label><input id="b_name" ref={nameRef} className="field" placeholder="e.g. Al-Farha Cargo Salalah" value={f.name} onChange={e => setF(suggestCode({ ...f, name: e.target.value }))} /></div>
                    <div className="sm:col-span-2"><label className="ui-label" htmlFor="b_code">Branch code <span className="req">*</span></label><input id="b_code" className="field uppercase font-mono" maxLength={6} placeholder="ALFSLL" value={f.code} onChange={e => setF({ ...f, manual: true, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) })} /></div>
                    <div className="sm:col-span-1"><label className="ui-label" htmlFor="b_digit">AWB digit {noBookings ? <span className="text-gray-400 normal-case">(no bookings)</span> : <span className="req">*</span>}</label><input id="b_digit" className="field font-mono text-center" maxLength={2} placeholder="1" disabled={noBookings} title={noBookings ? 'Main Office and the warehouse make no bookings, so their AWB digit is 0.' : undefined} value={noBookings ? '0' : f.digit} onChange={e => setF({ ...f, digit: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) })} /></div>
                </fieldset>

                <div className="rounded-[1.5rem] bg-[#111827] text-white p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Booking reference preview</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-base sm:text-lg">
                                <span id="pvD" className="ref-token bg-emerald-500/20 text-emerald-300">{bOpen ? f.pvDest || '3' : '3'}</span>
                                <span id="pvB" className="ref-token bg-coral-500 text-white">{bOpen ? digit : '1'}</span>
                                <span id="pvC" className="ref-token bg-sky-500/20 text-sky-300">{bOpen ? f.pvCargo || '1' : '1'}</span>
                                <span className="ref-token bg-white/10">000001</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                            <select id="pvDest" className="field !bg-gray-800 !border-gray-700 !text-white !py-2 !text-xs" aria-label="Example destination" value={f.pvDest} onChange={e => setF({ ...f, pvDest: e.target.value })}>
                                {bOpen && <>{(destinations || []).filter(d => d.active).map(d => <option key={d.code} value={d.code}>{`${d.code} · ${d.country_name}`}</option>)}<option value="DE">DE · any other country</option></>}
                            </select>
                            <select id="pvCargo" className="field !bg-gray-800 !border-gray-700 !text-white !py-2 !text-xs" aria-label="Example cargo type" value={f.pvCargo} onChange={e => setF({ ...f, pvCargo: e.target.value })}>
                                {bOpen && (cargoTypes || []).filter(t => t.active).map(t => <option key={t.code} value={t.code}>{`${t.code} · ${t.name}`}</option>)}
                            </select>
                        </div>
                    </div>
                    <p id="digitWarn" className={`${bOpen && clash ? '' : 'hidden '}mt-3 text-[11px] font-bold text-coral-300`}>{clash ? `AWB digit ${digit} is already used by ${clash.branch_name}. Each branch needs its own digit.` : ''}</p>
                </div>

                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Location</legend>
                    <div><label className="ui-label" htmlFor="b_country">Country <span className="req">*</span></label><Combobox ref={countryBox} load={countryItems} onSelect={onCountry} inputProps={{ id: 'b_country', className: 'field', placeholder: 'Select country' }} /></div>
                    <div><label className="ui-label" htmlFor="b_state">State / governorate</label><Combobox ref={stateBox} allowCustom emptyText="No states listed — type one" onSelect={onState}
                        load={() => { const c = findCountry(countryText()); return c ? statesOf(c.c) : []; }} inputProps={{ id: 'b_state', className: 'field', placeholder: statePh, disabled: !stateOn, onChange: rerender }} /></div>
                    <div><label className="ui-label" htmlFor="b_city">City <span className="req">*</span></label><Combobox ref={cityBox} allowCustom emptyText="No cities listed — type one" onSelect={onCity}
                        load={() => { const c = findCountry(countryText()); return c && curState.current ? citiesOf(c.n, curState.current.value) : []; }} inputProps={{ id: 'b_city', className: 'field', placeholder: cityPh, disabled: !cityOn, onChange: () => { setF(v => suggestCode(v)); rerender(); } }} /></div>
                    <div className="relative">
                        <label className="ui-label" htmlFor="b_postal">Postal / ZIP / short address</label>
                        <PostalLookup value={f.postal} onChange={v => setF({ ...f, postal: v })} country={() => findCountry(countryText())?.c || ''} onPick={onPostalPick}
                            badgeId="postalBadge" listId="postalList" inputProps={{ id: 'b_postal', className: 'field !pr-24', placeholder: 'e.g. 211, 670561, SW1A 1AA', autoComplete: 'off' }} />
                    </div>
                    <div><label className="ui-label" htmlFor="b_po">Post office / area</label><input id="b_po" className="field" placeholder="Locality" value={f.po} onChange={e => setF(suggestCode({ ...f, po: e.target.value }))} /></div>
                    <div><label className="ui-label" htmlFor="b_street">Street / building</label><input id="b_street" className="field" placeholder="Building, street" value={f.street} onChange={e => setF({ ...f, street: e.target.value })} /></div>
                    <div className="sm:col-span-2"><label className="ui-label">Full address (auto)</label>
                        <p id="b_address" className="field soft !font-medium text-gray-600 min-h-[46px]">{bOpen ? composeAddress() : '—'}</p></div>
                </fieldset>

                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Contact</legend>
                    <div>
                        <label className="ui-label" htmlFor="b_phone">Phone <span className="req">*</span></label>
                        <PhoneField ref={phone} country="OM" inputProps={{ id: 'b_phone', className: 'field', placeholder: 'Phone number' }} />
                    </div>
                    <div><label className="ui-label" htmlFor="b_manager">Branch manager</label><select id="b_manager" className="field" value={f.manager} onChange={e => setF({ ...f, manager: e.target.value })}>
                        {bOpen && <><option value="">Unassigned</option>{managers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.username}</option>)}</>}</select></div>
                </fieldset>

                <fieldset className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Finance</legend>
                    <div><label className="ui-label" htmlFor="b_currency">Currency</label>
                        <select id="b_currency" className="field" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="ui-label" htmlFor="b_taxName">Tax name</label><input id="b_taxName" className="field" placeholder="VAT" value={f.taxName} onChange={e => setF({ ...f, taxName: e.target.value })} /></div>
                    <div><label className="ui-label" htmlFor="b_taxRate">Tax rate %</label><input id="b_taxRate" className="field" type="number" min="0" max="100" step="0.01" placeholder="0 = no tax" value={f.taxRate} onChange={e => setF({ ...f, taxRate: e.target.value })} /></div>
                    <div><label className="ui-label">Hub</label>
                        <label className="field flex items-center gap-2 cursor-pointer"><input id="b_hub" type="checkbox" className="w-4 h-4" checked={f.hub} onChange={e => setF({ ...f, hub: e.target.checked })} /><span className="text-xs font-bold">Hub branch</span></label></div>
                    <div className="sm:col-span-2"><label className="ui-label" htmlFor="b_type">Type</label><select id="b_type" className="field" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="branch">Branch (customer counter)</option><option value="warehouse">Central warehouse (stocks materials for branches, gathers &amp; consolidates)</option><option value="main_office">Main Office (company cash &amp; bank — only one)</option></select></div>
                </fieldset>
                <fieldset className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Attendance — staff check in here</legend>
                    <div><label className="ui-label" htmlFor="b_lat">Latitude</label><input id="b_lat" className="field" inputMode="decimal" placeholder="23.5880" value={f.lat} onChange={e => setF({ ...f, lat: e.target.value })} /></div>
                    <div><label className="ui-label" htmlFor="b_lng">Longitude</label><input id="b_lng" className="field" inputMode="decimal" placeholder="58.3829" value={f.lng} onChange={e => setF({ ...f, lng: e.target.value })} /></div>
                    <div><label className="ui-label" htmlFor="b_fence">Allowed distance (m)</label><input id="b_fence" className="field" type="number" min="30" max="5000" step="10" placeholder="200" value={f.fence} onChange={e => setF({ ...f, fence: e.target.value })} /></div>
                    <div><label className="ui-label" htmlFor="b_tz">Time zone</label><select id="b_tz" className="field" value={f.tz} onChange={e => setF({ ...f, tz: e.target.value })}>{TZS.map(t => <option key={t}>{t}</option>)}</select></div>
                    <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center gap-2">
                        <button type="button" id="b_here" className="btn btn-light btn-sm" disabled={hereBusy} onClick={useHere}><Icon name="pin" />Use my current location</button>
                        <a id="b_map" target="_blank" rel="noopener" className={`btn btn-light btn-sm${mapOk ? '' : ' hidden'}`} href={mapOk ? `https://www.google.com/maps?q=${lat},${lng}` : undefined}><Icon name="globe" />Check on map</a>
                        <span className="text-[11px] text-gray-400">Stand inside the branch and tap the button. Leave empty to allow check-in from anywhere.</span>
                    </div>
                </fieldset>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <CancelBtn />
                <button id="branchSave" className="btn btn-coral" disabled={bBusy}>Save branch</button>
            </div>
        </Modal>

        <Modal id="destModal" open={dOpen} onClose={() => setDOpen(false)} panelClassName="max-w-md" form={{ id: 'destForm', onSubmit: saveDest }}>
            <h3 id="destTitle" className="text-lg font-extrabold">{destEditing ? `Edit ${destEditing.country_name}` : 'Add destination code'}</h3>
            <p className="text-xs text-gray-400 mt-1">Give a frequent country its own number in the reference.</p>
            <div className="grid grid-cols-3 gap-3 mt-5">
                <div className="col-span-2"><label className="ui-label" htmlFor="d_country">Country</label><Combobox ref={dCountry} load={countryItems} inputProps={{ id: 'd_country', className: 'field', placeholder: 'Select countrye to search…', disabled: !!destEditing }} /></div>
                <div><label className="ui-label" htmlFor="d_code">Code</label><input id="d_code" ref={dCodeRef} className="field font-mono text-center" inputMode="numeric" maxLength={2} placeholder="e.g. 1" value={dCode} onChange={e => setDCode(e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 mt-4 cursor-pointer"><input id="d_active" type="checkbox" className="w-4 h-4" checked={dActive} onChange={e => setDActive(e.target.checked)} /><span className="text-xs font-bold">Active</span></label>
            <div className="flex justify-end gap-2 mt-6">
                <CancelBtn />
                <button className="btn btn-dark">Save</button>
            </div>
        </Modal>

        <Modal id="cargoModal" open={cOpen} onClose={() => setCOpen(false)} panelClassName="max-w-md" form={{ id: 'cargoForm', onSubmit: saveCargo }}>
            <h3 id="cargoTitle" className="text-lg font-extrabold">{cargoEditing ? `Edit ${cargoEditing.name}` : 'Add cargo type'}</h3>
            <div className="grid grid-cols-3 gap-3 mt-5">
                <div><label className="ui-label" htmlFor="c_code">Code</label><input id="c_code" ref={cCodeRef} className="field font-mono text-center uppercase" maxLength={2} placeholder="4" disabled={!!cargoEditing} value={cf.code} onChange={e => setCf({ ...cf, code: e.target.value })} /></div>
                <div className="col-span-2"><label className="ui-label" htmlFor="c_name">Name</label><input id="c_name" ref={cNameRef} className="field" placeholder="e.g. Air Express" value={cf.name} onChange={e => setCf({ ...cf, name: e.target.value })} /></div>
                <div className="col-span-3"><label className="ui-label" htmlFor="c_desc">Description</label><input id="c_desc" className="field" placeholder="Optional" value={cf.desc} onChange={e => setCf({ ...cf, desc: e.target.value })} /></div>
                <div><label className="ui-label" htmlFor="c_sort">Order</label><input id="c_sort" className="field" type="number" placeholder="40" value={cf.sort} onChange={e => setCf({ ...cf, sort: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 mt-4 cursor-pointer"><input id="c_active" type="checkbox" className="w-4 h-4" checked={cf.active} onChange={e => setCf({ ...cf, active: e.target.checked })} /><span className="text-xs font-bold">Active (shown in booking form)</span></label>
            <div className="flex justify-end gap-2 mt-6">
                <CancelBtn />
                <button className="btn btn-dark">Save</button>
            </div>
        </Modal>
    </>;

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <section className="flex flex-col xl:flex-row xl:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="building" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Branch Network</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Branches • Destination codes • Cargo types</p>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <div className="seg w-full sm:w-auto" role="tablist" aria-label="Sections">
                            {(['branches', 'destinations', 'cargo'] as Tab[]).map(t => <button key={t} type="button" className="tab-btn flex-1 sm:flex-none" role="tab" data-tab={t} aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'branches' ? 'Branches' : t === 'destinations' ? 'Destination codes' : 'Cargo types'}</button>)}
                        </div>
                        <button type="button" id="addBtn" className="btn btn-coral" onClick={primary}><Icon name="plus" /><span id="addBtnLabel">{TAB_LABEL[tab]}</span></button>
                    </div>
                </section>

                <section data-panel="branches" className={tab === 'branches' ? '' : 'hidden'}>
                    <div id="stats" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                        {branches && <>{tile('Active branches', active.length, true)}{tile('Hubs', active.filter(b => b.is_hub).length)}{tile('Countries', new Set(active.map(b => b.country)).size)}{tile('Dismissed', branches.length - active.length)}</>}
                    </div>
                    <div className="bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                        <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between mb-4">
                            <div className="flex items-center gap-2"><span className="font-extrabold text-xs uppercase tracking-wider">Branches</span><span id="branchCount" className="pill-tag pill-gray">{branches ? list.length : '…'}</span></div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex gap-2">
                                <input id="branchSearch" type="search" placeholder="Search name, code, city…" className="field pill lg:!w-64 !py-2.5" value={q} onChange={e => setQ(e.target.value)} />
                                <select id="statusFilter" className="field pill lg:!w-40 !py-2.5" aria-label="Filter by status" value={statusF} onChange={e => setStatusF(e.target.value)}>
                                    <option value="active">Active</option><option value="dismissed">Dismissed</option><option value="">All</option>
                                </select>
                            </div>
                        </div>
                        <div id="branchGrid" className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                            {!branches ? <p className="text-xs text-gray-400">Loading…</p> : list.length ? list.map(b => {
                                const cc = findCountry(b.country)?.c;
                                return (
                                    <article key={b.branch_code} className={`bg-white rounded-[1.75rem] border border-gray-100 p-5 flex flex-col gap-4 ${isDismissed(b) ? 'opacity-60' : ''}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className={`w-11 h-11 rounded-2xl ${b.is_hub ? 'bg-coral-500' : 'bg-[#111827]'} text-white flex items-center justify-center flex-shrink-0`}><Icon name={b.is_hub ? 'warehouse' : 'building'} cls="w-5 h-5" /></span>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-extrabold truncate">{b.branch_name}</p>
                                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                        <span className="pill-tag pill-dark font-mono">{b.branch_code}</span>
                                                        <span className="pill-tag pill-coral" title="AWB digit">{(b.branch_type || 'branch') === 'branch' ? `AWB ${b.booking_code || '—'}` : 'No bookings'}</span>
                                                        {b.is_hub && <span className="pill-tag pill-amber">Hub</span>}{b.branch_type === 'warehouse' && <span className="pill-tag pill-dark">Central warehouse</span>}{b.branch_type === 'main_office' && <span className="pill-tag pill-dark">Main Office</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div data-menu-root=""><button type="button" className="icon-btn" aria-label={`Actions for ${b.branch_name}`} onClick={e => branchMenu(e.currentTarget, b)}><Icon name="more" cls="w-5 h-5" /></button></div>
                                        </div>
                                        <div className="space-y-2 text-xs">
                                            <p className="flex items-start gap-2 text-gray-600">{cc ? <img className="flag mt-0.5" src={flag(cc)} alt="" /> : <Icon name="pin" cls="w-4 h-4 text-gray-400" />}<span>{[b.location, b.state, b.country].filter(Boolean).join(', ') || '—'}</span></p>
                                            <p className="flex items-center gap-2 text-gray-600"><Icon name="phone" cls="w-4 h-4 text-gray-400" />{b.phone_number || '—'}</p>
                                            <p className="flex items-center gap-2 text-gray-600"><Icon name="user" cls="w-4 h-4 text-gray-400" />{b.manager_name || 'Unassigned'}</p>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 mt-auto pt-3 border-t border-gray-100 text-center">
                                            <div><p className="sd-label">Currency</p><p className="text-xs font-extrabold mt-0.5">{b.currency || 'OMR'}</p></div>
                                            <div><p className="sd-label">{b.tax_name || 'VAT'}</p><p className="text-xs font-extrabold mt-0.5">{`${b.tax_rate ?? 0}%`}</p></div>
                                            <div><p className="sd-label">Status</p><p className={`text-xs font-extrabold mt-0.5 ${isDismissed(b) ? 'text-gray-500' : 'text-emerald-600'}`}>{isDismissed(b) ? 'Dismissed' : 'Active'}</p></div>
                                        </div>
                                    </article>
                                );
                            }) : <p className="text-xs text-gray-400 col-span-full text-center py-8">No branches match.</p>}
                        </div>
                    </div>
                </section>

                <section data-panel="destinations" className={tab === 'destinations' ? '' : 'hidden'}>
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                        <div className="xl:col-span-2 bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2"><span className="font-extrabold text-xs uppercase tracking-wider">Frequent destinations</span><span id="destCount" className="pill-tag pill-gray">{destinations ? destinations.length : '…'}</span></div>
                            </div>
                            <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-x-auto custom-scrollbar max-lg:bg-transparent max-lg:border-0">
                                <table className="rtable w-full text-xs">
                                    <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                        <th className="p-3 pl-4 font-extrabold">Code</th><th className="p-3 font-extrabold">Country</th><th className="p-3 font-extrabold">Example reference</th><th className="p-3 font-extrabold">Status</th><th className="p-3 w-12"></th>
                                    </tr></thead>
                                    <tbody id="destRows" className="divide-y divide-gray-100">
                                        {destinations && (destinations.length ? destinations.map(d => (
                                            <tr key={d.country_code} className={d.active ? '' : 'opacity-60'}>
                                                <td className="cell-main p-3 pl-4" data-label="Code"><span className="ref-token bg-emerald-50 text-emerald-700 text-sm">{d.code}</span></td>
                                                <td className="p-3" data-label="Country"><span className="flex items-center gap-2 font-bold"><img className="flag" src={flag(d.country_code)} alt="" />{d.country_name}</span></td>
                                                <td className="p-3 font-mono font-bold text-gray-500" data-label="Example">{`${d.code}${exDigit}${exCargo}000001`}</td>
                                                <td className="p-3" data-label="Status"><span className={`pill-tag ${d.active ? 'pill-green' : 'pill-gray'}`}>{d.active ? 'Active' : 'Inactive'}</span></td>
                                                <td className="cell-menu p-3" data-menu-root=""><button type="button" className="icon-btn" aria-label={`Actions for ${d.country_name}`} onClick={e => destMenu(e.currentTarget, d)}><Icon name="more" cls="w-5 h-5" /></button></td>
                                            </tr>
                                        )) : <tr><td colSpan={5} className="cell-empty p-8 text-center text-gray-400">No frequent destinations — every country uses its 2-letter code.</td></tr>)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="space-y-5">
                            <div className="rounded-[2rem] bg-[#111827] text-white p-6">
                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Reference rule</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-3 text-lg">
                                    <span className="ref-token bg-emerald-500/20 text-emerald-300">D</span>
                                    <span className="ref-token bg-coral-500 text-white">B</span>
                                    <span className="ref-token bg-sky-500/20 text-sky-300">C</span>
                                    <span className="ref-token bg-white/10">000001</span>
                                </div>
                                <ul className="mt-4 space-y-2 text-xs text-gray-300 leading-relaxed">
                                    <li><b className="text-white">D</b> destination — the number below, or the country's 2-letter code if it isn't listed</li>
                                    <li><b className="text-white">B</b> branch AWB digit (set per branch)</li>
                                    <li><b className="text-white">C</b> cargo type code</li>
                                    <li><b className="text-white">000001</b> runs per branch + destination and never resets. All 2-letter countries share one series per branch.</li>
                                </ul>
                            </div>
                            <div className="rounded-[2rem] bg-[#F8F8FA] p-5 text-xs text-gray-500 leading-relaxed">
                                Changing a code only affects <b>new</b> bookings. Removing a country makes it use its 2-letter code (shared series).
                            </div>
                        </div>
                    </div>
                </section>

                <section data-panel="cargo" className={tab === 'cargo' ? '' : 'hidden'}>
                    <div className="bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                        <div className="flex items-center gap-2 mb-4"><span className="font-extrabold text-xs uppercase tracking-wider">Cargo types</span><span id="cargoCount" className="pill-tag pill-gray">{cargoTypes ? cargoTypes.length : '…'}</span></div>
                        <div id="cargoGrid" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                            {cargoTypes && (cargoTypes.length ? cargoTypes.map(t => (
                                <article key={t.code} className={`bg-white rounded-[1.75rem] border border-gray-100 p-5 flex items-center gap-4 ${t.active ? '' : 'opacity-60'}`}>
                                    <span className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0"><Icon name={cargoIcon(t.name)} cls="w-6 h-6" /></span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2"><span className="ref-token bg-sky-50 text-sky-700 text-xs">{t.code}</span><p className="text-sm font-extrabold truncate">{t.name}</p></div>
                                        <p className="text-[11px] text-gray-400 mt-1 truncate">{t.description || (t.active ? 'Active' : 'Inactive')}</p>
                                    </div>
                                    <button type="button" className="icon-btn" aria-label={`Edit ${t.name}`} onClick={() => openCargo(t.code)}><Icon name="edit" /></button>
                                </article>
                            )) : <p className="text-xs text-gray-400">No cargo types.</p>)}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-4">Cargo types can't be deleted (old references use them) — deactivate to hide them from the booking form.</p>
                    </div>
                </section>
            </div>
        </AppFrame>
    );
}
