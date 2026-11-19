// Backups — super admin only. A copy of every business table is saved each night (with the 8 pm job); the last 14 are kept.
// Download any of them, or make one now. Data: /api/backups.
import { useEffect, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

type File = { name: string; size: number; created_at?: string };
const size = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const when = (f: File) => {
    const m = /alf-erp-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(f.name);
    const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+04:00`) : f.created_at ? new Date(f.created_at) : null;
    return d ? d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : f.name;
};

export function Backups() {
    const [list, setList] = useState<File[] | null>(null);
    const [keep, setKeep] = useState(14);
    const [busy, setBusy] = useState(false);
    const load = () => api<{ backups: File[]; keep: number }>('/api/backups').then(d => { setList(d.backups); setKeep(d.keep); }).catch(e => { toast(false, (e as Error).message); setList([]); });
    useEffect(() => { load(); }, []);
    async function now() {
        setBusy(true);
        try { const r = await api<{ name: string; tables: number; rows: number; bytes: number }>('/api/backups', { method: 'POST', body: { action: 'run' } }); toast(true, `Backup saved: ${r.tables} tables, ${r.rows.toLocaleString()} rows, ${size(r.bytes)}.`); load(); }
        catch (e) { toast(false, (e as Error).message); } finally { setBusy(false); }
    }
    async function download(f: File) {
        try { const { url } = await api<{ url: string }>(`/api/backups?download=${encodeURIComponent(f.name)}`); location.href = url; }
        catch (e) { toast(false, (e as Error).message); }
    }
    return <AppFrame>
        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-24 lg:pb-4">
            <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                    <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="lock" /></div>
                    <div><div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Backups</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{`Every night • last ${keep} kept • super admin only`}</p></div>
                </div>
                <button type="button" id="backupNow" className="btn btn-coral self-start" disabled={busy} onClick={now}><Icon name="refresh" />{busy ? 'Backing up…' : 'Back up now'}</button>
            </section>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 bg-white border border-gray-100 rounded-[1.75rem] overflow-hidden">
                    <table className="rtable w-full text-sm"><thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100"><th className="p-3 pl-5 font-extrabold">Backup</th><th className="p-3 font-extrabold">Size</th><th className="p-3 pr-5"></th></tr></thead>
                        <tbody id="backupList" className="divide-y divide-gray-100">{!list ? <tr><td colSpan={3} className="p-8 text-center text-gray-400">Loading…</td></tr>
                            : list.length ? list.map((f, i) => <tr key={f.name}><td className="p-3 pl-5" data-label="Backup"><b>{when(f)}</b>{i === 0 && <span className="pill-tag pill-green ml-2">latest</span>}<span className="block text-[11px] text-gray-400 font-mono">{f.name}</span></td>
                                <td className="p-3" data-label="Size">{size(f.size)}</td>
                                <td className="p-3 pr-5 text-right"><button type="button" className="btn btn-light btn-sm" onClick={() => download(f)}><Icon name="upload" cls="w-3.5 h-3.5 rotate-180" />Download</button></td></tr>)
                                : <tr><td colSpan={3} className="p-8 text-center text-gray-400">No backups yet — the first one is made tonight, or press "Back up now".</td></tr>}</tbody></table>
                </div>
                <aside className="bg-[#F8F8FA] rounded-[1.75rem] p-5 text-xs text-gray-600 space-y-3">
                    <p className="sd-label">What is in a backup</p>
                    <p>Every table of the ERP — shipments, customers, invoices, accounts, stock, staff, chat… — as one compressed file (.json.gz).</p>
                    <p><b>Left out on purpose:</b> integration API keys and warehouse / Main Office PIN codes. Sign-in passwords are kept by Supabase, not here.</p>
                    <p><b>Keep a copy yourself:</b> download one now and then and store it somewhere safe (another drive or cloud). This is on top of Supabase's own backups.</p>
                    <p><b>Restoring</b> is done by a developer from this file — nothing is overwritten from this page.</p>
                </aside>
            </div>
        </div>
    </AppFrame>;
}
