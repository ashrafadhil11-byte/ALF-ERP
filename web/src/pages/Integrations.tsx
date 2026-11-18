// 3rd-party Integrations — same page as admin/integrations.html: connectors with status, test, add / edit
// (credentials are write-only). Data: GET/POST/PUT /api/integrations. Only the super admin edits.
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { session } from '../lib/session';
import './integrations.css';

type Adapter = { id: string; label: string; ready?: boolean; testInput?: string; configFields?: string[]; secretFields?: string[] };
type Integration = { id: string; name: string; kind: string; adapter: string; base_url?: string; active: boolean; config?: Record<string, string>;
    secret_set: string[]; last_status?: string; last_error?: string; last_sync_at?: string };

// this page talks to the API directly (no sign-out on 401 — the error is shown in the alert, as before)
async function call<T = any>(method: string, body?: unknown): Promise<T> {
    const res = await fetch('/api/integrations', {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token()}` },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}
export const label = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function StatusPill({ i }: { i: Integration }) {
    if (!i.active) return <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full">Inactive</span>;
    if (i.last_status === 'error') return <span className="text-[10px] font-bold bg-coral-50 text-coral-600 px-2.5 py-1 rounded-full">Error</span>;
    if (i.last_status === 'ok') return <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full">Healthy</span>;
    return <span className="text-[10px] font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">Not tested</span>;
}

type Form = { id: string; name: string; kind: string; adapter: string; base_url: string; active: boolean; config: Record<string, string>; secret: Record<string, string>; cur: Integration | null };

export function Integrations() {
    const canEdit = session.role() === 'super_admin';
    const [items, setItems] = useState<Integration[] | null>(null);
    const [adapters, setAdapters] = useState<Adapter[]>([]);
    const [alert, setAlert] = useState<{ ok: boolean; msg: string; n: number } | null>(null);
    const [tests, setTests] = useState<Record<string, string>>({});
    const [form, setForm] = useState<Form | null>(null);
    const [saving, setSaving] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const showAlert = (ok: boolean, msg: string) => setAlert({ ok, msg, n: Date.now() });
    useEffect(() => { if (!alert) return; const t = setTimeout(() => setAlert(null), 6000); return () => clearTimeout(t); }, [alert]);

    async function load() {
        try { const d = await call<{ integrations: Integration[]; adapters: Adapter[] }>('GET'); setItems(d.integrations); setAdapters(d.adapters); setTests({}); }   // the cards are redrawn: test boxes start empty, as before
        catch (e) { showAlert(false, (e as Error).message); }
    }
    useEffect(() => { load(); }, []);

    const adapterOf = (id: string) => adapters.find(a => a.id === id) || { id, label: id, secretFields: ['api_key'], configFields: [] };

    function openForm(id?: string) {
        const cur = (items || []).find(i => i.id === id) || null;
        setForm({ id: cur ? cur.id : '', name: cur ? cur.name : '', kind: cur ? cur.kind : 'carrier', base_url: cur ? cur.base_url || '' : '',
            active: cur ? cur.active : false, adapter: cur ? cur.adapter : 'generic_rest', config: { ...(cur?.config || {}) }, secret: {}, cur });
        setTimeout(() => nameRef.current?.focus(), 0);
    }
    // a different adapter shows its own fields; going back to the saved adapter shows the saved values again
    const changeAdapter = (adapter: string) => setForm(f => f && ({ ...f, adapter, config: f.cur && f.cur.adapter === adapter ? { ...(f.cur.config || {}) } : {}, secret: {} }));

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!form) return;
        const ad = adapterOf(form.adapter);
        const config: Record<string, string> = {}, secret: Record<string, string> = {};
        (ad.configFields || []).forEach(k => { const v = (form.config[k] || '').trim(); if (v) config[k] = v; });
        (ad.secretFields || []).forEach(k => { if (form.secret[k]) secret[k] = form.secret[k]; });
        setSaving(true);
        try {
            await call(form.id ? 'PUT' : 'POST', { id: form.id, config, secret, name: form.name, kind: form.kind, adapter: form.adapter, base_url: form.base_url, active: form.active });
            setForm(null); showAlert(true, 'Integration saved.'); load();
        } catch (err) { showAlert(false, (err as Error).message); }
        finally { setSaving(false); }
    }

    async function test(i: Integration) {
        const ad = adapters.find(a => a.id === i.adapter);
        const input: { value?: string } = {};
        if (ad?.testInput) {
            input.value = (tests[i.id] || '').trim();
            if (!input.value) return showAlert(false, 'Enter a value to test with.');
        }
        try { const r = await call<{ ok: boolean; message: string }>('POST', { action: 'test', id: i.id, input }); showAlert(r.ok, `${i.name}: ${r.message}`); }
        catch (e) { showAlert(false, (e as Error).message); }
        load();
    }

    const fad = form ? adapterOf(form.adapter) : null;
    const modal = (
        <div id="formModal" className={`${form ? 'flex' : 'hidden'} fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm items-center justify-center p-4`}>
            <form id="form" onSubmit={submit} className="bg-white rounded-[2.5rem] max-w-xl w-full p-6 lg:p-8 shadow-2xl border border-gray-100 flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                    <div>
                        <h3 id="formTitle" className="text-lg font-extrabold">{form?.cur ? `Edit ${form.cur.name}` : 'Add API'}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">Connection details for a 3rd-party service.</p>
                    </div>
                    <button type="button" onClick={() => setForm(null)} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500"><Icon name="x" /></button>
                </div>
                {form && fad && (
                    <div className="flex-1 overflow-y-auto space-y-4 my-5 pr-1 custom-scrollbar">
                        {/* kept first, like the old form: space-y-4 counts it, so the fields sit 16px lower */}
                        <input type="hidden" id="fId" value={form.id} readOnly />
                        <label className="block"><span className="text-xs font-bold text-gray-600">Name</span><input id="fName" ref={nameRef} required className="field mt-1" placeholder="e.g. SMSA Express" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block"><span className="text-xs font-bold text-gray-600">Type</span>
                                <select id="fKind" className="field mt-1" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                                    <option value="order_source">Order source</option>
                                    <option value="carrier">Carrier / tracking</option>
                                    <option value="notification">Notification</option>
                                    <option value="ai">AI / assistant</option>
                                    <option value="other">Other</option>
                                </select>
                            </label>
                            <label className="block"><span className="text-xs font-bold text-gray-600">Adapter</span>
                                <select id="fAdapter" className="field mt-1" value={form.adapter} onChange={e => changeAdapter(e.target.value)}>
                                    {adapters.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                                </select></label>
                        </div>
                        <label className="block"><span className="text-xs font-bold text-gray-600">Base URL</span><input id="fUrl" type="url" className="field mt-1" placeholder="https://api.example.com" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} /></label>
                        <div id="configFields" className="space-y-3">
                            {(fad.configFields || []).map(k => (
                                <label key={k} className="block"><span className="text-xs font-bold text-gray-600">{label(k)}</span>
                                    <input data-config={k} className="field mt-1" value={form.config[k] || ''} onChange={e => setForm({ ...form, config: { ...form.config, [k]: e.target.value } })} /></label>
                            ))}
                        </div>
                        <div className="bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100 space-y-3">
                            <p className="text-[10px] font-extrabold text-gray-400 uppercase">Credentials (write-only)</p>
                            <div id="secretFields" className="space-y-3">
                                {(fad.secretFields || []).length ? (fad.secretFields || []).map(k => {
                                    const saved = !!form.cur && form.cur.adapter === form.adapter && form.cur.secret_set.includes(k);
                                    return <label key={k} className="block"><span className="text-xs font-bold text-gray-600">{label(k)}</span>
                                        <input data-secret={k} type="password" autoComplete="new-password" className="field mt-1 bg-white" value={form.secret[k] || ''}
                                            placeholder={saved ? '•••••••• saved — leave empty to keep' : 'Enter value'} onChange={e => setForm({ ...form, secret: { ...form.secret, [k]: e.target.value } })} /></label>;
                                }) : <p className="text-xs text-gray-400">This adapter needs no credentials.</p>}
                            </div>
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input id="fActive" type="checkbox" className="w-4 h-4 accent-[#E86D58]" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
                            <span className="text-sm font-bold">Active</span>
                            <span className="text-xs text-gray-400">— the system uses this API</span>
                        </label>
                    </div>
                )}
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onClick={() => setForm(null)} className="text-xs font-bold text-gray-500 hover:text-gray-900 px-4">Cancel</button>
                    <button id="saveBtn" type="submit" disabled={saving} className="bg-[#111827] hover:bg-gray-800 text-white text-xs font-bold px-6 py-3 rounded-full">{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </form>
        </div>
    );

    const roomy = 'flex-1 bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-6 lg:p-8 flex flex-col relative z-10 overflow-hidden border border-white';
    return (
        <AppFrame mainClassName={roomy} after={modal}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <section className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                        </div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">3rd-Party Integrations</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Order sources • Carriers • Notifications</p>
                        </div>
                    </div>
                    <button id="addBtn" onClick={() => openForm()} className={`${canEdit ? 'flex' : 'hidden'} self-start bg-[#111827] hover:bg-gray-800 text-white px-5 py-3 rounded-full text-xs font-bold items-center gap-2 shadow-sm`}>
                        <svg className="w-4 h-4 text-coral-400" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path></svg>
                        Add API
                    </button>
                </section>

                <div id="alert" className={alert ? `text-sm p-4 rounded-xl border mb-5 ${alert.ok ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}` : 'hidden text-sm p-4 rounded-xl border mb-5'}>{alert?.msg}</div>

                <section className="bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                    <div id="list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {items === null ? <p className="text-xs text-gray-400">Loading…</p>
                            : !items.length ? <p className="text-xs text-gray-400">No integrations yet.</p>
                                : items.map(i => {
                                    const ad = adapters.find(a => a.id === i.adapter);
                                    return (
                                        <div key={i.id} className="bg-white rounded-[2rem] p-6 border border-gray-100/80 flex flex-col gap-3">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-extrabold truncate">{i.name}</p>
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{label(i.kind)} • {ad ? ad.label : i.adapter}</p>
                                                </div>
                                                <StatusPill i={i} />
                                            </div>
                                            <p className="text-xs text-gray-500 truncate">{i.base_url || 'No base URL'}</p>
                                            <p className="text-[11px] text-gray-400">{i.secret_set.length ? 'Credentials saved: ' + i.secret_set.join(', ') : 'No credentials saved'}</p>
                                            {i.last_error && <p className="text-[11px] text-coral-600 bg-coral-50 rounded-xl px-3 py-2">{i.last_error}</p>}
                                            <p className="text-[10px] text-gray-400">{i.last_sync_at ? 'Last check: ' + new Date(i.last_sync_at).toLocaleString() : 'Never checked'}</p>
                                            {ad?.testInput && <input id={`testno-${i.id}`} className="field !py-2 !text-xs" placeholder={`${ad.testInput} to test with`} aria-label={`${ad.testInput} to test`}
                                                value={tests[i.id] || ''} onChange={e => setTests(t => ({ ...t, [i.id]: e.target.value }))} />}
                                            <div className="flex gap-2 mt-auto pt-2">
                                                <button onClick={() => test(i)} disabled={!(ad && ad.ready)} title={ad && ad.ready ? undefined : 'No test written for this connector in connectors.js'}
                                                    className="flex-1 bg-[#F8F8FA] hover:bg-gray-100 disabled:opacity-40 border border-gray-200/70 text-xs font-bold py-2.5 rounded-full">Test</button>
                                                {canEdit && <button onClick={() => openForm(i.id)} className="flex-1 bg-[#111827] hover:bg-gray-800 text-white text-xs font-bold py-2.5 rounded-full">Edit</button>}
                                            </div>
                                        </div>
                                    );
                                })}
                    </div>
                </section>

                <p className="text-[11px] text-gray-400 mt-5 leading-relaxed">
                    API keys are stored server-side and never shown again after saving. To connect a brand-new provider,
                    add it to <code className="bg-gray-100 px-1 rounded">api/_lib/integrations/connectors.js</code> (copy the template at the bottom),
                    push, then add it here. Keys can also come from Vercel environment variables named in that file.
                </p>
            </div>
        </AppFrame>
    );
}
