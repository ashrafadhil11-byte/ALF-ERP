// Phones / tablets: app-style bottom navigation (hidden on desktop, where the sidebar shows). Same as sidebar.js.
import type { PageFile } from '../../lib/pages';
import { PageLink } from '../PageLink';
import { Svg } from '../Icon';

type It = { page?: PageFile; label: string; d: string; primary?: boolean; menu?: boolean };
const ITEMS: It[] = [
    { page: 'super-dashboard.html', label: 'Home', d: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
    { page: 'shipments.html', label: 'Shipments', d: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>' },
    { page: 'status-update.html', label: 'Scan', d: '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10"/>', primary: true },
    { page: 'booking.html', label: 'Book', d: '<path d="M12 5v14M5 12h14"/>' },
    { label: 'Menu', d: '<path d="M3 6h18M3 12h18M3 18h18"/>', menu: true }
];

const ic = (d: string) => <Svg d={d} cls="w-[22px] h-[22px]" />;

export function BottomNav({ current, onMenu }: { current: PageFile | undefined; onMenu: () => void }) {
    return (
        <nav id="bottom-nav" aria-label="Main" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-gray-100 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.12)]">
            <div className="grid grid-cols-5 max-w-lg mx-auto h-16 items-center">
                {ITEMS.map(it => {
                    const active = !!it.page && it.page === current;
                    if (it.primary) {
                        return (
                            <PageLink key={it.label} page={it.page!} className="flex flex-col items-center justify-center gap-0.5 -mt-6" aria-label={it.label}>
                                <span className={`w-14 h-14 rounded-full ${active ? 'bg-coral-500' : 'bg-[#111827]'} text-white flex items-center justify-center shadow-lg ring-4 ring-white`}>{ic(it.d)}</span>
                                <span className={`text-[10px] font-extrabold ${active ? 'text-coral-500' : 'text-gray-500'}`}>{it.label}</span>
                            </PageLink>
                        );
                    }
                    const cls = `flex flex-col items-center justify-center gap-1 h-full text-[10px] font-extrabold ${active ? 'text-coral-500' : 'text-gray-500'}`;
                    return it.menu
                        ? <button key={it.label} type="button" onClick={onMenu} className={cls}>{ic(it.d)}{it.label}</button>
                        : <PageLink key={it.label} page={it.page!} className={cls} aria-current={active ? 'page' : undefined}>{ic(it.d)}{it.label}</PageLink>;
                })}
            </div>
        </nav>
    );
}
