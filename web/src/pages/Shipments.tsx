// Shipments & AWB — same page as admin/shipments.html: quick add from Al-Farha Online (scan → review), bulk import,
// CSV upload, the shipment list with filters and row menu, new / review / edit form, cancel, delete, carrier sync
// and the shipment card drawer (details, tracking timeline, delivery & POD).
// Data: /api/bookings, /api/status, /api/branches, /api/delivery, /api/carrier-sync
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss as useDismissSafe } from '../components/Modal';
import { Icon, Svg } from '../components/Icon';
import { openMenu } from '../components/RowMenu';
import { PageLink } from '../components/PageLink';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { CityField, CountryField } from '../components/fields/PlaceFields';
import type { ComboboxHandle } from '../components/fields/Combobox';
import { ScanInput } from '../components/fields/Scan';
import { ShipmentDrawer, type DrawerActions } from '../components/ShipmentDrawer';
import { openPacking } from '../components/PackingList';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { confirm } from '../lib/dialogs';
import { clean } from '../lib/format';
import { hrefFor } from '../lib/pages';
import { session } from '../lib/session';
import { beep, toast } from '../lib/toast';
import { whatsapp as openWhatsapp } from '../lib/whatsapp';

const STAGES = ['', 'Booking', 'Pickup', 'Origin', 'Export', 'Transit', 'Destination', 'Last Mile', 'Delivered', 'Review'];
const FIELDS = ['package_type', 'weight', 'pieces', 'shipper', 'shipper_phone', 'origin_city', 'origin_country', 'consignee', 'consignee_phone', 'consignee_address', 'dest_city', 'dest_country', 'declared_value', 'amount'] as const;
const PLAIN = ['package_type', 'weight', 'pieces', 'shipper', 'consignee', 'consignee_address', 'declared_value', 'amount'] as const;
type Plain = typeof PLAIN[number];
const PACKAGE_TYPES = ['Parcel', 'Document', 'Air Freight', 'Sea Freight', 'Freight'];
const CSV_COLS = [['BookingID', 'awb'], ['PackageType', 'package_type'], ['Weight', 'weight'], ['PCS', 'pieces'], ['Shipper', 'shipper'], ['ShipperPhone', 'shipper_phone'],
    ['Consignee', 'consignee'], ['OriginCity', 'origin_city'], ['OriginCountry', 'origin_country'], ['DestCity', 'dest_city'], ['DestCountry', 'dest_country']] as const;

function parseCsv(text: string) { // handles quoted fields, commas and new lines inside quotes
    const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim()));
}

const statusPill = (b: any) => <span className={`pill-tag ${b.current_status_code === 'CANCELLED' ? 'pill-gray' : b.current_stage >= 8 ? 'pill-green' : 'pill-coral'}`}>{b.current_status || 'New'}</span>;

