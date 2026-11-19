// New Booking — same page as admin/booking.html: service, sender (returning-customer lookup), receiver (country →
// state → city, postcode lookup), boxes with volumetric weight, itemised charges (rate-card freight, packages, extra
// charges, packing materials, other), live reference preview and summary, confirm, then label / receipt / WhatsApp.
// Data: /api/branches, /api/codes, /api/profile, /api/accounts (booking_options, quote), /api/customers, POST /api/bookings
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { PageLink } from '../components/PageLink';
import { Combobox, type ComboboxHandle } from '../components/fields/Combobox';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { PostalLookup, type Place } from '../components/fields/PostalLookup';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { citiesOf, countries, countryItems, statesOf, type Item } from '../lib/geo';
import { markClean } from '../lib/guard';
import { printDoc } from '../lib/print';
import { session } from '../lib/session';
import { beep, toast } from '../lib/toast';
import './booking.css';

const findCountry = (t?: string) => { const s = String(t || '').trim().toLowerCase(); return countries().find(c => c.n.toLowerCase() === s || c.c.toLowerCase() === s) || null; };
const num = (v: unknown) => { const n = parseFloat(v as string); return Number.isFinite(n) && n >= 0 ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: unknown) => Math.round((+(n as number) || 0) * 1000) / 1000;
const KIND_TAG: Record<string, [string, string]> = { freight: ['Freight', 'pill-dark'], package: ['Package', 'pill-coral'], charge: ['Charge', 'pill-amber'], material: ['Material', 'pill-green'] };

type Box = { k: number; commodity: string; weight: string; l: string; w: string; h: string };
type Line = { kind: string; description: string; qty: number; rate: number; product_id?: number; auto?: boolean; basis?: string | null; chargeName?: string; manual?: boolean };
type Options = { packages: any[]; charges: any[]; materials: any[]; commodities: { code: string; name: string }[] };

