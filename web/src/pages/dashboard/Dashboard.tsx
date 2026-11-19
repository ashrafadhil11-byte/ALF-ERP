// Dashboard — same page as admin/super-dashboard.html with admin/widgets/*: live data (GET /api/dashboard, every 60 s),
// role-scoped widgets in a 4-column grid, Customize mode (drag to reorder, size pills, corner resize, remove),
// widget catalog, layout saved to the account (GET/POST /api/dashboard-layout) with a local copy, branch picker for admins.
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../../components/frame/AppFrame';
import { session } from '../../lib/session';
import { Loading, type Dash } from './ui';
import { WIDGETS } from './widgets';
import './dashboard.css';

type Item = { id: string; size: string };
type Layout = { items: Item[]; removed: string[] };
const PORTAL_TITLES: Record<string, string> = { super_admin: 'Super Admin Portal', head_office: 'Head Office Portal', branch_manager: 'Branch Manager Portal', staff: 'Staff Workspace' };
const DEFAULT_SIZES = ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2', '4x2'];
const SYNC_BASE = 'text-[10px] font-bold text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-full border border-emerald-100 whitespace-nowrap';

const parseSize = (s: string) => { const [cols, rows] = (s || '1x2').split('x').map(Number); return { cols: cols || 1, rows: rows || 2 }; };
const roomy = 'flex-1 bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-6 lg:p-8 flex flex-col relative z-10 overflow-hidden border border-white';
const readLS = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export function Dashboard() {
    const role = session.role();
    const registry = WIDGETS.filter(w => !w.roles || w.roles.includes(role));
    const CACHE_KEY = 'alfarha_layout_v3_' + (readLS('cargo_user_role') || 'staff');
    const defaults = (): Layout => ({ items: registry.map(w => ({ id: w.id, size: w.defaultSize || '1x2' })), removed: [] });
    // reconcile a saved layout with widgets added since
    const normalize = (saved: any): Layout => {
        if (!saved || !Array.isArray(saved.items)) return defaults();
        const items: Item[] = [...saved.items];
        const removed: string[] = Array.isArray(saved.removed) ? [...saved.removed] : [];
        registry.forEach(w => { if (!items.some(i => i.id === w.id) && !removed.includes(w.id)) items.push({ id: w.id, size: w.defaultSize || '1x2' }); });
        return { items, removed };
    };

    const [layout, setLayoutState] = useState<Layout>(() => { try { const c = readLS(CACHE_KEY); return c ? normalize(JSON.parse(c)) : normalize(null); } catch { return normalize(null); } });
    const layoutRef = useRef(layout); layoutRef.current = layout;
    const [edit, setEdit] = useState(false);
    const [modal, setModal] = useState(false);
    const [dash, setDash] = useState<Dash | null>(null);
    const [branch, setBranch] = useState(() => readLS('alfarha_dash_branch') || '');
    const [allBranches, setAllBranches] = useState<{ branch_code: string; branch_name?: string }[] | null>(null);
    const [sync, setSync] = useState({ text: 'Connecting…', cls: SYNC_BASE });
    const [query, setQuery] = useState('');
    const [now, setNow] = useState(() => new Date());
    const dragged = useRef<string | null>(null);
    const grid = useRef<HTMLDivElement>(null);
    const branchFetch = useRef(false);

    // ---------- layout: local copy + the account ----------
    async function persist(next: Layout) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        setSync({ text: 'Saving...', cls: 'text-[10px] font-bold text-coral-500 hidden sm:inline' });
        const token = session.token(); if (!token) return;
        try {
            const res = await fetch('/api/dashboard-layout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ config: next }) });
            if (res.ok) setSync({ text: 'Cloud Synced', cls: 'text-[10px] font-bold text-emerald-600 hidden sm:inline' });
        } catch { setSync({ text: 'Offline Saved', cls: 'text-[10px] font-bold text-amber-500 hidden sm:inline' }); }
    }
    const setLayout = (next: Layout, save = true) => { layoutRef.current = next; setLayoutState(next); if (save) persist(next); };

    const layoutLoaded = useRef(false);
    useEffect(() => {
        if (layoutLoaded.current) return;   // once per visit (React's dev mode runs effects twice)
        layoutLoaded.current = true;
        (async () => {
            const token = session.token(); if (!token) return;
            try {
                const res = await fetch('/api/dashboard-layout', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.config) { const l = normalize(data.config); try { localStorage.setItem(CACHE_KEY, JSON.stringify(l)); } catch { /* ignore */ } setLayout(l, false); }
                    else await persist(layoutRef.current);   // first time: save the current layout to the account
                }
            } catch { /* offline: keep the local copy */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------- live data ----------
    async function loadData(code = branch) {
        const token = session.token(); if (!token) return;
        try {
            const res = await fetch(`/api/dashboard${code ? `?branch=${encodeURIComponent(code)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.status === 401) { localStorage.removeItem('cargo_auth_token'); location.replace('/app/login'); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load');
            setDash(data);
            setSync({ text: `Live • ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, cls: 'text-[10px] font-bold text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-full border border-emerald-100' });
        } catch (e) {
            setSync({ text: (e as Error).message || 'Offline', cls: 'text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100' });
        }
    }
    const branchRef = useRef(branch); branchRef.current = branch;
    useEffect(() => {
        loadData();
        const t = setInterval(() => { if (!document.hidden) loadData(branchRef.current); }, 60000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const pickBranch = (code: string) => {
        setBranch(code);
        try { localStorage.setItem('alfarha_dash_branch', code); } catch { /* ignore */ }
        setDash(null);
        loadData(code);
    };

    // admins: full branch list for the picker (from "all branches" data, or fetched once when opened on one branch)
    const isAdmin = dash?.me?.role === 'super_admin' || dash?.me?.role === 'head_office';
    useEffect(() => {
        if (!dash || !isAdmin) return;
        if (dash.scope === 'ALL') { setAllBranches(dash.branches || []); return; }
        if (!allBranches && !branchFetch.current) {
            branchFetch.current = true;
            fetch('/api/branches', { headers: { Authorization: `Bearer ${session.token()}` } }).then(r => r.json()).then(j => setAllBranches(j.branches || [])).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dash]);

    // clock
    useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

    // ---------- customize ----------
    const changeSize = (id: string, size: string) => {
        if (!edit) return;
        setLayout({ ...layout, items: layout.items.map(i => i.id === id ? { ...i, size } : i) });
    };
    const removeWidget = (id: string) => {
        if (!edit) return;
        setLayout({ items: layout.items.filter(i => i.id !== id), removed: layout.removed.includes(id) ? layout.removed : [...layout.removed, id] });
    };
    const toggleWidget = (id: string) => {
        const def = registry.find(w => w.id === id);
        if (layout.items.some(i => i.id === id)) setLayout({ items: layout.items.filter(i => i.id !== id), removed: layout.removed.includes(id) ? layout.removed : [...layout.removed, id] });
        else setLayout({ items: [...layout.items, { id, size: def?.defaultSize || '1x2' }], removed: layout.removed.filter(r => r !== id) });
    };
    const reset = () => setLayout(defaults());
    const drop = (target: string) => {
        if (!edit || !dragged.current || dragged.current === target) { dragged.current = null; return; }
        const items = [...layout.items];
        const from = items.findIndex(i => i.id === dragged.current), to = items.findIndex(i => i.id === target);
        if (from > -1 && to > -1) { const [m] = items.splice(from, 1); items.splice(to, 0, m); setLayout({ ...layout, items }); }
        dragged.current = null;
    };
    // drag the bottom-right corner: snaps to the nearest size this widget allows
    const startResize = (e: React.MouseEvent, id: string) => {
        if (!edit) return;
        e.stopPropagation(); e.preventDefault();
        const cell = grid.current?.querySelector(`[data-widget-id="${id}"]`); if (!cell || !grid.current) return;
        const allowed = registry.find(w => w.id === id)?.allowedSizes || DEFAULT_SIZES;
        const rect = cell.getBoundingClientRect(), colWidth = grid.current.getBoundingClientRect().width / 4, rowHeight = 195;
        const move = (ev: MouseEvent) => {
            const tc = Math.max(1, Math.min(4, Math.round((ev.clientX - rect.left) / colWidth)));
            const tr = Math.max(1, Math.min(3, Math.round((ev.clientY - rect.top) / rowHeight)));
            const cand = `${tc}x${tr}`;
            const best = allowed.includes(cand) ? cand : allowed.reduce((p, c) => {
                const a = parseSize(p), b = parseSize(c);
                return Math.hypot(b.cols - tc, b.rows - tr) < Math.hypot(a.cols - tc, a.rows - tr) ? c : p;
            });
            const cur = layoutRef.current;
            if (cur.items.find(i => i.id === id)?.size !== best) setLayout({ ...cur, items: cur.items.map(i => i.id === id ? { ...i, size: best } : i) }, false);
        };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); persist(layoutRef.current); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };

    const active = layout.items.map(i => ({ ...i, def: registry.find(w => w.id === i.id)! })).filter(i => i.def);
    const portal = dash ? (PORTAL_TITLES[dash.me?.role || ''] || 'Dashboard') + (dash.me?.is_driver ? ' • Driver' : '') : 'Dashboard';
    const names = (dash?.branches || []).map(b => b.branch_name || b.branch_code);
    const scope = !dash ? 'Loading…' : dash.scope === 'ALL' ? 'All Branches' : `Branch • ${names[0] || dash.scope}`;

    const catalog = (
        <div id="widget-modal" className={`${modal ? 'flex' : 'hidden'} fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm items-center justify-center p-4`}>
            <div className="bg-white rounded-[2.5rem] max-w-xl w-full p-6 lg:p-8 shadow-2xl border border-gray-100 flex flex-col max-h-[85vh]">
                <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                    <div>
                        <h3 className="text-lg font-extrabold text-gray-900">Manage Dashboard Widgets</h3>
                        <p className="text-xs text-gray-400 mt-0.5">Add or remove modules from your dashboard.</p>
                    </div>
                    <button onClick={() => setModal(false)} className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div id="widget-catalog-list" className="flex-1 overflow-y-auto space-y-3 my-5 pr-1 custom-scrollbar">
                    {registry.map(w => {
                        const item = layout.items.find(i => i.id === w.id), on = !!item, size = item ? item.size : (w.defaultSize || '1x2');
                        return (
                            <div key={w.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border gap-3 ${on ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50/70 border-gray-100 opacity-75'} transition-all`}>
                                <div className="pr-2">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-bold text-gray-900">{w.title}</h4>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase">{w.category}</span>
                                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-coral-50 text-coral-600">{size.replace('x', '×')}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">{w.description}</p>
                                </div>
                                <button onClick={() => toggleWidget(w.id)} className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 ${on ? 'bg-coral-50 text-coral-600 hover:bg-coral-100' : 'bg-[#111827] text-white hover:bg-gray-800 shadow-sm'}`}>
                                    {on ? 'Remove' : '+ Add Widget'}
                                </button>
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                    <button onClick={reset} className="text-xs font-bold text-gray-500 hover:text-gray-900 underline">Reset to Default Layout</button>
                    <button onClick={() => setModal(false)} className="bg-[#111827] hover:bg-gray-800 text-white text-xs font-bold px-6 py-3 rounded-full transition-colors">Done</button>
                </div>
            </div>
        </div>
    );

    return (
        <AppFrame mainClassName={roomy} after={catalog} onSearch={setQuery}>
            <section className="dash-bar flex flex-wrap items-center justify-between gap-2.5 pb-4 mb-4 border-b border-gray-100 flex-shrink-0">
                <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                    <div className="flex items-center gap-2.5 h-11 bg-[#F8F8FA] pl-1 pr-4 rounded-full border border-gray-200/70 shadow-sm min-w-0 max-w-[280px]">
                        <div className="w-9 h-9 rounded-full bg-[#111827] text-white flex items-center justify-center font-extrabold text-[11px] tracking-tight flex-shrink-0">AF</div>
                        <div className="min-w-0 leading-tight">
                            <div className="flex items-center gap-1.5">
                                <span id="portalTitle" className="text-xs font-extrabold text-gray-900 tracking-tight truncate">{portal}</span>
                                <span className="w-1.5 h-1.5 rounded-full bg-coral-500 flex-shrink-0"></span>
                            </div>
                            <p id="portalScope" className="text-[10px] font-medium text-gray-400 truncate">{scope}</p>
                        </div>
                    </div>
                    <select id="branchPicker" aria-label="Show branch" value={branch} onChange={e => pickBranch(e.target.value)}
                        className={`${isAdmin ? '' : 'hidden '}field pill !h-11 !py-0 !pl-4 !pr-9 !text-xs !w-auto max-w-[190px] flex-shrink-0`}>
                        {isAdmin && <><option value="">All branches</option>{(allBranches || []).map(b => <option key={b.branch_code} value={b.branch_code}>{b.branch_name || b.branch_code}</option>)}</>}
                    </select>
                    <span id="cloudSyncStatus" className={sync.cls}>{sync.text}</span>
                </div>

                <div className="flex items-center gap-2.5 flex-shrink-0">
                    <button type="button" onClick={() => setModal(true)} className="fab" title="Add or remove widgets">
                        <svg className="w-4 h-4 text-coral-500 fab-ic" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path></svg>
                        <span className="fab-label">Widgets</span>
                        <span id="active-widget-count" className="fab-badge">{`${layout.items.length}/${registry.length}`}</span>
                    </button>
                    <button type="button" id="editLayoutBtn" onClick={() => setEdit(v => !v)} className={`fab${edit ? ' is-on' : ''}`} title="Arrange and resize widgets">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
                        <span className="fab-label">{edit ? 'Done customizing' : 'Customize'}</span>
                    </button>
                    <div className="hidden sm:flex h-11 items-center gap-2.5 bg-[#F8F8FA] pl-4 pr-1 rounded-full border border-gray-100 whitespace-nowrap">
                        <div className="text-right leading-none">
                            <p className="text-sm font-extrabold text-gray-900 tracking-tight tabular-nums" id="currentTime">{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</p>
                            <p className="text-[8px] font-bold text-coral-500 uppercase tracking-widest mt-0.5">Local time</p>
                        </div>
                        <div className="h-9 flex items-center gap-2 bg-white rounded-full pl-1 pr-3 border border-gray-200/80 shadow-sm">
                            <span className="w-7 h-7 rounded-full bg-[#111827] text-white flex items-center justify-center text-[11px] font-extrabold" id="currentDay">{String(now.getDate()).padStart(2, '0')}</span>
                            <div className="leading-tight">
                                <p className="text-[11px] font-bold text-gray-900" id="currentDayName">{now.toLocaleDateString('en-US', { weekday: 'long' })}</p>
                                <p className="text-[10px] font-medium text-gray-400" id="currentMonthYear">{now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div id="customize-mode-banner" className={`${edit ? 'flex' : 'hidden'} items-center justify-between bg-[#111827] text-white px-5 py-3 rounded-2xl mb-4 shadow-md flex-shrink-0`}>
                <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-coral-500 animate-ping"></span>
                    <p className="text-xs font-semibold">
                        <span className="font-extrabold text-coral-400">Customize Mode Active:</span> Drag cards to reorder, click <span className="underline">2×2 / 2×3</span> pills or drag the bottom-right corner handle to resize. Changes sync to your account automatically.
                    </p>
                </div>
                <button onClick={reset} className="text-[11px] font-bold text-gray-300 hover:text-white underline flex-shrink-0 ml-4">Reset Default Grid</button>
            </div>

            <div className="dash-scroll flex-1 min-h-0 overflow-y-auto pretty-scroll -mr-2 pr-2">
                <section className="bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                    <div id="widgets-grid" ref={grid} className="smart-widget-grid">
                        {active.length === 0 ? (
                            <div style={{ gridColumn: 'span 4', gridRow: 'span 2' }} className="bg-white rounded-[2rem] p-12 text-center border border-dashed border-gray-300 flex flex-col items-center justify-center">
                                <p className="text-base font-bold text-gray-900 mb-1">Your Dashboard is Empty</p>
                                <p className="text-xs text-gray-400 mb-5">Add widgets from the catalog to build your custom workspace.</p>
                                <button onClick={() => setModal(true)} className="bg-coral-500 hover:bg-coral-600 text-white text-xs font-bold px-6 py-3 rounded-full shadow-sm transition-colors">+ Add Widgets</button>
                            </div>
                        ) : active.map(({ id, size, def }) => {
                            const { cols, rows } = parseSize(size);
                            const allowed = def.allowedSizes || DEFAULT_SIZES;
                            return (
                                <div key={id} data-widget-id={id} data-widget-size={size} style={{ '--w-cols': cols, '--w-rows': rows } as React.CSSProperties}
                                    className={`widget-cell relative transition-all duration-300 select-none ${edit ? 'customize-active ring-2 ring-coral-500/80 rounded-[2rem] shadow-lg' : ''}`}
                                    draggable={edit || undefined}
                                    onDragStart={edit ? (e) => { dragged.current = id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('opacity-50', 'scale-95'); } : undefined}
                                    onDragOver={edit ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                                    onDrop={edit ? (e) => { e.preventDefault(); drop(id); } : undefined}
                                    onDragEnd={edit ? (e) => { e.currentTarget.classList.remove('opacity-50', 'scale-95'); dragged.current = null; } : undefined}>
                                    {edit && <>
                                        <div className="absolute -top-3 left-3 right-3 z-30 flex items-center justify-between bg-[#111827] text-white px-3 py-1.5 rounded-full shadow-xl border border-gray-700">
                                            <div className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing">
                                                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16"></path></svg>
                                                <span className="text-[10px] font-extrabold text-coral-400 uppercase tracking-wider">{size.replace('x', '×')}</span>
                                            </div>
                                            <div className="flex items-center gap-1 overflow-x-auto max-w-[180px] no-scrollbar">
                                                {allowed.map(s => (
                                                    <button key={s} type="button" onClick={() => changeSize(id, s)} className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold transition-colors ${s === size ? 'bg-coral-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>{s.replace('x', '×')}</button>
                                                ))}
                                            </div>
                                            <button type="button" onClick={() => removeWidget(id)} title="Remove Widget" className="w-5 h-5 rounded-full bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white flex items-center justify-center transition-colors ml-1 flex-shrink-0">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                                            </button>
                                        </div>
                                        <div onMouseDown={(e) => startResize(e, id)} title="Drag corner to resize (2×2, 2×3...)" className="absolute bottom-2 right-2 z-30 w-7 h-7 rounded-full bg-[#111827] text-white flex items-center justify-center cursor-nwse-resize shadow-md hover:bg-coral-500 transition-colors">
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 14h6m0 0v6m0-6L3 21M20 10h-6m0 0V4m0 6l7-7"></path></svg>
                                        </div>
                                    </>}
                                    <div className={`w-full h-full overflow-hidden rounded-[2rem] ${edit ? 'pointer-events-none opacity-95' : ''}`}>
                                        {dash ? def.render(dash, size, { query, setQuery }) : <Loading />}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>
        </AppFrame>
    );
}