export function Shipments() {
    const navigate = useNavigate();
    const isAdmin = session.isAdmin();
    const canDelete = ['super_admin', 'head_office', 'branch_manager'].includes(session.role());
    const [intake, setIntake] = useState('drop_off');
    const [branches, setBranches] = useState<any[]>([]);
    const [workBranchV, setWorkBranchV] = useState('');
    const workBranch = () => (isAdmin ? workBranchRef.current : '');
    const workBranchRef = useRef(''); workBranchRef.current = workBranchV;
    const [statuses, setStatuses] = useState<any[]>([]);
    const statusInfo = useRef<Record<string, any>>({});
    const [list, setList] = useState<any[] | null>(null);
    const listCache = useRef<any[]>([]);
    const [search, setSearch] = useState(''), [statusF, setStatusF] = useState(''), [branchF, setBranchF] = useState('');
    const filters = useRef({ search, statusF, branchF }); filters.current = { search, statusF, branchF };
    const scanInput = useRef<HTMLInputElement>(null);
    const go = (file: 'booking.html') => { const t = hrefFor(file); if ('to' in t) navigate(t.to); else location.href = t.href; };

    useLive(() => loadList());   // reload when data changes (here, by Farah, another tab) — lib/live.ts
    async function loadList() {
        const { search, statusF, branchF } = filters.current;
        const p = new URLSearchParams({ limit: '100' });
        if (search.trim()) p.set('q', search.trim());
        if (statusF) p.set('status', statusF);
        if (isAdmin && branchF) p.set('branch', branchF);
        try {
            const { bookings } = await api('/api/bookings?' + p);
            listCache.current = bookings; setList(bookings);
        } catch (e) { toast(false, (e as Error).message); }
    }
    const searchT = useRef<ReturnType<typeof setTimeout>>();
    const firstFilters = useRef(true);
    useEffect(() => { if (firstFilters.current) return; loadList(); /* eslint-disable-next-line */ }, [statusF, branchF]);

    // ---------- shipment form ----------
    type FormState = { mode: 'new' | 'review' | 'edit'; source: string; raw: any; external_ref: any; original: any };
    const form = useRef<FormState>({ mode: 'new', source: 'manual', raw: null, external_ref: null, original: null });
    const [fOpen, setFOpen] = useState(false);
    const [mode, setMode] = useState<FormState['mode']>('new');
    const [awb, setAwb] = useState('');
    const [fBranch, setFBranch] = useState('');
    const [fIntake, setFIntake] = useState('drop_off');
    const [plain, setPlain] = useState<Record<Plain, string>>(() => Object.fromEntries(PLAIN.map(k => [k, k === 'package_type' ? 'Parcel' : ''])) as Record<Plain, string>);
    const [extraTypes, setExtraTypes] = useState<string[]>([]);
    const [dup, setDup] = useState<{ text: string } | null>(null);
    const [formSource, setFormSource] = useState('');
    const [fetching, setFetching] = useState(false);
    const [originCountry, setOriginCountry] = useState(''), [destCountry, setDestCountry] = useState('');
    const fetchInput = useRef<HTMLInputElement>(null), weightInput = useRef<HTMLInputElement>(null);
    const shipperPh = useRef<PhoneHandle>(null), consigneePh = useRef<PhoneHandle>(null);
    const oCity = useRef<ComboboxHandle>(null), oCountry = useRef<ComboboxHandle>(null), dCity = useRef<ComboboxHandle>(null), dCountry = useRef<ComboboxHandle>(null);
    const place: Record<'origin_city' | 'origin_country' | 'dest_city' | 'dest_country', React.RefObject<ComboboxHandle>> = { origin_city: oCity, origin_country: oCountry, dest_city: dCity, dest_country: dCountry };
    const setP = (k: Plain) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setPlain(v => ({ ...v, [k]: e.target.value }));

    function fillForm(row: any = {}) {
        setAwb(row.awb || '');
        const next = {} as Record<Plain, string>;
        FIELDS.forEach(k => {
            const v = row[k] ?? (k === 'package_type' ? 'Parcel' : '');
            if (k === 'shipper_phone' || k === 'consignee_phone') { const h = (k === 'shipper_phone' ? shipperPh : consigneePh).current!; if (v) h.setValue(String(v)); else h.reset(); }
            else if (k in place) { place[k as keyof typeof place].current?.setText(String(v)); if (k === 'origin_country') setOriginCountry(String(v)); if (k === 'dest_country') setDestCountry(String(v)); }
            else next[k as Plain] = String(v);
        });
        setPlain(next);
        if (row.package_type && !PACKAGE_TYPES.includes(row.package_type)) setExtraTypes(t => t.includes(row.package_type) ? t : [...t, row.package_type]);
        setFIntake(row.intake_mode || intake);
        if (row.branch_code) setFBranch(row.branch_code);
    }

    const dupText = (a: string, refused: boolean) => refused ? `Shipment ${a} already exists — saving will be refused. Open it from the list to edit.` : `Shipment ${a} already exists — open it from the list to edit.`;
    function openForm(m: FormState['mode'], data: any = {}) {
        form.current = { mode: m, source: data.source || 'manual', raw: data.raw || null, external_ref: data.external_ref || null, original: data.original || null };
        setMode(m);
        setFormSource(form.current.source === 'alfarhaonline' ? `Source: Al-Farha Online order ${form.current.external_ref || ''}` : m === 'edit' ? '' : 'Source: manual entry');
        fillForm({ branch_code: workBranch() || branches[0]?.branch_code, ...(data.row || {}) });
        setDup(data.exists ? { text: dupText(data.exists, true) } : null);
        setFOpen(true);
        setTimeout(() => (m === 'new' ? fetchInput.current : weightInput.current)?.focus(), 0);
    }

    const fetchPreview = (orderNo: string, branch: string) => api('/api/bookings', { method: 'POST', body: { action: 'preview', order_no: orderNo, branch } });
    const doFetch = async () => {
        const no = clean(fetchInput.current!.value);
        if (!no) return toast(false, 'Enter an order number.');
        setFetching(true);
        try {
            const { row, exists } = await fetchPreview(no, fBranch);
            form.current.source = 'alfarhaonline'; form.current.raw = row.raw; form.current.external_ref = row.external_ref;
            fillForm(row);
            setFormSource(`Source: Al-Farha Online order ${row.external_ref}`);
            setDup(exists ? { text: dupText(exists, false) } : null);
            beep(true);
        } catch (e) { toast(false, (e as Error).message); beep(false); }
        setFetching(false);
    };

    function readForm() {
        const fields: Record<string, string> = {};
        FIELDS.forEach(k => {
            fields[k] = k === 'shipper_phone' ? shipperPh.current!.value : k === 'consignee_phone' ? consigneePh.current!.value
                : k in place ? place[k as keyof typeof place].current?.text ?? '' : plain[k as Plain];
        });
        fields.intake_mode = fIntake;
        return { awb: clean(awb), fields, branch: branches.some(b => b.branch_code === fBranch) ? fBranch : '' };
    }

    const saveForm = async (e: React.FormEvent) => {
        e.preventDefault();
        const { awb, fields, branch } = readForm();
        if (!awb) return toast(false, 'Booking ID / AWB is required.');
        if (!fields.shipper.trim() || !fields.consignee.trim()) return toast(false, 'Shipper and consignee names are required.');
        const f = form.current;
        if (f.mode === 'edit') {
            const changed: Record<string, string> = Object.fromEntries(Object.entries(fields).filter(([k, v]) => String(v ?? '') !== String(f.original[k] ?? '')));
            if (isAdmin && branch !== f.original.branch_code) changed.__branch = branch;
            if (!Object.keys(changed).length) return setFOpen(false);
            const names = Object.keys(changed).map(k => k === '__branch' ? 'branch' : k.replace(/_/g, ' ')).join(', ');
            if (!await confirm({ title: `Save changes to ${awb}?`, message: <>{'Changing: '}<b>{names}</b>{'. The change is recorded on the shipment timeline.'}</>, confirmText: 'Save changes' })) return;
            const branchCode = changed.__branch; delete changed.__branch;
            try {
                await api('/api/bookings', { method: 'PATCH', body: { awb, fields: changed, branch_code: branchCode } });
                toast(true, `${awb} updated.`); setFOpen(false); loadList(); if (drawerOpenRef.current) openDrawer(awb);
            } catch (err) { toast(false, (err as Error).message); }
            return;
        }
        // Ask before adding — last chance to go back and edit.
        const summary = <span className="block bg-[#F8F8FA] rounded-2xl p-4 mt-1 text-xs text-gray-700 leading-6">
            <b>{awb}</b>{` • ${fields.package_type} • ${fields.weight || '—'} kg • ${fields.pieces || 1} pcs`}<br />
            {`${fields.shipper} → `}<b>{fields.consignee}</b><br />
            {`${[fields.dest_city, fields.dest_country].filter(Boolean).join(', ') || 'No destination'} • ${fields.intake_mode === 'pickup' ? 'Pickup' : 'Drop-off'} • Branch ${branch || '—'}`}</span>;
        if (!await confirm({ title: 'Add this shipment?', message: <>{'Please check the details. Choose '}<b>Cancel</b>{' to go back and edit.'}{summary}</>, confirmText: 'Add shipment' })) return;
        try {
            const out = await api('/api/bookings', { method: 'POST', body: { action: 'create', awb, fields, branch, source: f.source, external_ref: f.external_ref, raw: f.raw } });
            toast(true, `Shipment ${out.awb} added.`); beep(true);
            setFOpen(false); loadList();
        } catch (err) { toast(false, (err as Error).message); beep(false); }
    };

    // ---------- quick scan → review ----------
    const scanSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const no = clean(scanInput.current!.value);
        if (!no) return;
        if (isAdmin && !workBranch()) return toast(false, 'Choose the branch (top right) first.');
        scanInput.current!.value = '';
        try {
            const { row, exists } = await fetchPreview(no, workBranch());
            beep(true);
            openForm('review', { row: { ...row, intake_mode: intake }, source: 'alfarhaonline', raw: row.raw, external_ref: row.external_ref, exists });
        } catch (err) { toast(false, (err as Error).message); beep(false); scanInput.current!.focus(); }
    };
    const [bulkText, setBulkText] = useState('');
    const [bulkLog, setBulkLog] = useState<any[]>([]);
    const bulkImport = async () => {
        const orders = [...new Set(bulkText.split(/[\s,;]+/).map(clean).filter(Boolean))];
        if (!orders.length) return;
        if (isAdmin && !workBranch()) return toast(false, 'Choose the branch (top right) first.');
        if (!await confirm({ title: `Import ${orders.length} order(s) without review?`, message: 'They are added straight away with the details from Al-Farha Online. You can still edit each one afterwards.', confirmText: 'Import' })) return;
        setBulkLog([]);
        for (let i = 0; i < orders.length; i += 5) {
            try {
                const { results } = await api('/api/bookings', { method: 'POST', body: { action: 'import', order_nos: orders.slice(i, i + 5), branch: workBranch(), intake_mode: intake } });
                setBulkLog(l => [...l, ...results]);
            } catch (e) { toast(false, (e as Error).message); break; }
        }
        setBulkText(''); loadList();
    };

    // ---------- CSV ----------
    const [csvOpen, setCsvOpen] = useState(false);
    const [csvRows, setCsvRows] = useState<any[]>([]);
    const [csvBusy, setCsvBusy] = useState(false);
    const csvFile = useRef<HTMLInputElement>(null);
    const openCsv = () => { setCsvRows([]); setCsvBusy(false); if (csvFile.current) csvFile.current.value = ''; setCsvOpen(true); };
    const downloadTemplate = () => {
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(CSV_COLS.map(c => c[0]).join(',') + '\n');
        a.download = 'shipments-template.csv'; a.click();
    };
    const csvChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        const rows = parseCsv(await file.text());
        const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
        const idx = CSV_COLS.map(([h]) => head.indexOf(h.toLowerCase()));
        if (idx[0] < 0) { toast(false, 'The file needs a BookingID column — use the template.'); return; }
        const seen = new Set<string>();
        setCsvRows(rows.map(r => {
            const o: any = Object.fromEntries(CSV_COLS.map(([, k], i) => [k, idx[i] >= 0 ? (r[idx[i]] || '').trim() : '']));
            o.awb = clean(o.awb);
            o.problem = !o.awb ? 'No Booking ID' : seen.has(o.awb) ? 'Duplicate in file' : !o.shipper || !o.consignee ? 'Shipper & consignee needed' : '';
            seen.add(o.awb);
            return o;
        }));
    };
    const csvOk = csvRows.filter(r => !r.problem).length;
    const csvSave = async () => {
        const good = csvRows.filter(r => !r.problem).map(({ problem, ...r }) => r);
        if (isAdmin && !workBranch()) return toast(false, 'Choose the branch (top right) first.');
        if (!await confirm({ title: `Add ${good.length} shipments?`, message: <>{'They will be added to branch '}<b>{workBranch() || 'your branch'}</b>{'.'}</>, confirmText: 'Add shipments' })) return;
        setCsvBusy(true);
        let added = 0; const failed: string[] = [];
        for (let i = 0; i < good.length; i += 100) {
            try {
                const { results } = await api('/api/bookings', { method: 'POST', body: { action: 'create_many', rows: good.slice(i, i + 100), branch: workBranch() } });
                results.forEach((r: any) => (r.result === 'error' ? failed.push(`${r.awb}: ${r.error}`) : added++));
            } catch (e) { failed.push((e as Error).message); break; }
        }
        toast(!failed.length, `${added} added${failed.length ? ` • ${failed.length} failed — ${failed.slice(0, 3).join('; ')}` : ''}`);
        setCsvOpen(false); loadList();
    };

    // ---------- row actions ----------
    const rowMenu = (btn: Element, a: string) => {
        const b = listCache.current.find(x => x.awb === a) || {};
        const cancelled = b.current_status_code === 'CANCELLED';
        openMenu(btn, <>
            <button type="button" onClick={() => openDrawer(a)}><Icon name="eye" />{' View details'}</button>
            <button type="button" onClick={() => editShipment(a)}><Icon name="edit" />{' Edit details'}</button>
            <PageLink page="status-update.html" search={`?awb=${encodeURIComponent(a)}`}><Icon name="refresh" />{' Update status'}</PageLink>
            {b.shipper_phone && <button type="button" onClick={() => whatsapp(a)}><Icon name="message" />{' WhatsApp shipper'}</button>}
            <hr />
            {!cancelled && <button type="button" className="danger" onClick={() => cancelShipment(a)}><Icon name="ban" />{' Cancel shipment'}</button>}
            {canDelete && <button type="button" className="danger" onClick={() => deleteShipment(a)}><Icon name="trash" />{' Delete'}</button>}
        </>);
    };
    async function editShipment(a: string) {
        try {
            const { booking } = await api('/api/bookings?awb=' + encodeURIComponent(a));
            openForm('edit', { row: booking, original: booking, source: booking.source, external_ref: booking.external_ref });
        } catch (e) { toast(false, (e as Error).message); }
    }
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelTarget, setCancelTarget] = useState('');
    const [cancelReason, setCancelReason] = useState('');
    const cancelInput = useRef<HTMLInputElement>(null);
    function cancelShipment(a: string) { setCancelTarget(a); setCancelReason(''); setCancelOpen(true); setTimeout(() => cancelInput.current?.focus(), 0); }
    const cancelSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!cancelReason.trim()) return toast(false, 'Give a reason.');
        try {
            await api('/api/status', { method: 'POST', body: { awbs: [cancelTarget], code: 'CANCELLED', remark: cancelReason.trim() } });
            toast(true, `${cancelTarget} cancelled.`); setCancelOpen(false); loadList(); closeDrawer();
        } catch (err) { toast(false, (err as Error).message); }
    };
    async function deleteShipment(a: string) {
        if (!await confirm({ title: `Delete ${a} permanently?`, message: <>{'The shipment and its whole tracking history are removed. '}<b>This cannot be undone.</b>{' To keep the record, cancel it instead.'}</>, confirmText: 'Delete permanently', danger: true })) return;
        try {
            await api('/api/bookings?awb=' + encodeURIComponent(a), { method: 'DELETE' });
            toast(true, `${a} deleted.`); loadList(); closeDrawer();
        } catch (e) { toast(false, (e as Error).message); }
    }
    function whatsapp(a: string) { // same confirmation message idea as the old mobile booking screen
        const b = listCache.current.find(x => x.awb === a); if (!b) return;
        let phone = String(b.shipper_phone || '').replace(/[^0-9]/g, '');
        if (phone.length === 8) phone = '968' + phone; // Omani local number
        const text = `Hello ${b.shipper || 'Customer'},\n\nYour booking with *Al-Farha Cargo* is confirmed.\n\n📦 *Tracking ID:* ${a}\n🎯 *To:* ${b.consignee || ''}, ${[b.dest_city, b.dest_country].filter(Boolean).join(', ')}\n\nThank you for choosing Al-Farha Cargo.`;
        openWhatsapp(phone, text);
    }

    // ---------- shipment card drawer (web/src/components/ShipmentDrawer.tsx) ----------
    const [drawerAwb, setDrawerAwb] = useState<string | null>(null);
    const [drawerVer, setDrawerVer] = useState(0);
    const drawerOpenRef = useRef(false); drawerOpenRef.current = Boolean(drawerAwb);
    function openDrawer(a: string) { setDrawerAwb(a); setDrawerVer(v => v + 1); }
    function closeDrawer() { setDrawerAwb(null); }
    // ---------- carrier sync ----------
    const [syncing, setSyncing] = useState(false);
    async function syncCarriers(a?: string) {
        setSyncing(true);
        try {
            const r = await api('/api/carrier-sync', { method: 'POST', body: a ? { awb: a } : {} });
            const errs = r.errors.length ? ` • ${r.errors.length} error(s): ${r.errors[0].awb} ${r.errors[0].error}` : '';
            const skipped = r.skipped ? ` • ${r.skipped} skipped (carrier not active)` : '';
            toast(!r.errors.length, r.found ? `Checked ${r.checked}, ${r.updated} with new events, ${r.moved} status change(s)${skipped}${errs}` : 'No shipments with a forwarding docket to sync.');
            loadList(); if (a) openDrawer(a);
        } catch (e) { toast(false, (e as Error).message); }
        setSyncing(false);
    }

    // ---------- init ----------
    useEffect(() => {
        (async () => {
            try {
                const { statuses: st } = await api('/api/status');
                statusInfo.current = Object.fromEntries(st.map((s: any) => [s.code, s]));
                setStatuses(st);
            } catch (e) { toast(false, (e as Error).message); }
            try {
                const { branches: bl } = await api('/api/branches');
                setBranches(bl);
                if (bl[0]) setFBranch(b => b || bl[0].branch_code);
                if (isAdmin) {
                    let saved = ''; try { saved = localStorage.getItem('alfarha_work_branch') || ''; } catch { /* ignore */ }
                    const v = bl.some((b: any) => b.branch_code === saved) ? saved : '';
                    setWorkBranchV(v); workBranchRef.current = v;
                }
            } catch { /* branch list unavailable; the server uses the user's own branch */ }
            await loadList();
            firstFilters.current = false;
            const q = new URLSearchParams(location.search);
            const open = q.get('awb');
            if (open) openDrawer(open);
            if (q.has('new')) openForm('new');
            scanInput.current?.focus();
        })();
        // eslint-disable-next-line
    }, []);

    const statusGroups: [string, any[]][] = [];
    statuses.forEach(s => { const g = s.is_exception ? 'Exceptions' : STAGES[s.stage]; let e = statusGroups.find(x => x[0] === g); if (!e) statusGroups.push(e = [g, []]); e[1].push(s); });
    const branchOpts = branches.map(b => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} (${b.branch_code})`}</option>);

    // the Shipments page's own buttons on the card
    const cardActions: DrawerActions = (b, { cancelled, fab }) => <>
                <div className="flex items-center gap-1.5">
                    {fab('edit', 'Edit', () => editShipment(b.awb))}
                    {fab('box', 'Packing list', () => openPacking(b.awb))}
                    {b.shipper_phone && fab('message', 'WhatsApp', () => whatsapp(b.awb), 'fab-wa')}
                    {(b.fwd_docket || b.delivery_docket) && fab('sync', 'Carrier sync', () => syncCarriers(b.awb))}
                    {!cancelled && fab('ban', 'Cancel', () => cancelShipment(b.awb), 'fab-danger')}
                    {canDelete && fab('trash', 'Delete', () => deleteShipment(b.awb), 'fab-danger')}
                </div>
                <PageLink page="status-update.html" search={`?awb=${encodeURIComponent(b.awb)}`} className="fab fab-open fab-primary flex-shrink-0" title="Update status"><Icon name="refresh" /><span className="fab-label">Update status</span></PageLink>
    </>;
    const popups = <>
        <Modal id="formModal" open={fOpen} onClose={() => setFOpen(false)} panelClassName="max-w-3xl" form={{ id: 'shipForm', noValidate: true, onSubmit: saveForm }}>
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div>
                    <h3 id="formTitle" className="text-lg font-extrabold">{mode === 'edit' ? `Edit ${form.current.original?.awb ?? awb}` : mode === 'review' ? 'Review fetched order' : 'New Shipment'}</h3>
                    <p id="formSub" className="text-xs text-gray-400 mt-0.5">{mode === 'edit' ? 'Change any detail — every change is recorded on the timeline.' : mode === 'review' ? 'Check and correct the details before adding.' : 'Enter details manually, or fetch them from Al-Farha Online.'}</p>
                </div>
                <CloseBtn />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar my-5 pr-1 space-y-5">
                <div id="fetchRow" className={`bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100${mode !== 'new' ? ' hidden' : ''}`}>
                    <label className="ui-label" htmlFor="fetchInput">Fetch from Al-Farha Online (optional)</label>
                    <div className="flex gap-2">
                        <ScanInput ref={fetchInput} mode={() => doFetch()} inputProps={{ id: 'fetchInput', className: 'field', placeholder: 'Order no. — fills the form below', autoComplete: 'off', 'aria-label': 'Order number', onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); doFetch(); } } }} />
                        <button type="button" id="fetchBtn" className="btn btn-dark" disabled={fetching} onClick={doFetch}>{fetching ? 'Fetching…' : 'Fetch'}</button>
                    </div>
                </div>
                <div id="dupWarn" className={`${dup ? '' : 'hidden '}text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100 rounded-2xl px-4 py-3`}>{dup && <span className="inline-flex items-center gap-2"><Icon name="alert" />{dup.text}</span>}</div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div><label className="ui-label" htmlFor="f_awb">Booking ID / AWB <span className="req">*</span></label><input id="f_awb" className={`field${mode !== 'new' ? ' soft' : ''}`} required placeholder="e.g. 0620366" autoComplete="off" readOnly={mode !== 'new'} value={awb} onChange={e => setAwb(e.target.value)} /></div>
                    <div className={isAdmin ? '' : 'hidden'}><label className="ui-label" htmlFor="f_branch">Branch</label><select id="f_branch" className="field" disabled={!isAdmin} value={fBranch} onChange={e => setFBranch(e.target.value)}>{fBranch && !branches.some(b => b.branch_code === fBranch) && <option value={fBranch} hidden></option>}{branchOpts}</select></div>
                    <div><label className="ui-label">Intake</label>
                        <div className="seg w-full" role="group" aria-label="Intake mode" id="f_intake">
                            <button type="button" data-v="drop_off" aria-pressed={fIntake === 'drop_off'} className="flex-1" onClick={() => setFIntake('drop_off')}>Drop-off</button>
                            <button type="button" data-v="pickup" aria-pressed={fIntake === 'pickup'} className="flex-1" onClick={() => setFIntake('pickup')}>Pickup</button>
                        </div>
                    </div>
                </div>

                <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Package</legend>
                    <div><label className="ui-label" htmlFor="f_package_type">Package type</label>
                        <select id="f_package_type" className="field" value={plain.package_type} onChange={setP('package_type')}>
                            {[...PACKAGE_TYPES, ...extraTypes].map(t => <option key={t}>{t}</option>)}
                        </select></div>
                    <div><label className="ui-label" htmlFor="f_weight">Weight (kg)</label><input id="f_weight" ref={weightInput} className="field" type="number" step="0.01" min="0" placeholder="0.00" value={plain.weight} onChange={setP('weight')} /></div>
                    <div><label className="ui-label" htmlFor="f_pieces">Pieces / boxes</label><input id="f_pieces" className="field" type="number" min="1" step="1" placeholder="1" value={plain.pieces} onChange={setP('pieces')} /></div>
                </fieldset>

                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Shipper</legend>
                    <div><label className="ui-label" htmlFor="f_shipper">Name <span className="req">*</span></label><input id="f_shipper" className="field" placeholder="Sender's name" value={plain.shipper} onChange={setP('shipper')} /></div>
                    <div><label className="ui-label" htmlFor="f_shipper_phone">Phone</label><PhoneField ref={shipperPh} country="OM" inputProps={{ id: 'f_shipper_phone', className: 'field', placeholder: 'Mobile number' }} /></div>
                    <div><label className="ui-label" htmlFor="f_origin_city">Origin city</label><CityField ref={oCity} country={originCountry} inputProps={{ id: 'f_origin_city', className: 'field', placeholder: 'Select or type city' }} /></div>
                    <div><label className="ui-label" htmlFor="f_origin_country">Origin country</label><CountryField ref={oCountry} onChange={n => setOriginCountry(n)} inputProps={{ id: 'f_origin_country', className: 'field', placeholder: 'Select country' }} /></div>
                </fieldset>

                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Consignee</legend>
                    <div><label className="ui-label" htmlFor="f_consignee">Name <span className="req">*</span></label><input id="f_consignee" className="field" placeholder="Receiver's name" value={plain.consignee} onChange={setP('consignee')} /></div>
                    <div><label className="ui-label" htmlFor="f_consignee_phone">Phone</label><PhoneField ref={consigneePh} country="IN" inputProps={{ id: 'f_consignee_phone', className: 'field', placeholder: 'Mobile number' }} /></div>
                    <div className="sm:col-span-2"><label className="ui-label" htmlFor="f_consignee_address">Address</label><input id="f_consignee_address" className="field" placeholder="House, street, post office, district, state, PIN" value={plain.consignee_address} onChange={setP('consignee_address')} /></div>
                    <div><label className="ui-label" htmlFor="f_dest_city">Destination city</label><CityField ref={dCity} country={destCountry} inputProps={{ id: 'f_dest_city', className: 'field', placeholder: 'Select or type city' }} /></div>
                    <div><label className="ui-label" htmlFor="f_dest_country">Destination country</label><CountryField ref={dCountry} onChange={n => setDestCountry(n)} inputProps={{ id: 'f_dest_country', className: 'field', placeholder: 'Select country' }} /></div>
                </fieldset>

                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Value (optional)</legend>
                    <div><label className="ui-label" htmlFor="f_declared_value">Declared value</label><input id="f_declared_value" className="field" type="number" step="0.01" min="0" value={plain.declared_value} onChange={setP('declared_value')} /></div>
                    <div><label className="ui-label" htmlFor="f_amount">Charge / amount</label><input id="f_amount" className="field" type="number" step="0.01" min="0" value={plain.amount} onChange={setP('amount')} /></div>
                </fieldset>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-gray-100 gap-2">
                <p id="formSource" className="text-[11px] text-gray-400">{formSource}</p>
                <div className="flex gap-2">
                    <CancelBtn />
                    <button id="saveBtn" type="submit" className="btn btn-coral">{mode === 'edit' ? 'Save changes' : 'Review & add'}</button>
                </div>
            </div>
        </Modal>

        <Modal id="csvModal" open={csvOpen} onClose={() => setCsvOpen(false)} panelClassName="max-w-5xl">
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                <div>
                    <h3 className="text-lg font-extrabold">Upload shipments (CSV)</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Same columns as the old system. Review the rows, then add them.</p>
                </div>
                <CloseBtn noShrink />
            </div>
            <div className="flex flex-wrap gap-2 items-center my-4">
                <button type="button" className="btn btn-light btn-sm" onClick={downloadTemplate}>Download template</button>
                <label className="btn btn-dark btn-sm cursor-pointer">Choose CSV file<input id="csvFile" ref={csvFile} type="file" accept=".csv,text/csv" className="hidden" onChange={csvChosen} /></label>
                <span id="csvInfo" className="text-[11px] font-bold text-gray-500">{csvRows.length ? `${csvRows.length} rows • ${csvOk} ready • ${csvRows.length - csvOk} with problems (skipped)` : ''}</span>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar border border-gray-100 rounded-2xl min-h-[160px]">
                <table className="w-full text-[11px]"><thead id="csvHead" className="text-[10px] text-gray-400 uppercase text-left bg-[#F8F8FA]">{csvRows.length > 0 && <tr>{CSV_COLS.map(([h]) => <th key={h} className="p-2.5 font-extrabold">{h}</th>)}<th className="p-2.5 font-extrabold">Check</th></tr>}</thead>
                    <tbody id="csvRows" className="divide-y divide-gray-100">{csvRows.length ? csvRows.map((r, i) => (
                        <tr key={i} className={r.problem ? 'bg-[#FFF5F3]' : ''}>{CSV_COLS.map(([, k]) => <td key={k} className="p-2.5">{r[k]}</td>)}<td className="p-2.5">{r.problem ? <span className="pill-tag pill-coral">{r.problem}</span> : <span className="pill-tag pill-green">OK</span>}</td></tr>
                    )) : <tr><td className="p-8 text-center text-gray-400">No file chosen.</td></tr>}</tbody></table>
            </div>
            <div className="flex justify-end gap-2 pt-4">
                <CancelBtn />
                <button id="csvSave" type="button" className="btn btn-coral" disabled={csvBusy || !csvOk} onClick={csvSave}>{csvBusy ? 'Adding…' : csvRows.length ? `Add ${csvOk} shipment${csvOk === 1 ? '' : 's'}` : 'Add shipments'}</button>
            </div>
        </Modal>

        <Modal id="cancelModal" open={cancelOpen} onClose={() => setCancelOpen(false)} panelClassName="max-w-md" form={{ id: 'cancelForm', onSubmit: cancelSubmit }}>
            <h3 className="text-lg font-extrabold">{'Cancel shipment '}<span id="cancelAwb" className="text-coral-500">{cancelTarget}</span>{'?'}</h3>
            <p className="text-sm text-gray-500 mt-2">It stays in the system with status <b>Cancelled</b> and its history. Give a reason.</p>
            <label className="ui-label mt-4" htmlFor="cancelReason">Reason <span className="req">*</span></label>
            <input id="cancelReason" ref={cancelInput} className="field" required placeholder="e.g. Customer cancelled the order" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
            <div className="flex justify-end gap-2 mt-6">
                <CancelBtn text="Keep shipment" />
                <button className="btn btn-coral">Cancel shipment</button>
            </div>
        </Modal>

        <ShipmentDrawer awb={drawerAwb} version={drawerVer} onClose={closeDrawer} actions={cardActions} />
    </>;

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <section className="flex flex-col xl:flex-row xl:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center">
                            <Svg cls="w-4 h-4" d='<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>' />
                        </div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">{'Shipments & AWB'}</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Add • Import • Edit • Track</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2">
                        <select id="workBranch" className={`field pill col-span-2 sm:!w-auto !py-2.5${isAdmin && branches.length ? '' : ' hidden'}`} aria-label="Branch for new shipments" value={workBranchV}
                            onChange={e => { setWorkBranchV(e.target.value); try { localStorage.setItem('alfarha_work_branch', e.target.value); } catch { /* ignore */ } }}>
                            {isAdmin && branches.length > 0 && <><option value="">Branch for new shipments…</option>{branchOpts}</>}
                        </select>
                        <button id="syncBtn" type="button" className={`btn btn-light${session.role() !== 'staff' ? '' : ' hidden'}`} title="Pull latest tracking from SMSA, Aramex, DHL and 17Track" disabled={syncing} onClick={() => syncCarriers()}>
                            <Icon name="sync" />
                            <span>Sync carriers</span>
                        </button>
                        <button type="button" className="btn btn-light" onClick={openCsv}>
                            <Icon name="upload" />
                            Upload CSV
                        </button>
                        <button type="button" className="btn btn-coral col-span-2 sm:col-span-1" onClick={() => go('booking.html')}>
                            <Icon name="plus" />
                            New Shipment
                        </button>
                    </div>
                </section>

                <section className="bg-[#F8F8FA] rounded-[2rem] p-5 lg:p-6 mb-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div>
                            <div className="flex items-center gap-2"><span className="font-extrabold text-xs uppercase tracking-wider">Quick add from Al-Farha Online</span><span className="w-2 h-2 rounded-full bg-coral-500"></span></div>
                            <p className="text-[11px] text-gray-400 mt-1">Scan an order — you'll review and can edit the details before it's added.</p>
                        </div>
                        <div className="seg w-full sm:w-auto" role="group" aria-label="How the parcel arrives">
                            <button type="button" data-intake="drop_off" aria-pressed={intake === 'drop_off'} className="flex-1" onClick={() => setIntake('drop_off')}>Drop-off</button>
                            <button type="button" data-intake="pickup" aria-pressed={intake === 'pickup'} className="flex-1" onClick={() => setIntake('pickup')}>Pickup</button>
                        </div>
                    </div>
                    <form id="scanForm" className="flex flex-col sm:flex-row gap-2" onSubmit={scanSubmit}>
                        <ScanInput ref={scanInput} mode="submit" inputProps={{ id: 'scanInput', className: 'field scan', placeholder: 'Scan order no.', autoComplete: 'off', 'aria-label': 'Order number' }} />
                        <button className="btn btn-dark">{'Fetch & review'}</button>
                    </form>
                    <details className="mt-3">
                        <summary className="cursor-pointer text-[11px] font-bold text-gray-500">Bulk: import a list without review</summary>
                        <div className="flex flex-col sm:flex-row gap-2 mt-2">
                            <textarea id="bulkInput" rows={3} className="field" placeholder="Order numbers — one per line or comma separated" value={bulkText} onChange={e => setBulkText(e.target.value)}></textarea>
                            <button id="bulkBtn" type="button" className="btn btn-light self-start" onClick={bulkImport}>Import list</button>
                        </div>
                        <ul id="bulkLog" className="space-y-1.5 mt-3 max-h-48 overflow-y-auto custom-scrollbar text-[11px]">
                            {bulkLog.map((r, i) => <li key={i} className="flex justify-between bg-white rounded-xl px-3 py-2 border border-gray-100"><b>{r.awb || r.order_no}</b><span className={`pill-tag ${r.result === 'error' ? 'pill-coral' : r.result === 'imported' ? 'pill-green' : 'pill-amber'}`}>{r.result === 'error' ? r.error : r.result}</span></li>)}
                        </ul>
                    </details>
                </section>

                <section className="bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                    <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between mb-4">
                        <div className="flex items-center gap-2"><span className="font-extrabold text-xs uppercase tracking-wider">Shipments</span><span id="listCount" className="pill-tag pill-gray">{list ? `${list.length}${list.length === 100 ? '+' : ''}` : '…'}</span></div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex gap-2">
                            <input id="search" type="search" placeholder="Search AWB, name, country…" className="field pill lg:!w-60 !py-2.5" value={search}
                                onChange={e => { setSearch(e.target.value); clearTimeout(searchT.current); searchT.current = setTimeout(loadList, 350); }} />
                            <select id="statusFilter" className="field pill lg:!w-48 !py-2.5" aria-label="Filter by status" value={statusF} onChange={e => setStatusF(e.target.value)}>
                                <option value="">All statuses</option>
                                {statusGroups.map(([g, items]) => <optgroup key={g} label={g}>{items.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}</optgroup>)}
                            </select>
                            <select id="branchFilter" className={`field pill lg:!w-44 !py-2.5${isAdmin && branches.length ? '' : ' hidden'}`} aria-label="Filter by branch" value={branchF} onChange={e => setBranchF(e.target.value)}>
                                {isAdmin && branches.length > 0 && <><option value="">All branches</option>{branchOpts}</>}
                            </select>
                        </div>
                    </div>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-x-auto custom-scrollbar max-lg:bg-transparent max-lg:border-0">
                        <table className="rtable w-full text-xs min-w-[820px]">
                            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                <th className="p-3 pl-4 font-extrabold">AWB</th><th className="p-3 font-extrabold">Branch</th><th className="p-3 font-extrabold">Shipper / Consignee</th>
                                <th className="p-3 font-extrabold">Destination</th><th className="p-3 font-extrabold text-right">Wt / Pcs</th>
                                <th className="p-3 font-extrabold">Status</th><th className="p-3 font-extrabold text-right">Booked</th><th className="p-3 w-12"></th>
                            </tr></thead>
                            <tbody id="rows" className="divide-y divide-gray-100">
                                {!list ? <tr><td colSpan={8} className="cell-empty p-8 text-center text-gray-400">Loading…</td></tr>
                                    : list.length ? list.map(b => (
                                        <tr key={b.awb} className="hover:bg-[#F8F8FA] cursor-pointer" onClick={() => openDrawer(b.awb)}>
                                            <td className="cell-main p-3 pl-4" data-label="AWB">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-extrabold whitespace-nowrap text-[13px]">{b.awb}</span>
                                                    {b.intake_mode === 'pickup' && <span className="pill-tag pill-coral">Pickup</span>}
                                                    {b.source === 'manual' && <span className="pill-tag pill-gray">Manual</span>}
                                                </div>
                                            </td>
                                            <td className="p-3" data-label="Branch"><span className="pill-tag pill-gray">{b.branch_code || '—'}</span></td>
                                            <td className="p-3 max-w-[240px]" data-label="Shipper / Consignee">
                                                <p className="truncate text-gray-500">{b.shipper || '—'}</p>
                                                <p className="truncate font-bold">{b.consignee || '—'}</p>
                                            </td>
                                            <td className="p-3 text-gray-500" data-label="Destination">{[b.dest_city, b.dest_country].filter(Boolean).join(', ') || '—'}</td>
                                            <td className="p-3 text-right whitespace-nowrap" data-label="Wt / Pcs">{`${b.weight ?? '—'} kg · ${b.pieces ?? '—'}`}</td>
                                            <td className="p-3" data-label="Status">{statusPill(b)}<span className="block text-[9px] text-gray-400 mt-1 font-bold">{STAGES[b.current_stage] || ''}</span></td>
                                            <td className="p-3 text-right text-gray-400 whitespace-nowrap" data-label="Booked">{new Date(b.booked_at).toLocaleDateString()}</td>
                                            <td className="cell-menu p-3 relative" data-menu-root="" onClick={e => e.stopPropagation()}>
                                                <button type="button" onClick={e => rowMenu(e.currentTarget, b.awb)} aria-label={`Actions for ${b.awb}`} className="icon-btn"><Icon name="more" cls="w-5 h-5" /></button>
                                            </td>
                                        </tr>
                                    )) : <tr><td colSpan={8} className="cell-empty p-8 text-center text-gray-400">No shipments yet. Use <b>New Shipment</b>, scan an order, or upload a CSV.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </AppFrame>
    );
}

function CloseBtn({ noShrink = false }: { noShrink?: boolean }) {
    const dismiss = useDismissSafe();
    return <button type="button" onClick={dismiss} aria-label="Close" className={`w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500${noShrink ? '' : ' flex-shrink-0'}`}><Icon name="x" /></button>;
}
function CancelBtn({ text = 'Cancel' }: { text?: string }) {
    const dismiss = useDismissSafe();
    return <button type="button" className="btn btn-light" onClick={dismiss}>{text}</button>;
}
