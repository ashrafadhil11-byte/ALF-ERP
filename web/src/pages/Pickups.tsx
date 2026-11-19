// Pickups — collect cargo at the customer's door. Data: /api/pickups.
// Staff record a request (customer, address, day, time slot); a manager assigns a driver; the driver sees "My pickups"
// (call, WhatsApp, map, picked up / could not pick up); then "Make booking" opens the booking form with the sender filled in.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { toast } from '../lib/toast';

type Pickup = { id: number; pickup_no: string; branch_code: string; customer_name: string; phone: string; address: string; city?: string; pickup_date: string; slot: string;
    pieces?: number; weight_kg?: number; dest_country?: string; notes?: string; status: string; driver_id?: string; driver_name?: string; picked_pieces?: number; booking_awb?: string; reason?: string; created_by_name?: string };
type Board = { date: string; pickups: Pickup[]; drivers: { id: string; full_name: string; branch?: string }[]; branches: { branch_code: string; branch_name: string }[]; me: { id: string; is_driver: boolean; manager: boolean; branch?: string } };

const SLOT: Record<string, string> = { morning: 'Morning 8–12', afternoon: 'Afternoon 12–4', evening: 'Evening 4–8', any: 'Any time' };
const PILL: Record<string, string> = { requested: 'pill-amber', assigned: 'pill-dark', picked_up: 'pill-green', booked: 'pill-gray', cancelled: 'pill-gray', failed: 'pill-coral' };
const LABEL: Record<string, string> = { requested: 'Waiting for driver', assigned: 'Driver on the way', picked_up: 'Picked up — book it', booked: 'Booked', cancelled: 'Cancelled', failed: 'Could not pick up' };
const iso = (d = new Date()) => new Date(d.getTime() + 4 * 36e5).toISOString().slice(0, 10);
const shift = (d: string, n: number) => iso(new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5 - 4 * 36e5));
const dayName = (d: string) => d === iso() ? 'Today' : d === shift(iso(), 1) ? 'Tomorrow' : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const digits = (p: string) => p.replace(/\D/g, '');
const mapUrl = (p: Pickup) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.address, p.city].filter(Boolean).join(', '))}`;

export function Pickups() {
    const navigate = useNavigate();
    const [date, setDate] = useState(iso());
    const [branch, setBranch] = useState('');
    const [d, setD] = useState<Board | null>(null);
    const [mine, setMine] = useState<Pickup[]>([]);
    const [newOpen, setNewOpen] = useState(false);
    const blank = { customer_name: '', phone: '', address: '', city: '', pickup_date: iso(), slot: 'any', pieces: '', weight_kg: '', dest_country: '', notes: '' };
    const [f, setF] = useState(blank);
    const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));

    async function load() {
        try {
            const b = await api<Board>(`/api/pickups?date=${date}${branch ? `&branch=${branch}` : ''}`);
            setD(b);
            if (b.me.is_driver) setMine((await api<{ pickups: Pickup[] }>('/api/pickups?mine=1')).pickups);
        } catch (e) { toast(false, (e as Error).message); }
    }
    useEffect(() => { load(); }, [date, branch]);   // eslint-disable-line react-hooks/exhaustive-deps
    const act = async (body: object, ok: string) => { try { await api('/api/pickups', { method: 'POST', body }); toast(true, ok); load(); } catch (e) { toast(false, (e as Error).message); } };

    async function create(e: React.FormEvent) {
        e.preventDefault();
        try {
            const r = await api<{ pickup: Pickup }>('/api/pickups', { method: 'POST', body: { action: 'create', ...f, branch } });
            toast(true, `${r.pickup.pickup_no} saved for ${dayName(r.pickup.pickup_date)}.`); setNewOpen(false); setF(blank);
            if (r.pickup.pickup_date !== date) setDate(r.pickup.pickup_date); else load();
        } catch (err) { toast(false, (err as Error).message); }
    }
    const ask = async (p: Pickup, action: 'fail' | 'cancel') => {
        const reason = window.prompt(action === 'fail' ? `Why could ${p.pickup_no} not be picked up?` : `Why cancel ${p.pickup_no}?`, action === 'fail' ? 'Customer not reachable' : '');
        if (reason) act({ action, id: p.id, reason }, action === 'fail' ? 'Marked as not picked up.' : 'Cancelled.');
    };
    const picked = async (p: Pickup) => {
        if (!await confirm({ title: `Picked up ${p.pickup_no}?`, message: `${p.customer_name}${p.pieces ? ` · ${p.pieces} pieces expected` : ''}. Bring the cargo to the branch to book it.`, confirmText: 'Picked up' })) return;
        act({ action: 'picked', id: p.id }, 'Picked up — book it at the branch.');
    };

    const groups: [string, Pickup[]][] = d ? [
        ['Waiting for a driver', d.pickups.filter(p => p.status === 'requested')],
        ['Driver on the way', d.pickups.filter(p => p.status === 'assigned')],
        ['Picked up — to book', d.pickups.filter(p => p.status === 'picked_up')],
        ['Done', d.pickups.filter(p => ['booked', 'cancelled', 'failed'].includes(p.status))]] : [];

    const card = (p: Pickup, driverView = false) => <div key={p.id} data-pickup={p.id} className="bg-white border border-gray-100 rounded-[1.5rem] p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="font-extrabold text-sm truncate">{p.customer_name}</p>
            <p className="text-[11px] text-gray-400">{`${p.pickup_no} · ${p.pickup_date < (d?.date || iso()) ? dayName(p.pickup_date) + ' (late) · ' : ''}${SLOT[p.slot]}`}</p></div>
            <span className={`pill-tag ${PILL[p.status]} whitespace-nowrap`}>{LABEL[p.status]}</span></div>
        <p className="text-xs text-gray-600 flex gap-2"><Icon name="pin" cls="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400" />{[p.address, p.city].filter(Boolean).join(', ')}</p>
        <p className="text-[11px] text-gray-500">{[p.pieces && `${p.pieces} pcs`, p.weight_kg && `~${p.weight_kg} kg`, p.dest_country && `to ${p.dest_country}`, p.driver_name && `driver ${p.driver_name}`, p.booking_awb && `AWB ${p.booking_awb}`, p.reason].filter(Boolean).join(' · ')}</p>
        {p.notes && <p className="text-[11px] bg-[#F8F8FA] rounded-xl px-3 py-2 text-gray-600">{p.notes}</p>}
        <div className="flex flex-wrap gap-1.5">
            <a className="btn btn-light btn-sm" href={`tel:${p.phone}`}><Icon name="phone" cls="w-3.5 h-3.5" />Call</a>
            <a className="btn btn-light btn-sm" target="_blank" rel="noopener" href={`https://wa.me/${digits(p.phone)}`}><Icon name="message" cls="w-3.5 h-3.5" />WhatsApp</a>
            <a className="btn btn-light btn-sm" target="_blank" rel="noopener" href={mapUrl(p)}><Icon name="pin" cls="w-3.5 h-3.5" />Map</a>
            {p.status === 'assigned' && (driverView || d?.me.manager) && <><button type="button" className="btn btn-dark btn-sm" onClick={() => picked(p)}><Icon name="check" cls="w-3.5 h-3.5" />Picked up</button>
                <button type="button" className="btn btn-light btn-sm" onClick={() => ask(p, 'fail')}>Could not</button></>}
            {!driverView && ['assigned', 'picked_up'].includes(p.status) && <button type="button" className="btn btn-coral btn-sm" onClick={() => navigate(`/booking?pickup=${p.id}`)}><Icon name="plus" cls="w-3.5 h-3.5" />Make booking</button>}
            {!driverView && ['requested', 'assigned', 'failed'].includes(p.status) && <button type="button" className="btn btn-light btn-sm text-[#D55C48]" onClick={() => ask(p, 'cancel')}>Cancel</button>}
        </div>
        {!driverView && d?.me.manager && ['requested', 'assigned', 'failed'].includes(p.status) && <select className="field !py-2 text-xs" aria-label={`Driver for ${p.pickup_no}`} value={p.driver_id || ''}
            onChange={e => e.target.value && act({ action: 'assign', id: p.id, driver_id: e.target.value }, `Driver assigned to ${p.pickup_no}.`)}>
            <option value="">{d.drivers.length ? 'Assign a driver…' : 'No drivers — tick "Driver" in Staff & Users'}</option>
            {d.drivers.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select>}
    </div>;

    return <AppFrame after={<Modal id="newPickup" open={newOpen} onClose={() => setNewOpen(false)} panelClassName="max-w-xl">
        <form onSubmit={create} className="space-y-4">
            <div className="flex items-start justify-between"><div><h3 className="text-lg font-extrabold">New pickup</h3><p className="text-xs text-gray-400">A driver collects the cargo at the customer's door.</p></div>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setNewOpen(false)}><Icon name="x" /></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="ui-label" htmlFor="pkName">Customer name <span className="req">*</span></label><input id="pkName" className="field" required value={f.customer_name} onChange={set('customer_name')} /></div>
                <div><label className="ui-label" htmlFor="pkPhone">Mobile <span className="req">*</span></label><input id="pkPhone" className="field" required inputMode="tel" placeholder="+968 9xxx xxxx" value={f.phone} onChange={set('phone')} /></div>
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="pkAddr">Pickup address <span className="req">*</span></label><input id="pkAddr" className="field" required placeholder="Building, street, area, landmark" value={f.address} onChange={set('address')} /></div>
                <div><label className="ui-label" htmlFor="pkCity">City</label><input id="pkCity" className="field" value={f.city} onChange={set('city')} /></div>
                <div><label className="ui-label" htmlFor="pkDate">Day <span className="req">*</span></label><input id="pkDate" type="date" className="field" min={iso()} required value={f.pickup_date} onChange={set('pickup_date')} /></div>
                <div><label className="ui-label" htmlFor="pkSlot">Time</label><select id="pkSlot" className="field" value={f.slot} onChange={set('slot')}>{Object.entries(SLOT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="grid grid-cols-2 gap-2"><div><label className="ui-label" htmlFor="pkPcs">Pieces</label><input id="pkPcs" type="number" min="0" className="field" value={f.pieces} onChange={set('pieces')} /></div>
                    <div><label className="ui-label" htmlFor="pkKg">About kg</label><input id="pkKg" type="number" min="0" step="0.1" className="field" value={f.weight_kg} onChange={set('weight_kg')} /></div></div>
                <div><label className="ui-label" htmlFor="pkDest">Going to</label><input id="pkDest" className="field" placeholder="e.g. India" value={f.dest_country} onChange={set('dest_country')} /></div>
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="pkNotes">Notes</label><textarea id="pkNotes" rows={2} className="field" placeholder="Gate code, call before coming…" value={f.notes} onChange={set('notes')}></textarea></div>
            </div>
            <div className="flex justify-end"><button className="btn btn-coral" id="pkSave"><Icon name="truck" />Save pickup</button></div>
        </form></Modal>}>
        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
            <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                    <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="truck" /></div>
                    <div><div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Pickups</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Collect at the door • driver on the phone • book on return</p></div>
                </div>
                <button type="button" id="newPickupBtn" className="btn btn-coral self-start" onClick={() => { setF({ ...blank, pickup_date: date >= iso() ? date : iso() }); setNewOpen(true); }}><Icon name="plus" />New pickup</button>
            </section>

            {mine.length > 0 && <section className="mb-6"><p className="sd-label mb-2">{`My pickups · ${mine.length}`}</p>
                <div id="myPickups" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{mine.map(p => card(p, true))}</div></section>}

            <div className="flex flex-wrap items-center gap-2 mb-5">
                <div className="flex items-center gap-1 bg-[#F8F8FA] p-1 rounded-full">
                    <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => setDate(shift(date, -1))}><Icon name="arrowLeft" cls="w-4 h-4" /></button>
                    <input type="date" className="bg-transparent text-xs font-extrabold px-2 outline-none" aria-label="Day" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
                    <button type="button" className="icon-btn" aria-label="Next day" onClick={() => setDate(shift(date, 1))}><Icon name="arrowRight" cls="w-4 h-4" /></button></div>
                <span className="text-sm font-extrabold">{dayName(date)}</span>
                {d && d.branches.length > 0 && <select className="field !w-auto !py-2 text-xs" aria-label="Branch" value={branch} onChange={e => setBranch(e.target.value)}>
                    <option value="">All branches</option>{d.branches.map(b => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}</select>}
            </div>

            {!d ? <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-40 rounded-[1.5rem] bg-gray-50 animate-pulse" />)}</div>
                : <div id="pickupBoard" className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4">{groups.map(([title, list]) => <div key={title} className="bg-[#F8F8FA] rounded-[1.75rem] p-3 space-y-3 min-h-[120px]">
                    <p className="sd-label px-1">{`${title} · ${list.length}`}</p>
                    {list.length ? list.map(p => card(p)) : <p className="text-xs text-gray-400 px-1">Nothing here.</p>}</div>)}</div>}
        </div>
    </AppFrame>;
}
