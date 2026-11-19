// Desktop sidebar (and the phone slide-in menu) — same groups, rules and look as admin/components/sidebar.js.
// Groups fold open / closed (remembered); the group of the current page always opens. Sign out stays pinned at the bottom.
import { useEffect, useRef, useState } from 'react';
import { NAV_ICONS, type NavIconName } from '../../lib/icons';
import { session } from '../../lib/session';
import type { PageFile } from '../../lib/pages';
import { PageLink } from '../PageLink';
import { Svg } from '../Icon';

type Item = [label: string, page: PageFile, icon: NavIconName, show: boolean];
type Group = { id: string; label?: string; items: Item[] };

function groups(): Group[] {
    const role = session.role();
    const isAdmin = role === 'super_admin' || role === 'head_office';
    const isWarehouse = session.isWarehouse();
    return ([
        { id: 'top', items: [[isAdmin ? 'Global Overview' : 'Dashboard', 'super-dashboard.html', 'home', true]] },
        { id: 'ops', label: 'Operations', items: [
            ['Shipments & AWB', 'shipments.html', 'ship', true],
            ['New Booking', 'booking.html', 'plus', true],
            ['Scan & Update', 'status-update.html', 'scan', true],
            ['Delivery & POD', 'delivery.html', 'truck', true],
            ['Consolidation & Bulk', 'consolidation.html', 'layers', true]
        ] },
        { id: 'crm', label: 'CRM', items: [
            ['Customers', 'customers.html', 'users', true],
            ['WhatsApp', 'crm.html', 'chat', true]
        ] },
        { id: 'biz', label: 'Money & stock', items: [
            ['Accounts', 'accounts.html', 'cash', role !== 'staff'],
            ['Warehouse', 'warehouse.html', 'warehouse', isWarehouse || isAdmin]
        ] },
        { id: 'team', label: 'Team', items: [
            ['Attendance', 'attendance.html', 'clock', true],
            ['Staff & Users', 'create-user.html', 'staff', isAdmin]
        ] },
        { id: 'admin', label: 'Settings', items: [
            ['Branch Network', 'branches.html', 'building', isAdmin],
            ['Integrations', 'integrations.html', 'link', isAdmin],
            ['Activity Log', 'activity.html', 'pulse', isAdmin]
        ] }
    ] as Group[]).map(g => ({ ...g, items: g.items.filter(i => i[3]) })).filter(g => g.items.length);
}

const navSvg = (icon: NavIconName, extra = '') => <Svg d={NAV_ICONS[icon]} cls={`w-[18px] h-[18px] flex-shrink-0 ${extra}`} />;

function readFolded(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem('alf_nav_folded') || '{}'); } catch { return {}; }
}

export function Sidebar({ current }: { current: PageFile | undefined }) {
    // remembered folds; the group of the current page starts open, and any group can then be folded or opened
    const folded = useRef(readFolded());
    const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(groups().map(g => [g.id, g.items.some(i => i[1] === current) || !folded.current[g.id]])));
    const nav = useRef<HTMLElement>(null);
    const prefetched = useRef(new Set<string>());

    // keep the current page's link in view when the menu is long
    useEffect(() => { nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }); }, []);

    const toggle = (id: string) => {
        const open = !openMap[id];
        setOpenMap(m => ({ ...m, [id]: open }));
        folded.current = { ...folded.current, [id]: !open };
        try { localStorage.setItem('alf_nav_folded', JSON.stringify(folded.current)); } catch { /* ignore */ }
    };

    // faster page changes: start loading an old page as soon as the pointer rests on its link
    const prefetch = (e: React.PointerEvent) => {
        const a = (e.target as Element).closest<HTMLAnchorElement>('a.nav-item');
        if (!a || prefetched.current.has(a.href) || a.getAttribute('aria-current') || !a.href.endsWith('.html')) return;
        prefetched.current.add(a.href);
        const l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href; document.head.appendChild(l);
    };

    const item = ([label, page, icon]: Item) => {
        const on = current === page;
        return (
            <PageLink key={page} page={page} aria-current={on ? 'page' : undefined}
                className={`nav-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors ${on ? 'bg-[#111827] text-white font-semibold shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50 font-medium'}`}>
                {navSvg(icon, on ? 'text-[#E86D58]' : '')}<span className="truncate">{label}</span>
            </PageLink>
        );
    };

    return (
        <aside className="h-[calc(100dvh-2.5rem)] w-60 bg-white rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.05)] flex flex-col p-4 sticky top-5 border border-gray-100/80">
            <PageLink page="super-dashboard.html" className="flex justify-center items-center py-3 mb-2 flex-shrink-0" aria-label="Home">
                <img src="/assets/LOGO%20BG%20W.svg" alt="Al-Farha Cargo" className="h-9 w-auto object-contain" />
            </PageLink>
            <nav ref={nav} onPointerOver={prefetch} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-1" aria-label="Main menu">
                {groups().map(g => {
                    if (!g.label) return <div key={g.id} className="space-y-0.5">{g.items.map(item)}</div>;
                    const open = openMap[g.id] ?? true;
                    return (
                        <div key={g.id} className="nav-group" data-group={g.id}>
                            <button type="button" onClick={() => toggle(g.id)} aria-expanded={open}
                                className="nav-head w-full flex items-center justify-between px-3.5 pt-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                                <span>{g.label}</span>{navSvg('chev', `nav-chev transition-transform ${open ? '' : '-rotate-90'}`)}
                            </button>
                            <div className={`nav-items space-y-0.5 ${open ? '' : 'hidden'}`}>{g.items.map(item)}</div>
                        </div>
                    );
                })}
            </nav>
            <div className="pt-3 mt-2 border-t border-gray-100 flex-shrink-0">
                <button onClick={() => session.signOut()} className="w-full flex items-center justify-center gap-2 bg-[#FFF5F3] text-[#E86D58] font-semibold text-sm py-2.5 rounded-xl hover:bg-[#FFEAE5] transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                    Sign Out
                </button>
            </div>
        </aside>
    );
}
