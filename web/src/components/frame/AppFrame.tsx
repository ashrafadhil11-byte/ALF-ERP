// The page frame every signed-in page shares: sidebar, main panel with the top bar, phone bottom bar, profile drawer
// and the check-in reminder. The elements and their order match the old pages exactly, because the shared ui.css
// lays them out as children of <body> (the React root uses display:contents).
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { pageByPath, type PageFile } from '../../lib/pages';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { ProfileDrawer } from './ProfileDrawer';
import { CheckInReminder, useCheckin } from './CheckIn';

export const MAIN_CLASS = 'flex-1 min-w-0 bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-5 lg:p-8 flex flex-col relative z-10 overflow-hidden border border-white';
const MOBILE_OPEN = 'fixed inset-0 z-[60] p-3 bg-gray-900/40 backdrop-blur-sm';

type Props = {
    children: ReactNode;
    /** the page's <main> classes when they differ from the usual ones */
    mainClassName?: string;
    /** the page's search, fed by the top-bar search box */
    onSearch?: (q: string) => void;
    /** popups and other elements the old page placed after <main> */
    after?: ReactNode;
    /** override which page is "current" (normally taken from the URL) */
    page?: PageFile;
};

export function AppFrame({ children, mainClassName = MAIN_CLASS, onSearch, after, page }: Props) {
    const { pathname } = useLocation();
    const current = page ?? pageByPath(pathname)?.file;
    const [menuOpen, setMenuOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const ck = useCheckin();

    // phones: keep content clear of the bottom bar (the old sidebar.js added this class to <body>)
    useEffect(() => {
        document.body.classList.add('max-lg:pb-24');
        return () => document.body.classList.remove('max-lg:pb-24');
    }, []);
    // phones: the sidebar slides in as an overlay; the page behind does not scroll
    useEffect(() => {
        document.body.style.overflow = menuOpen ? 'hidden' : '';
        if (!menuOpen) return;
        const resize = () => { if (window.innerWidth >= 1024) setMenuOpen(false); };
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [menuOpen]);
    // a page change closes the phone menu
    useEffect(() => { setMenuOpen(false); }, [pathname]);

    return (
        <>
            <div id="sidebar-container" className={`${menuOpen ? MOBILE_OPEN : 'hidden'} lg:block z-20`}
                onClick={(e) => { if (e.target === e.currentTarget && window.innerWidth < 1024) setMenuOpen(false); }}>
                <Sidebar current={current} />
            </div>
            <main className={mainClassName}>
                <TopBar ck={ck} onMenu={() => setMenuOpen(v => !v)} onProfile={() => setProfileOpen(true)} onSearch={onSearch} />
                {children}
            </main>
            {after}
            <BottomNav current={current} onMenu={() => setMenuOpen(true)} />
            <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
            <CheckInReminder ck={ck} onAttendancePage={current === 'attendance.html'} />
        </>
    );
}