export function Booking() {
    const isAdmin = session.isAdmin();
    const [branches, setBranches] = useState<any[]>([]);
    const [destinations, setDestinations] = useState<any[]>([]);
    const [cargoTypes, setCargoTypes] = useState<any[]>([]);
    const [myBranch, setMyBranch] = useState<string | null>(null);
    const [branchCode, setBranchCode] = useState('');
    const [cargoCode, setCargoCode] = useState('');
    const [intake, setIntake] = useState('drop_off');
    const [, bump] = useState(0);
    const rerender = () => bump(n => n + 1);
    const [v, setV] = useState({ packageType: 'Parcel', senderName: '', senderId: '', rcvName: '', house: '', street: '', landmark: '', pin: '', po: '', contents: '', declared: '', payment: 'cash', notes: '' });
    const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV(x => ({ ...x, [k]: e.target.value }));
    const boxKey = useRef(1);
    const [boxes, setBoxes] = useState<Box[]>([{ k: 0, commodity: 'GEN', weight: '', l: '', w: '', h: '' }]);
    const destBox = useRef<ComboboxHandle>(null), stateBox = useRef<ComboboxHandle>(null), cityBox = useRef<ComboboxHandle>(null);
    const rcvState = useRef<Item | null>(null);
    const [stateOn, setStateOn] = useState(false), [statePh, setStatePh] = useState('Select destination first');
    const senderPh = useRef<PhoneHandle>(null), rcvPh = useRef<PhoneHandle>(null), waPh = useRef<PhoneHandle>(null);

    const branch = () => branches.find(b => b.branch_code === (isAdmin ? branchCode : myBranch)) || {};
    const dest = () => findCountry(destBox.current?.text);
    const cargo = () => cargoTypes.find(t => t.code === cargoCode);
    const destCode = (c: ReturnType<typeof findCountry>) => { if (!c) return 'D'; const d = destinations.find(x => x.country_code === c.c && x.active); return d ? d.code : c.c; };
    const cur = () => branch().currency || 'OMR';

    // ---------- boxes ----------
    const readBoxes = () => boxes.map(x => {
        const b = { weight: num(x.weight), l: num(x.l), w: num(x.w), h: num(x.h), commodity: x.commodity || 'GEN', vol: 0 };
        b.vol = b.l && b.w && b.h ? round2(b.l * b.w * b.h / 5000) : 0;
        return b;
    });
    const bx = readBoxes();
    const actual = round2(bx.reduce((s, b) => s + b.weight, 0)), vol = round2(bx.reduce((s, b) => s + b.vol, 0)), chargeKg = Math.max(actual, vol);
    const setBox = (k: number, f: keyof Box, val: string) => setBoxes(bs => bs.map(b => b.k === k ? { ...b, [f]: val } : b));

    // ---------- itemised charges ----------
    const charges = useRef<Line[]>([]);
    const removed = useRef(new Set<string>());
    const [options, setOptions] = useState<Options>({ packages: [], charges: [], materials: [], commodities: [] });
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    const optionsKey = useRef(''), quoteKey = useRef(''), quoteTimer = useRef<ReturnType<typeof setTimeout>>();
    const [freightOff, setFreightOff] = useState(false);
    const freightOffRef = useRef(false); freightOffRef.current = freightOff;
    const [quoteHint, setQuoteHint] = useState('Freight fills in from the branch rate card (per contents type) once destination, cargo and weights are set. Every price can be changed.');
    const shipment = () => ({ boxes: bx.length, kg: chargeKg });
    const basisQty = (basis?: string | null) => basis === 'per_box' ? shipment().boxes : basis === 'per_kg' ? shipment().kg : 1;
    const total = () => r3(charges.current.reduce((s, l) => s + r3(l.qty * l.rate), 0));

    // extra charges depend on cargo type / destination: same name, most specific price wins
    const matchCharge = (name: string) => {
        const c = cargo()?.code || '', d = dest()?.c || '';
        const same = (options.charges || []).filter(x => x.name === name);
        for (const [cc, dd] of [[c, d], [c, '*'], ['*', d], ['*', '*']]) {
            const hit = same.find(x => (x.cargo_type_code || '*') === cc && (x.dest_country_code || '*') === dd);
            if (hit) return hit;
        }
        return null;
    };
    const chargeNames = () => [...new Set((options.charges || []).map(x => x.name as string))];
    // re-price (unless typed by hand), drop charges that don't apply to this cargo, add the automatic ones, count per-box / per-kg lines
    const syncCharges = () => {
        charges.current = charges.current.filter(l => {
            if (!l.chargeName) return true;
            const m = matchCharge(l.chargeName);
            if (!m) return false;
            if (!l.manual) l.rate = +m.price;
            l.basis = m.basis === 'per_shipment' ? null : m.basis;
            return true;
        });
        chargeNames().forEach(n => {
            const m = matchCharge(n);
            if (m && m.auto_add && !removed.current.has(n) && !charges.current.some(l => l.chargeName === n))
                charges.current.push({ kind: 'charge', description: n, chargeName: n, qty: basisQty(m.basis) || 1, rate: +m.price, basis: m.basis === 'per_shipment' ? null : m.basis });
        });
        charges.current.forEach(l => { if (l.basis) l.qty = basisQty(l.basis) || 1; });
    };
    syncCharges();   // idempotent: the lines always follow the current branch, destination, cargo and boxes
    const availCharges = chargeNames().map(n => matchCharge(n)).filter(Boolean);

    async function loadOptions() {
        const b = branch(), c = dest();
        if (!b.branch_code) return;
        const key = `${b.branch_code}|${c ? c.c : ''}`;
        if (key === optionsKey.current) return;
        optionsKey.current = key;
        try { setOptions(await api(`/api/accounts?view=booking_options&branch=${encodeURIComponent(b.branch_code)}&dest=${c ? c.c : ''}`)); setOptionsLoaded(true); } catch { /* keep the old list */ }
    }
    const commodities = options.commodities.length ? options.commodities : [{ code: 'GEN', name: 'General' }];

    function scheduleQuote() {
        loadOptions();
        const b = branch(), c = dest(), t = cargo();
        if (!b.branch_code || !c || !t || !bx.some(x => x.weight > 0 || x.vol > 0)) return;
        const payload = bx.map(x => ({ weight: x.weight, l: x.l, w: x.w, h: x.h, commodity: x.commodity }));
        const key = [b.branch_code, c.c, t.code, JSON.stringify(payload)].join('|');
        if (key === quoteKey.current || freightOffRef.current) return;
        clearTimeout(quoteTimer.current);
        quoteTimer.current = setTimeout(async () => {
            quoteKey.current = key;
            try {
                const r = await api(`/api/accounts?view=quote&branch=${encodeURIComponent(b.branch_code)}&dest=${c.c}&cargo=${encodeURIComponent(t.code)}&boxes=${encodeURIComponent(JSON.stringify(payload))}`);
                if (freightOffRef.current) return;
                const kept = charges.current.filter(l => !(l.kind === 'freight' && l.auto));
                if (r.quote) {
                    charges.current = [...r.quote.lines.map((l: any) => ({ kind: 'freight', description: l.description, qty: 1, rate: l.amount, auto: true })).filter(() => !kept.some(k => k.kind === 'freight' && !k.auto)), ...kept];
                    setQuoteHint(`Freight from the rate card${r.missing?.length ? ` — no card for ${r.missing.join(', ')}: add it by hand` : ''}${r.quote.unmatched ? ` — ${r.quote.unmatched} box(es) need L × W × H for this rate` : ''}. You can change any price.`);
                } else {
                    charges.current = kept;
                    setQuoteHint(r.message || 'No rate card for this route — add the freight with “+ Other”.');
                }
                rerender();
            } catch { setQuoteHint('Could not load the rate card — add the freight with “+ Other”.'); }
        }, 350);
    }

    // ---------- the old refresh(): quote, phone codes follow branch / destination ----------
    const destText = destBox.current?.text || '';
    const refreshKey = JSON.stringify([branchCode, myBranch, destText, cargoCode, boxes, freightOff, branches.length, options]);
    useEffect(() => {
        scheduleQuote();
        const c = dest(), b = branch();
        if (c) { rcvPh.current?.setCountry(c.c, { soft: true }); waPh.current?.setCountry(c.c, { soft: true }); }
        const bc = countries().find(x => x.n === b.country);
        if (bc) senderPh.current?.setCountry(bc.c, { soft: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    const addPackage = (id: string) => { const p = options.packages.find(x => String(x.id) === id); if (p) { charges.current.push({ kind: 'package', description: p.name + (p.includes ? ` (${p.includes})` : ''), qty: 1, rate: +p.price }); rerender(); } };
    const addCharge = (name: string) => {
        const x = matchCharge(name);
        if (x && !charges.current.some(l => l.chargeName === x.name)) { removed.current.delete(x.name); charges.current.push({ kind: 'charge', description: x.name, chargeName: x.name, qty: basisQty(x.basis) || 1, rate: +x.price, basis: x.basis === 'per_shipment' ? null : x.basis }); }
        else if (x) toast(false, `${x.name} is already added.`);
        rerender();
    };
    const addMaterial = (id: string) => { const m = options.materials.find(y => String(y.product_id) === id); if (m) { charges.current.push({ kind: 'material', description: m.name, qty: 1, rate: +m.price, product_id: m.product_id }); rerender(); } };
    const addOther = () => {
        charges.current.push({ kind: 'charge', description: 'Other charge', qty: 1, rate: 0 }); rerender();
        setTimeout(() => (document.querySelector('#chargeRows tr:last-child [data-f="description"]') as HTMLInputElement)?.select(), 0);
    };
    const editLine = (i: number, f: 'description' | 'qty' | 'rate', val: string) => {
        const l = charges.current[i];
        (l as any)[f] = f === 'description' ? val : (+val || 0);
        if (l.auto && f === 'rate') l.auto = false;   // a typed freight price is kept
        if (l.chargeName && f === 'rate') l.manual = true;
        rerender();
    };
    const delLine = (i: number) => {
        const l = charges.current[i];
        if (l.kind === 'freight' && l.auto) setFreightOff(true);
        if (l.chargeName) removed.current.add(l.chargeName);
        charges.current.splice(i, 1); rerender();
    };
    const useRateCard = () => { setFreightOff(false); quoteKey.current = ''; charges.current = charges.current.filter(l => l.kind !== 'freight'); rerender(); };

    // ---------- destination → state → city ----------
    const onDest = (it: Item | null) => {
        rcvState.current = null;
        stateBox.current?.reload(); stateBox.current?.clear(); cityBox.current?.reload(); cityBox.current?.clear();
        setStateOn(!!it); setStatePh(it ? 'Select or type state' : 'Select destination first');
        if (it) stateBox.current?.preload();
        rerender();
    };
    const onState = (it: Item | null) => { rcvState.current = it; cityBox.current?.reload(); cityBox.current?.clear(); if (it) cityBox.current?.preload(); rerender(); };
    const onCity = (it: Item | null) => { if (it?.postalCode) setV(x => ({ ...x, pin: it.postalCode! })); rerender(); };   // Oman towns carry their postal code
    const onPin = async (p: Place) => {
        setV(x => ({ ...x, pin: p.postalCode || x.pin, po: p.postOffice || '', house: p.building ? `Bldg ${p.building}` : x.house, street: p.street || x.street,
            landmark: p.shortAddress || p.additionalNumber ? [p.shortAddress && `Short address ${p.shortAddress}`, p.additionalNumber && `Addl no ${p.additionalNumber}`].filter(Boolean).join(' · ') : x.landmark }));
        await stateBox.current?.setValue(p.state || ''); rcvState.current = stateBox.current?.value || null;
        await cityBox.current?.setValue(p.city || ''); rerender();
    };

    // ---------- returning customer: look up by mobile or civil ID ----------
    const [customer, setCustomer] = useState<any>(null);
    const [contacts, setContacts] = useState<any[]>([]);
    const lookupKey = useRef('');
    async function lookupCustomer(kind: 'phone' | 'civil') {
        const value = kind === 'civil' ? v.senderId.trim() : senderPh.current?.value || '';
        const key = kind + ':' + value;
        if (!value || key === lookupKey.current) return;
        lookupKey.current = key;
        let d: any;
        try { d = await api(`/api/customers?lookup=${kind}&value=${encodeURIComponent(value)}`); } catch { return; }
        if (!d.customer) { if (kind === 'phone') setCustomer(null); return; }
        const c = d.customer;
        setV(x => ({ ...x, senderName: x.senderName.trim() ? x.senderName : c.name || '', senderId: !x.senderId.trim() && c.civil_id ? c.civil_id : x.senderId }));
        if (kind === 'civil' && !senderPh.current?.value && c.phone) senderPh.current?.setValue(c.phone);
        setCustomer(c); setContacts(d.contacts || []);
        if (c.blocked) toast(false, `${c.name} is marked as blocked — check with a manager.`);
    }
    const pickReceiver = async (r: any) => {
        const parts = r.parts || {};
        setV(x => ({ ...x, rcvName: r.name || '' }));
        if (r.phone) rcvPh.current?.setValue(r.phone);
        waPh.current?.reset(); if (r.whatsapp && r.whatsapp !== r.phone) waPh.current?.setValue(r.whatsapp);
        if (r.country_code) {
            await destBox.current?.setValue(r.country_code);
            rcvState.current = null; stateBox.current?.reload(); cityBox.current?.reload();
            setStateOn(true); setStatePh('Select or type state');
            optionsKey.current = ''; quoteKey.current = '';
        }
        await stateBox.current?.setValue(parts.state || ''); rcvState.current = stateBox.current?.value || null;
        await cityBox.current?.setValue(parts.city || r.city || '');
        setV(x => ({ ...x, house: parts.house || '', street: !parts.house && !parts.street && r.address ? r.address : parts.street || '', landmark: parts.landmark || '', pin: parts.pin || '', po: parts.po || '' }));
        rerender(); toast(true, `${r.name} filled in — check the details.`);
    };

    // ---------- submit ----------
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<any>(null);
    const [doneOpen, setDoneOpen] = useState(false);
    const [doneSub, setDoneSub] = useState('');
    const form = useRef<HTMLFormElement>(null);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        const c = dest(), t = cargo(), b = branch(), city = (cityBox.current?.text || '').trim();
        const need = ([
            [!b.branch_code, 'branch', 'Choose the booking branch.'], [!c, 'destCountry', 'Choose the destination country from the list.'],
            [!t, 'cargoOptions', 'Choose a cargo type.'], [!(document.getElementById('senderPhone') as HTMLInputElement).value.trim(), 'senderPhone', 'Sender mobile is required.'],
            [!v.senderName.trim(), 'senderName', 'Sender name is required.'], [!v.rcvName.trim(), 'rcvName', 'Receiver name is required.'],
            [!(document.getElementById('rcvPhone') as HTMLInputElement).value.trim(), 'rcvPhone', 'Receiver mobile is required.'],
            [!senderPh.current?.valid, 'senderPhone', 'Sender mobile looks wrong — check the country code and number.'], [!rcvPh.current?.valid, 'rcvPhone', 'Receiver mobile looks wrong — check the country code and number.'],
            [!waPh.current?.valid, 'rcvWhatsapp', 'WhatsApp number looks wrong.'], [!city, 'rcvCity', 'Receiver district / city is required.'],
            [!bx.some(x => x.weight > 0), 'boxRows', 'Enter the weight of at least one box.']
        ] as [boolean, string, string][]).find(([bad]) => bad);
        if (need) { toast(false, need[2]); document.getElementById(need[1])?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        const address = [v.house, v.street, v.landmark, v.po, city, stateBox.current?.text || '', v.pin].map(x => x.trim()).filter(Boolean).join(', ');
        const amount = charges.current.length ? total().toFixed(3) : '';
        const fields = {
            shipper: v.senderName, shipper_phone: senderPh.current!.value, shipper_id_no: v.senderId,
            consignee: v.rcvName, consignee_phone: rcvPh.current!.value, receiver_whatsapp: waPh.current!.value || rcvPh.current!.value,
            consignee_address: address, dest_city: city, dest_country: c!.n, dest_country_code: c!.c,
            origin_city: b.location || '', origin_country: b.country || '',
            cargo_type_code: t.code, package_type: v.packageType, intake_mode: intake,
            weight: actual, pieces: bx.length, chargeable_weight: chargeKg, boxes: bx,
            contents: v.contents, declared_value: v.declared, amount, payment_method: v.payment, notes: v.notes
        };
        const payText = (document.getElementById('payment') as HTMLSelectElement).selectedOptions[0].text;
        const ok = await confirm({ title: 'Book this shipment?', confirmText: 'Book now', message: <>Check the details. Choose <b>Cancel</b> to go back and edit.<span className="block bg-[#F8F8FA] rounded-2xl p-4 mt-2 text-xs text-gray-700 leading-6 text-left">
            Reference <b className="font-mono">{`${destCode(c)}${b.booking_code}${t.code}••••••`}</b><br />
            {`${fields.shipper} → `}<b>{fields.consignee}</b>{`, ${fields.dest_city}, ${c!.n}`}<br />
            {`${t.name} · ${bx.length} box(es) · ${chargeKg} kg chargeable`}<br />
            {fields.amount ? `${cur()} ${num(fields.amount).toFixed(3)} · ${payText}` : 'No charge entered'}</span></> });
        if (!ok) return;
        setBusy(true);
        try {
            const out = await api('/api/bookings', { method: 'POST', body: { action: 'create', auto_ref: true, branch: b.branch_code, fields,
                receiver_parts: { house: v.house.trim(), street: v.street.trim(), landmark: v.landmark.trim(), pin: v.pin.trim(), po: v.po.trim(), state: (stateBox.current?.text || '').trim(), city },
                charge_lines: charges.current.map(({ kind, description, qty, rate, product_id }) => ({ kind, description, qty, rate, product_id })) } });
            if (!out.awb) throw new Error('The booking was saved but no reference came back. Check Shipments before booking again.');
            setDone({ ...fields, awb: out.awb, booked_at: new Date().toISOString(), cargo_name: t.name, declared_value: fields.declared_value || null, amount: fields.amount || null });
            markClean(form.current);   // saved — leaving the page no longer asks
            setDoneSub(`${fields.consignee} · ${fields.dest_city}, ${c!.n}` + (out.invoice ? ` · ${out.invoice.invoice_no}${out.invoice.payment ? ' (paid, ' + out.invoice.payment.receipt_no + ')' : ' (balance due)'}` : ''));
            if (out.invoice_error) toast(false, `Booked, but the invoice was not created: ${out.invoice_error}`);
            beep(true);
            setDoneOpen(true);
        } catch (err) { toast(false, (err as Error).message); beep(false); }
        setBusy(false);
    }
    const whatsappDone = () => {
        if (!done) return;
        const p = String(done.shipper_phone || '').replace(/[^0-9]/g, '');
        const text = `Hello ${done.shipper},\n\nYour booking with *Al-Farha Cargo* is confirmed.\n\nTracking ID: *${done.awb}*\nTo: ${done.consignee}, ${done.dest_city}, ${done.dest_country}\nBoxes: ${done.pieces} · ${done.chargeable_weight} kg\n\nThank you for choosing Al-Farha Cargo.`;
        window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };

    // ---------- init ----------
    useEffect(() => {
        (async () => {
            try {
                const [b, c, p] = await Promise.all([api('/api/branches'), api('/api/codes'), api('/api/profile').catch(() => ({}))]);
                const brs = (b.branches || []).filter((x: any) => (x.status || '') !== 'Dismissed');
                setBranches(brs); setDestinations(c.destinations || []);
                const cts = (c.cargo_types || []).filter((t: any) => t.active);
                setCargoTypes(cts); setCargoCode(cts[0]?.code || '');
                setMyBranch((p as any).profile?.branch || null);
                let s = ''; if (isAdmin) { try { s = localStorage.getItem('alfarha_work_branch') || ''; } catch { /* ignore */ } }
                setBranchCode(brs.some((x: any) => x.branch_code === s) ? s : brs[0]?.branch_code || '');
            } catch (e) { toast(false, (e as Error).message); }
            document.getElementById('destCountry')?.focus();
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const c = dest(), t = cargo(), b = branch();
    const sa = c && c.c === 'SA';
    const totalTxt = `${cur()} ${total().toFixed(3)}`;
    const commodityOpts = useMemo(() => commodities.map(o => <option key={o.code} value={o.code}>{o.name}</option>), [commodities]);

    const popups = (
        <Modal id="doneModal" open={doneOpen} onClose={() => setDoneOpen(false)} panelClassName="max-w-md text-center">
            <span className="w-16 h-16 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><Icon name="checkCircle" cls="w-8 h-8" /></span>
            <p className="text-sm font-bold text-gray-500 mt-4">Booking created</p>
            <p id="doneRef" className="text-3xl font-extrabold tracking-tight font-mono mt-1">{done?.awb || '—'}</p>
            <p id="doneSub" className="text-xs text-gray-400 mt-1">{doneSub}</p>
            <div className="grid grid-cols-2 gap-2 mt-6">
                <button type="button" className="btn btn-dark" onClick={() => done && printDoc('label', done, branch())}><Icon name="hash" />Print label</button>
                <button type="button" className="btn btn-light" onClick={() => done && printDoc('receipt', done, branch())}><Icon name="clipboard" />Receipt</button>
                <button type="button" className="btn btn-light" onClick={whatsappDone}><Icon name="message" />WhatsApp</button>
                <PageLink id="doneView" page="shipments.html" search={done ? `?awb=${encodeURIComponent(done.awb)}` : ''} className="btn btn-light"><Icon name="eye" />View</PageLink>
            </div>
            <button type="button" className="btn btn-coral w-full mt-3" onClick={() => { location.href = location.pathname; }}><Icon name="plus" />New booking</button>
        </Modal>
    );

    const main = 'flex-1 min-w-0 bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-5 lg:p-8 flex flex-col relative z-10 border border-white';
    return (
        <AppFrame mainClassName={main} after={popups}>
            <div className="flex-1">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="clipboard" /></div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">New Booking</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Counter booking with automatic reference</p>
                        </div>
                    </div>
                    <PageLink page="shipments.html" className="btn btn-light self-start sm:self-auto"><Icon name="arrowLeft" />Shipments</PageLink>
                </section>

                <form id="bookingForm" ref={form} data-guard="" className="grid grid-cols-1 xl:grid-cols-3 gap-5" noValidate autoComplete="off" onSubmit={submit}>
                    <div className="xl:col-span-2 space-y-5">
                        <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <div className="flex items-center gap-2"><span className="step">1</span><span className="font-extrabold text-xs uppercase tracking-wider">Service</span></div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div id="branchWrap" className={isAdmin ? '' : 'hidden'}><label className="ui-label" htmlFor="branch">Booking branch</label>
                                    <select id="branch" className="field" value={branchCode} onChange={e => { setBranchCode(e.target.value); optionsKey.current = ''; quoteKey.current = ''; }}>
                                        {branches.map(x => <option key={x.branch_code} value={x.branch_code}>{`${x.branch_name} (${x.branch_code} · AWB ${x.booking_code})`}</option>)}
                                    </select></div>
                                <div>
                                    <label className="ui-label" htmlFor="destCountry">Destination country <span className="req">*</span></label>
                                    <Combobox ref={destBox} load={countryItems} onSelect={onDest} inputProps={{ id: 'destCountry', className: 'field', placeholder: 'Select country', onChange: rerender }} />
                                </div>
                            </div>
                            <div>
                                <p className="ui-label">Cargo type <span className="req">*</span></p>
                                <div id="cargoOptions" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {cargoTypes.map(ct => (
                                        <label key={ct.code} className="cargo-opt cursor-pointer">
                                            <input type="radio" name="cargo" value={ct.code} className="sr-only" checked={cargoCode === ct.code} onChange={() => setCargoCode(ct.code)} />
                                            <span className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-3 py-3 font-bold text-xs transition-colors">
                                                <span className="code ref-token bg-[#F8F8FA] text-gray-700 !py-1 !px-2">{ct.code}</span>{ct.name}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div><p className="ui-label">How the parcel arrives</p>
                                    <div className="seg w-full" role="group" aria-label="Intake">
                                        <button type="button" data-intake="drop_off" aria-pressed={intake === 'drop_off'} className="flex-1" onClick={() => setIntake('drop_off')}>Drop-off at branch</button>
                                        <button type="button" data-intake="pickup" aria-pressed={intake === 'pickup'} className="flex-1" onClick={() => setIntake('pickup')}>Pickup</button>
                                    </div></div>
                                <div><label className="ui-label" htmlFor="packageType">Package type</label>
                                    <select id="packageType" className="field" value={v.packageType} onChange={set('packageType')}><option>Parcel</option><option>Document</option><option>Air Freight</option><option>Sea Freight</option><option>Freight</option></select></div>
                            </div>
                        </section>

                        <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <div className="flex items-center gap-2"><span className="step">2</span><span className="font-extrabold text-xs uppercase tracking-wider">Sender</span></div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="ui-label" htmlFor="senderPhone">Mobile <span className="req">*</span></label>
                                    <PhoneField ref={senderPh} country="OM" inputProps={{ id: 'senderPhone', className: 'field', placeholder: 'Mobile number', onBlur: () => lookupCustomer('phone'), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupCustomer('phone'); } } }} />
                                </div>
                                <div><label className="ui-label" htmlFor="senderName">Full name <span className="req">*</span></label><input id="senderName" className="field" placeholder="As on ID" value={v.senderName} onChange={set('senderName')} /></div>
                                <div><label className="ui-label" htmlFor="senderId">Civil ID / passport</label><input id="senderId" className="field" placeholder="Optional" value={v.senderId} onChange={set('senderId')} onBlur={() => lookupCustomer('civil')} /></div>
                            </div>
                            <div id="custBox" className={customer ? '' : 'hidden'}>
                                {customer && (() => {
                                    const bal = (customer.balance || []).map((x: any) => `${x.currency} ${(+x.amount).toFixed(3)}`).join(' + ');
                                    return (
                                        <div className={`rounded-2xl p-4 ${customer.blocked ? 'bg-[#FFF5F3] border border-[#FFD0C7]' : 'bg-white border border-gray-100'}`}>
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="text-xs"><span className={`pill-tag ${customer.blocked ? 'pill-coral' : 'pill-green'}`}>{customer.blocked ? 'Blocked customer' : 'Returning customer'}</span>
                                                    {' '}<b className="ml-1">{customer.name}</b>{' '}<span className="text-gray-400 font-mono">{customer.customer_no || ''}</span>
                                                    {` · ${customer.stats?.shipments ?? 0} shipments`}{bal && <>{' · '}<span className="text-[#D55C48] font-bold">{`owes ${bal}`}</span></>}</p>
                                                <PageLink page="customers.html" search={`?id=${customer.id}`} target="_blank" rel="noopener" className="text-[11px] font-extrabold text-gray-500 hover:text-coral-600">Profile ↗</PageLink>
                                            </div>
                                            {customer.blocked && customer.notes && <p className="text-[11px] text-[#D55C48] mt-2">{customer.notes}</p>}
                                            {contacts.length > 0 && <><p className="sd-label mt-3 mb-1.5">Send to a previous receiver</p><div className="flex flex-wrap gap-1.5">{contacts.map((r, i) => (
                                                <button key={i} type="button" data-rcv={i} onClick={() => pickReceiver(r)} className="pill-tag pill-gray hover:!bg-[#FFF5F3] hover:!text-[#D55C48] !py-1.5 !px-3">{(r.name || '') + (r.city ? ' · ' + r.city : '') + (r.country_code ? ' · ' + r.country_code : '')}</button>
                                            ))}</div></>}
                                        </div>
                                    );
                                })()}
                            </div>
                        </section>

                        <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <div className="flex items-center gap-2"><span className="step">3</span><span className="font-extrabold text-xs uppercase tracking-wider">Receiver</span></div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="sm:col-span-2"><label className="ui-label" htmlFor="rcvName">Full name <span className="req">*</span></label><input id="rcvName" className="field" value={v.rcvName} onChange={set('rcvName')} /></div>
                                <div><label className="ui-label" htmlFor="rcvPhone">Mobile <span className="req">*</span></label><PhoneField ref={rcvPh} country="IN" inputProps={{ id: 'rcvPhone', className: 'field', placeholder: 'Mobile number' }} /></div>
                                <div><label className="ui-label" htmlFor="rcvWhatsapp">WhatsApp</label><PhoneField ref={waPh} country="IN" inputProps={{ id: 'rcvWhatsapp', className: 'field', placeholder: 'Same as mobile' }} /></div>
                                <div><label className="ui-label" htmlFor="rcvHouse">House / building</label><input id="rcvHouse" className="field" value={v.house} onChange={set('house')} /></div>
                                <div><label className="ui-label" htmlFor="rcvStreet">Street</label><input id="rcvStreet" className="field" value={v.street} onChange={set('street')} /></div>
                                <div><label className="ui-label" htmlFor="rcvLandmark">Landmark</label><input id="rcvLandmark" className="field" value={v.landmark} onChange={set('landmark')} /></div>
                                <div className="relative">
                                    <label className="ui-label" htmlFor="rcvPin" id="rcvPinLabel">{!c ? 'Postal / ZIP code' : c.c === 'IN' ? 'PIN code' : c.c === 'US' ? 'ZIP code' : sa ? 'Short address or postal code' : 'Postcode / postal code'}</label>
                                    <PinBox show={!!c} value={v.pin} onChange={x => setV(y => ({ ...y, pin: x }))} country={() => dest()?.c || ''} onPick={onPin}
                                        placeholder={sa ? 'e.g. RAAA2919' : c?.c === 'GB' ? 'e.g. SW1A 1AA' : c?.c === 'CA' ? 'e.g. M5V 3L9' : c?.c === 'OM' ? 'e.g. 211 or Salalah' : ''} />
                                </div>
                                <div><label className="ui-label" htmlFor="rcvPo">Post office / area</label><input id="rcvPo" className="field" value={v.po} onChange={set('po')} /></div>
                                <div><label className="ui-label" htmlFor="rcvState">State / province</label><Combobox ref={stateBox} allowCustom emptyText="No states listed — type one" onSelect={onState}
                                    load={() => { const x = dest(); return x ? statesOf(x.c) : []; }} inputProps={{ id: 'rcvState', className: 'field', placeholder: statePh, disabled: !stateOn }} /></div>
                                <div><label className="ui-label" htmlFor="rcvCity">District / city <span className="req">*</span></label><Combobox ref={cityBox} allowCustom emptyText="Type the district / city" onSelect={onCity}
                                    load={() => { const x = dest(); return x && rcvState.current ? citiesOf(x.n, rcvState.current.value) : []; }} inputProps={{ id: 'rcvCity', className: 'field', placeholder: 'Select or type city', onChange: rerender }} /></div>
                            </div>
                        </section>

                        <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2"><span className="step">4</span><span className="font-extrabold text-xs uppercase tracking-wider">Boxes &amp; contents</span></div>
                                <button type="button" id="addBox" className="btn btn-light btn-sm" onClick={() => { const k = boxKey.current++; setBoxes(bs => [...bs, { k, commodity: 'GEN', weight: '', l: '', w: '', h: '' }]); setTimeout(() => (document.querySelector('[data-box]:last-child [data-k="weight"]') as HTMLInputElement)?.focus(), 0); }}><Icon name="plus" />Add box</button>
                            </div>
                            <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-x-auto custom-scrollbar">
                                <table className="w-full text-xs min-w-[640px]">
                                    <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                        <th className="p-3 pl-4 font-extrabold w-10">#</th><th className="p-3 font-extrabold">Contents</th><th className="p-3 font-extrabold">Weight kg</th><th className="p-3 font-extrabold">L cm</th><th className="p-3 font-extrabold">W cm</th><th className="p-3 font-extrabold">H cm</th><th className="p-3 font-extrabold text-right">Vol. kg</th><th className="p-3 w-10"></th>
                                    </tr></thead>
                                    <tbody id="boxRows" className="divide-y divide-gray-100">
                                        {boxes.map((x, i) => (
                                            <tr key={x.k} data-box="">
                                                <td className="p-2 pl-4 font-extrabold text-gray-400">{i + 1}</td>
                                                <td className="p-2"><select data-k="commodity" className="field !py-2 !px-2 text-xs !w-32" aria-label={`Box ${i + 1} contents`} value={x.commodity} onChange={e => setBox(x.k, 'commodity', e.target.value)}>{commodityOpts}</select></td>
                                                {(['weight', 'l', 'w', 'h'] as const).map(k => <td key={k} className="p-2"><input data-k={k} className="field num !py-2 !px-3" type="number" min="0" step="0.01" inputMode="decimal" value={x[k]} aria-label={`Box ${i + 1} ${k}`} onChange={e => setBox(x.k, k, e.target.value)} /></td>)}
                                                <td className="p-2 text-right font-bold text-gray-500" data-vol="">{bx[i].vol ? bx[i].vol : '—'}</td>
                                                <td className="p-2"><button type="button" className="icon-btn !w-8 !h-8" data-remove="" aria-label={`Remove box ${i + 1}`} onClick={() => { if (boxes.length === 1) return toast(false, 'At least one box.'); setBoxes(bs => bs.filter(y => y.k !== x.k)); }}><Icon name="x" cls="w-3.5 h-3.5" /></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="sd-card !p-3 text-center"><p className="sd-label">Actual</p><p id="totActual" className="text-base font-extrabold">{`${actual} kg`}</p></div>
                                <div className="sd-card !p-3 text-center"><p className="sd-label">Volumetric</p><p id="totVol" className="text-base font-extrabold">{`${vol} kg`}</p></div>
                                <div className="rounded-[1.25rem] bg-[#111827] text-white p-3 text-center"><p className="text-[10px] font-extrabold uppercase text-gray-400">Chargeable</p><p id="totCharge" className="text-base font-extrabold">{`${chargeKg} kg`}</p></div>
                            </div>
                            <p className="text-[10px] text-gray-400">Volumetric = L × W × H ÷ 5000 per box. Chargeable = the higher of actual and volumetric.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="sm:col-span-2"><label className="ui-label" htmlFor="contents">Contents</label><input id="contents" className="field" placeholder="e.g. Clothes, dates, documents" value={v.contents} onChange={set('contents')} /></div>
                            </div>
                        </section>

                        <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 space-y-4">
                            <div className="flex items-center gap-2"><span className="step">5</span><span className="font-extrabold text-xs uppercase tracking-wider">Charges &amp; payment</span></div>
                            <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-x-auto custom-scrollbar">
                                <table className="w-full text-xs min-w-[560px]">
                                    <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                        <th className="p-3 pl-4 font-extrabold">Item</th><th className="p-3 font-extrabold">Qty</th><th className="p-3 font-extrabold">Rate</th><th className="p-3 font-extrabold text-right">Amount</th><th className="p-3 w-10"></th></tr></thead>
                                    <tbody id="chargeRows" className="divide-y divide-gray-100">
                                        {charges.current.length ? charges.current.map((l, i) => (
                                            <tr key={i} data-ci={i}>
                                                <td className="p-2 pl-4 w-full"><div className="flex items-center gap-1.5"><span className={`pill-tag ${KIND_TAG[l.kind][1]} flex-shrink-0`}>{KIND_TAG[l.kind][0]}</span>
                                                    <input className="bg-transparent font-bold flex-1 min-w-[180px] focus:outline-none focus:bg-[#F8F8FA] rounded-lg px-1.5 py-1" data-f="description" value={l.description} title={l.description} aria-label="Description" onChange={e => editLine(i, 'description', e.target.value)} /></div></td>
                                                <td className="p-2"><input className="field num !py-1.5 !px-2 !w-20" type="number" min="0" step="any" data-f="qty" value={l.qty} readOnly={!!l.basis} title={l.basis ? 'Counted from the boxes' : undefined} aria-label="Quantity" onChange={e => editLine(i, 'qty', e.target.value)} /></td>
                                                <td className="p-2"><input className="field num !py-1.5 !px-2 !w-24" type="number" min="0" step="0.001" data-f="rate" value={l.rate} aria-label="Rate" onChange={e => editLine(i, 'rate', e.target.value)} /></td>
                                                <td className="p-2 text-right font-extrabold tabular-nums">{r3(l.qty * l.rate).toFixed(3)}</td>
                                                <td className="p-2 pr-3"><button type="button" className="icon-btn !w-7 !h-7" data-cdel={i} aria-label="Remove" onClick={() => delLine(i)}><Icon name="x" cls="w-3 h-3" /></button></td></tr>
                                        )) : <tr><td colSpan={5} className="p-5 text-center text-gray-400">No charges yet — they fill in from the rate card, or add them below.</td></tr>}
                                    </tbody>
                                    <tfoot><tr className="border-t border-gray-100"><td colSpan={3} className="p-3 pl-4 text-right font-extrabold">Total</td><td id="chargeTotal" className="p-3 text-right font-extrabold tabular-nums">{branches.length ? totalTxt : '—'}</td><td></td></tr></tfoot>
                                </table>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                                <select id="addPackage" className="field text-xs" aria-label="Add package rate" value="" onChange={e => addPackage(e.target.value)}>
                                    <option value="">{`+ Package rate${optionsLoaded && !options.packages.length ? ' (none set)' : ''}`}</option>
                                    {options.packages.map(p => <option key={p.id} value={p.id}>{`${p.name} — ${cur()} ${(+p.price).toFixed(3)}${p.includes ? ' · ' + p.includes : ''}`}</option>)}</select>
                                <select id="addCharge" className="field text-xs" aria-label="Add extra charge" value="" onChange={e => addCharge(e.target.value)}>
                                    <option value="">{`+ Extra charge${availCharges.length || !branches.length ? '' : ' (none for this cargo)'}`}</option>
                                    {availCharges.map((x: any) => <option key={x.name} value={x.name}>{`${x.name} — ${(+x.price).toFixed(3)} ${x.basis === 'per_box' ? 'per box' : x.basis === 'per_kg' ? 'per kg' : ''}`}</option>)}</select>
                                <select id="addMaterial" className="field text-xs" aria-label="Add packing material" value="" onChange={e => addMaterial(e.target.value)}>
                                    <option value="">{`+ Packing material${optionsLoaded && !options.materials.length ? ' (none priced)' : ''}`}</option>
                                    {options.materials.map(m => <option key={m.product_id} value={m.product_id}>{`${m.name} — ${(+m.price).toFixed(3)}/${m.unit}${m.qty !== null ? ` · ${+m.qty} in stock` : ''}`}</option>)}</select>
                                <button type="button" id="addOther" className="btn btn-light" onClick={addOther}><Icon name="plus" />Other</button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div><label className="ui-label" htmlFor="declared">Declared value</label><input id="declared" className="field num" type="number" min="0" step="0.001" inputMode="decimal" value={v.declared} onChange={set('declared')} /></div>
                                <div><label className="ui-label" htmlFor="amount">Total charge <span id="curLabel" className="text-gray-400">{`(${cur()})`}</span></label><input id="amount" className="field num soft" readOnly tabIndex={-1} value={charges.current.length ? total().toFixed(3) : ''} /></div>
                                <div><label className="ui-label" htmlFor="payment">Payment</label>
                                    <select id="payment" className="field" value={v.payment} onChange={set('payment')}><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="credit">Credit account</option><option value="pay_on_delivery">Pay on delivery</option></select></div>
                                <div className="sm:col-span-3"><label className="ui-label" htmlFor="notes">Notes</label><input id="notes" className="field" placeholder="Internal note (optional)" value={v.notes} onChange={set('notes')} /></div>
                            </div>
                            <p id="quoteHint" className="text-[11px] text-gray-400">{freightOff ? <>Freight removed. <button type="button" className="font-bold text-[#D55C48]" onClick={useRateCard}>Add freight from the rate card</button></> : quoteHint}</p>
                        </section>
                    </div>

                    <aside className="xl:sticky xl:top-5 self-start space-y-4">
                        <div className="rounded-[2rem] bg-[#111827] text-white p-6">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Booking reference</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-3 text-lg">
                                <span id="pvD" className="ref-token bg-emerald-500/20 text-emerald-300">{destCode(c)}</span>
                                <span id="pvB" className="ref-token bg-coral-500 text-white">{b.booking_code || 'B'}</span>
                                <span id="pvC" className="ref-token bg-sky-500/20 text-sky-300">{t ? t.code : 'C'}</span>
                                <span className="ref-token bg-white/10">••••••</span>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-2">The number is assigned when you book.</p>
                            <div className="mt-5 pt-4 border-t border-white/10 space-y-2.5 text-xs">
                                <div className="flex justify-between gap-3"><span className="text-gray-400">Route</span><span id="sumRoute" className="font-bold text-right">{branches.length ? `${b.location || '—'} → ${cityBox.current?.text || (c ? c.n : '—')}` : '—'}</span></div>
                                <div className="flex justify-between gap-3"><span className="text-gray-400">Cargo</span><span id="sumCargo" className="font-bold">{t ? `${t.code} · ${t.name}` : '—'}</span></div>
                                <div className="flex justify-between gap-3"><span className="text-gray-400">Boxes</span><span id="sumBoxes" className="font-bold">{boxes.length}</span></div>
                                <div className="flex justify-between gap-3"><span className="text-gray-400">Chargeable</span><span id="sumWeight" className="font-bold">{`${chargeKg} kg`}</span></div>
                                <div className="flex justify-between gap-3 pt-2 border-t border-white/10"><span className="text-gray-400">Total</span><span id="sumAmount" className="text-lg font-extrabold">{charges.current.length ? totalTxt : '—'}</span></div>
                            </div>
                            <button id="bookBtn" type="submit" className="btn btn-coral w-full !py-4 !text-sm mt-5" disabled={busy}>{busy ? 'Booking…' : 'Review & book'}</button>
                        </div>
                    </aside>
                </form>
            </div>
        </AppFrame>
    );
}

/** The receiver postcode box: the "Lookup" badge only shows once a destination is chosen. */
function PinBox({ show, placeholder, ...p }: { show: boolean; placeholder: string; value: string; onChange: (v: string) => void; country: () => string; onPick: (pl: Place) => void }) {
    return <PostalLookup {...p} badgeHidden={!show} badgeId="pinBadge" listId="pinList" inputProps={{ id: 'rcvPin', className: 'field !pr-24', autoComplete: 'off', placeholder }} />;
}
