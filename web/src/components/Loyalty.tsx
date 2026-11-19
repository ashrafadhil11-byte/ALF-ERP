// Loyalty points — the card on a customer's profile (balance, tier, history, manual adjust for managers)
// and the settings popup for head office (earn rate, point value, minimum to spend, tiers).
// Data: /api/customers (profile → loyalty, points; GET ?view=loyalty_settings; POST loyalty_adjust / loyalty_settings).
import { useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { Modal } from './Modal';
import { Icon } from './Icon';

export type LoyaltyStatus = { active: boolean; balance: number; year_points: number; tier: string; bonus: number; next_tier?: string | null; next_at?: number | null;
    point_value: Record<string, number>; min_redeem: number; earn_rate: Record<string, number> };
export type PointsRow = { id: number; kind: 'earn' | 'redeem' | 'reverse' | 'adjust'; points: number; currency?: string; amount?: number; note?: string; created_at: string; created_by_name?: string; invoices?: { invoice_no: string } | null };

const TIER_TONE: Record<string, string> = { Silver: 'from-gray-100 to-gray-50 text-gray-700', Gold: 'from-amber-100 to-amber-50 text-amber-800', Platinum: 'from-slate-800 to-slate-600 text-white' };
const KIND: Record<string, string> = { earn: 'Earned', redeem: 'Used', reverse: 'Reversed', adjust: 'Adjusted' };
const day = (v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function LoyaltyCard({ customerId, loyalty: ly, points, canAdjust, onChanged }: { customerId: number; loyalty: LoyaltyStatus | null; points: PointsRow[]; canAdjust: boolean; onChanged: () => void }) {
    const [adj, setAdj] = useState(false);
    const [pts, setPts] = useState(''); const [note, setNote] = useState('');
    if (!ly) return null;
    const worth = Object.entries(ly.point_value || {}).map(([cur, v]) => `${cur} ${(ly.balance * +v).toFixed(3)}`).join(' · ');
    const progress = ly.next_at ? Math.min(100, Math.round((ly.year_points / ly.next_at) * 100)) : 100;
    async function save() {
        try {
            const r = await api<{ balance: number }>('/api/customers', { method: 'POST', body: { action: 'loyalty_adjust', id: customerId, points: pts, note } });
            toast(true, `Points saved — balance ${r.balance}.`); setAdj(false); setPts(''); setNote(''); onChanged();
        } catch (e) { toast(false, (e as Error).message); }
    }
    return <div id="loyaltyCard" className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className={`lg:col-span-2 rounded-[1.5rem] p-4 bg-gradient-to-br ${TIER_TONE[ly.tier] || 'from-[#FFF5F3] to-white text-gray-800'} relative overflow-hidden`}>
            <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-extrabold uppercase tracking-wider opacity-70">{ly.active ? 'Loyalty' : 'Loyalty (switched off)'}</p>
                <p className="text-2xl font-extrabold tabular-nums mt-1">{ly.balance.toLocaleString()}<span className="text-xs font-bold opacity-70"> points</span></p>
                <p className="text-xs font-bold opacity-80">{worth ? `worth ${worth}` : ''}</p></div>
                <span className="text-[11px] font-extrabold rounded-full px-3 py-1 bg-white/70 text-gray-800"><Icon name="star" cls="w-3 h-3 inline -mt-0.5 mr-1" />{ly.tier}</span></div>
            <div className="mt-4"><div className="h-1.5 rounded-full bg-black/10 overflow-hidden"><div className="h-full bg-[#E86D58] rounded-full" style={{ width: `${progress}%` }} /></div>
                <p className="text-[10px] font-bold opacity-70 mt-1.5">{ly.next_tier ? `${ly.year_points} of ${ly.next_at} points this year → ${ly.next_tier}` : `${ly.year_points} points this year · top tier`}{ly.bonus ? ` · +${ly.bonus}% bonus` : ''}</p></div>
            {canAdjust && <button type="button" id="loyaltyAdjust" className="btn btn-light btn-sm mt-3" onClick={() => setAdj(v => !v)}><Icon name="edit" />Adjust</button>}
            {adj && <div className="mt-3 grid grid-cols-3 gap-2 bg-white rounded-2xl p-2">
                <input className="field !py-1.5" type="number" step="1" placeholder="+50 or -20" aria-label="Points" value={pts} onChange={e => setPts(e.target.value)} />
                <input className="field !py-1.5 col-span-2" placeholder="Reason" aria-label="Reason" value={note} onChange={e => setNote(e.target.value)} />
                <button type="button" className="btn btn-dark btn-sm col-span-3" onClick={save}>Save</button></div>}
        </div>
        <div className="lg:col-span-3 bg-white border border-gray-100 rounded-[1.5rem] p-3 max-h-56 overflow-y-auto custom-scrollbar">
            <p className="sd-label mb-2 px-1">Points history</p>
            {points.length ? points.map(p => <div key={p.id} className="flex items-center justify-between gap-3 text-xs px-1 py-1.5 border-b border-gray-50 last:border-0">
                <span className="min-w-0"><b>{KIND[p.kind]}</b><span className="text-gray-400">{` · ${day(p.created_at)}${p.invoices?.invoice_no ? ' · ' + p.invoices.invoice_no : ''}${p.note && p.kind !== 'earn' ? ' · ' + p.note : ''}`}</span></span>
                <span className={`font-extrabold tabular-nums ${p.points > 0 ? 'text-emerald-600' : 'text-[#D55C48]'}`}>{`${p.points > 0 ? '+' : ''}${p.points}`}</span></div>)
                : <p className="text-xs text-gray-400 px-1">No points yet — they come with every paid invoice.</p>}
        </div>
    </div>;
}

type Settings = { active: boolean; earn_rate: Record<string, number>; point_value: Record<string, number>; min_redeem: number; tiers: { name: string; min: number; bonus: number }[]; updated_at?: string; updated_by?: string };
const toText = (o: Record<string, number>) => Object.entries(o || {}).map(([k, v]) => `${k}=${v}`).join(', ');
const fromText = (t: string) => Object.fromEntries(t.split(',').map(x => x.split('=').map(y => y.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toUpperCase(), +v]));

export function LoyaltySettingsButton() {
    const [open, setOpen] = useState(false);
    const [s, setS] = useState<Settings | null>(null);
    const [earn, setEarn] = useState(''); const [value, setValue] = useState('');
    async function show() {
        try {
            const d = await api<{ settings: Settings }>('/api/customers?view=loyalty_settings');
            setS(d.settings); setEarn(toText(d.settings.earn_rate)); setValue(toText(d.settings.point_value)); setOpen(true);
        } catch (e) { toast(false, (e as Error).message); }
    }
    async function save() {
        if (!s) return;
        try {
            await api('/api/customers', { method: 'POST', body: { action: 'loyalty_settings', ...s, earn_rate: fromText(earn), point_value: fromText(value) } });
            toast(true, 'Loyalty settings saved.'); setOpen(false);
        } catch (e) { toast(false, (e as Error).message); }
    }
    const setTier = (i: number, k: 'name' | 'min' | 'bonus', v: string) => setS(x => x && ({ ...x, tiers: x.tiers.map((t, j) => j === i ? { ...t, [k]: k === 'name' ? v : +v } : t) }));
    return <>
        <button type="button" id="loyaltySettings" className="btn btn-light btn-sm" onClick={show}><Icon name="star" />Loyalty settings</button>
        <Modal id="loyaltySettingsModal" open={open} onClose={() => setOpen(false)} panelClassName="max-w-lg">
            {s && <div className="space-y-4">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold">Loyalty settings</h3>
                    <p className="text-xs text-gray-400">{s.updated_by ? `Last changed by ${s.updated_by}` : 'Points are earned on every paid invoice.'}</p></div>
                    <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><Icon name="x" /></button></div>
                <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="w-4 h-4 accent-[#E86D58]" checked={s.active} onChange={e => setS({ ...s, active: e.target.checked })} />Loyalty points on</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="ui-label" htmlFor="lEarn">Points per 1 unit paid</label><input id="lEarn" className="field" value={earn} onChange={e => setEarn(e.target.value)} placeholder="OMR=1" />
                        <p className="text-[10px] text-gray-400 mt-1">Per currency, e.g. OMR=1. A currency not listed earns nothing.</p></div>
                    <div><label className="ui-label" htmlFor="lValue">Value of 1 point</label><input id="lValue" className="field" value={value} onChange={e => setValue(e.target.value)} placeholder="OMR=0.01" />
                        <p className="text-[10px] text-gray-400 mt-1">OMR=0.01 means 100 points = OMR 1.</p></div>
                    <div><label className="ui-label" htmlFor="lMin">Spend from (points)</label><input id="lMin" type="number" min="1" className="field" value={s.min_redeem} onChange={e => setS({ ...s, min_redeem: +e.target.value })} /></div>
                </div>
                <div><p className="ui-label">Tiers (by points earned in the last 12 months)</p>
                    <div className="space-y-2">{s.tiers.map((t, i) => <div key={i} className="grid grid-cols-3 gap-2">
                        <input className="field" aria-label="Tier name" value={t.name} onChange={e => setTier(i, 'name', e.target.value)} />
                        <input className="field" type="number" min="0" aria-label="From points" value={t.min} disabled={i === 0} onChange={e => setTier(i, 'min', e.target.value)} />
                        <input className="field" type="number" min="0" aria-label="Bonus %" value={t.bonus} onChange={e => setTier(i, 'bonus', e.target.value)} /></div>)}</div>
                    <p className="text-[10px] text-gray-400 mt-1">Name · from points · bonus % on points earned.</p></div>
                <div className="flex justify-end"><button type="button" className="btn btn-coral" onClick={save}>Save settings</button></div>
            </div>}
        </Modal>
    </>;
}
