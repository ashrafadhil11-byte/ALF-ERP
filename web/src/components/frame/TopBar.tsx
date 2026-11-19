// Top bar — same as admin/components/topbar.js: greeting + name, check-in buttons, collapsible search (Ctrl+K / Esc),
// notifications, quick "new booking" and the profile pill.
import { useEffect, useRef, useState } from 'react';
import { jwtPayload } from '../../lib/session';
import { PageLink } from '../PageLink';
import { CheckInButtons, type useCheckin } from './CheckIn';
import { Notifications } from './Notifications';

const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning,';
    if (hour < 17) return 'Good Afternoon,';
    return 'Good Evening,';
};

/** Name and role label shown in the top bar (same fallbacks as the old pages). */
export function whoAmI() {
    let fullName = localStorage.getItem('cargo_user_name') || 'Muhammed Adhil';
    let roleLabel = 'Super Admin';
    const p = jwtPayload();
    if (p) {
        if (p.user_metadata?.full_name) {
            fullName = p.user_metadata.full_name;
            try { localStorage.setItem('cargo_user_name', fullName); } catch { /* ignore */ }
        }
        const storedRole = localStorage.getItem('cargo_user_role');
        if (storedRole) roleLabel = storedRole.replace('_', ' ').toUpperCase();
    }
    return { fullName, roleLabel };
}

type Props = {
    ck: ReturnType<typeof useCheckin>;
    onMenu: () => void;
    onProfile: () => void;
    /** the page's own search (the old pages' window.searchLatestBookings) */
    onSearch?: (q: string) => void;
};

export function TopBar({ ck, onMenu, onProfile, onSearch }: Props) {
    const [{ fullName, roleLabel }] = useState(whoAmI);
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const wrap = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const searchRef = useRef(onSearch);
    searchRef.current = onSearch;

    const expand = () => { setOpen(true); setTimeout(() => input.current?.focus(), 120); };
    const collapse = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setQ('');
        searchRef.current?.('');
        input.current?.blur();
        setOpen(false);
    };
    const collapseRef = useRef(collapse);
    collapseRef.current = collapse;

    useEffect(() => {
        const click = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node) && !input.current?.value.trim()) collapseRef.current(); };
        const key = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); expand(); }
            else if (e.key === 'Escape') collapseRef.current();
        };
        document.addEventListener('click', click);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
    }, []);

    const encodedName = encodeURIComponent(fullName);
    return (
        <div id="topbar-container">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between w-full mb-6 px-1 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <button type="button" onClick={onMenu} aria-label="Open menu"
                        className="lg:hidden w-11 h-11 rounded-full bg-[#F8F8FA] border border-gray-200/70 flex items-center justify-center text-gray-700 flex-shrink-0">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
                    </button>
                    <div className="text-left min-w-0">
                        <p className="text-sm lg:text-base font-semibold text-gray-400 tracking-tight leading-snug" id="topbarGreeting">{greeting()}</p>
                        <h1 className="text-xl sm:text-2xl lg:text-[32px] font-extrabold text-gray-900 tracking-tight leading-tight mt-0.5 truncate" id="topbarUserFullName">{fullName}</h1>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 sm:gap-3 lg:gap-3.5 self-end sm:self-center min-w-0">
                    <CheckInButtons ck={ck} />

                    <div id="collapsibleSearchWrapper" ref={wrap}
                        className={`relative hidden sm:flex items-center border border-gray-200/70 rounded-full h-11 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-sm ${open ? 'w-64 sm:w-80 bg-white border-gray-300 ring-4 ring-coral-500/10' : 'w-11 bg-[#F8F8FA]'}`}>
                        <button type="button" onClick={expand} title="Search ERP (Ctrl+K)"
                            className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-gray-600 hover:text-gray-900 focus:outline-none">
                            <svg className={`w-4 h-4 transition-transform duration-300 ${open ? 'text-coral-500 scale-110' : ''}`} id="topSearchIcon" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                            </svg>
                        </button>
                        <input id="topSearchInput" ref={input} type="text" value={q}
                            onChange={(e) => { setQ(e.target.value); searchRef.current?.(e.target.value); }}
                            placeholder="Search AWB, Branch, Staff..."
                            className={`bg-transparent border-none focus:outline-none focus:ring-0 text-xs font-medium text-gray-800 w-full pr-16 transition-opacity duration-300 placeholder-gray-400 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
                        <button type="button" id="topSearchClearBtn" onClick={collapse}
                            className={`${open ? '' : 'hidden '}absolute right-2.5 px-2 py-0.5 rounded-full bg-gray-200/70 hover:bg-gray-300 text-[9px] font-extrabold text-gray-600 uppercase tracking-wider transition-colors`}>
                            ESC
                        </button>
                    </div>

                    <div id="notifSlot"><Notifications /></div>

                    <PageLink page="booking.html" title="New booking" aria-label="New booking"
                        className="hidden sm:flex w-11 h-11 bg-[#F8F8FA] rounded-full border border-gray-200/70 flex items-center justify-center text-gray-700 hover:bg-[#111827] hover:text-white hover:border-[#111827] transition-all shadow-sm flex-shrink-0">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path></svg>
                    </PageLink>

                    <button type="button" onClick={onProfile}
                        className="group flex items-center gap-3 bg-white hover:bg-[#F8F8FA] p-1.5 pr-4 rounded-full border border-gray-200/80 shadow-sm hover:shadow transition-all cursor-pointer text-left">
                        <div className="relative">
                            <img id="topbarProfileAvatar" src={`https://ui-avatars.com/api/?name=${encodedName}&background=E86D58&color=fff&bold=true`} alt="Profile" className="w-8 h-8 rounded-full object-cover" />
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></span>
                        </div>
                        <div className="hidden md:block">
                            <p id="topbarProfileName" className="text-xs font-extrabold text-gray-900 leading-none group-hover:text-coral-500 transition-colors">{fullName}</p>
                            <p id="topbarProfileRole" className="text-[10px] font-semibold text-gray-400 mt-1 leading-none">{roleLabel}</p>
                        </div>
                        <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-700 transition-transform group-hover:translate-x-0.5 hidden md:block" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                </div>
            </header>
        </div>
    );
}
