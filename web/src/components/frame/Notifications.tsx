// Bell + panel in the top bar — same as admin/components/notifications.js.
// Data: GET /api/notifications every 60 s while the tab is visible. Opening the panel marks all as read.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { hrefFor, pageByFile, type PageFile } from '../../lib/pages';
import { toast } from '../../lib/toast';
import type { IconName } from '../../lib/icons';
import { Icon } from '../Icon';

type Note = { kind: string; title: string; body?: string; href: string; at: string; unread?: boolean };
type Resp = { items?: Note[]; unread?: number };
/** "consolidation.html?tab=inbound" (relative to the old /admin/ pages) → where that page lives now */
const noteHref = (href: string) => {
    const m = /^([a-z-]+\.html)(.*)$/.exec(href || '');
    if (!m || !pageByFile(m[1])) return href;
    const t = hrefFor(m[1] as PageFile);
    return ('to' in t ? '/app' + t.to : t.href) + m[2];
};

const KIND: Record<string, { icon: IconName; tone: string }> = {
    inbound: { icon: 'truck', tone: 'bg-[#111827] text-white' },
    exception: { icon: 'alert', tone: 'bg-[#FFF5F3] text-[#D55C48]' },
    review: { icon: 'star', tone: 'bg-amber-50 text-amber-500' },
    carrier: { icon: 'globe', tone: 'bg-gray-100 text-gray-600' },
    cash: { icon: 'wallet', tone: 'bg-emerald-50 text-emerald-600' },
    request: { icon: 'clock', tone: 'bg-[#FFF5F3] text-[#E86D58]' },
    done: { icon: 'check', tone: 'bg-emerald-50 text-emerald-600' },
    warn: { icon: 'alert', tone: 'bg-amber-50 text-amber-600' }
};

export const ago = (iso: string) => {
    const s = Math.max(1, (Date.now() - +new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
};

export function Notifications() {
    const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Resp>('/api/notifications'), refetchInterval: 60_000, staleTime: 0 });
    const [open, setOpen] = useState(false);
    const [seen, setSeen] = useState(false);          // panel opened since the last load: badge cleared
    const [readAll, setReadAll] = useState(false);    // panel closed after opening: dots cleared
    const btn = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);

    // a fresh load brings the server's own unread state back
    useEffect(() => { setSeen(false); setReadAll(false); }, [q.dataUpdatedAt]);

    const items = (q.data?.items || []).map(n => (readAll ? { ...n, unread: false } : n));
    const unread = seen ? 0 : q.data?.unread || 0;                  // badge: cleared as soon as the panel opens
    const subUnread = readAll ? 0 : q.data?.unread || 0;             // heading + dots: cleared once the panel closes

    const toggle = (v: boolean) => {
        setOpen(v);
        if (v && unread) {
            setSeen(true);
            api('/api/notifications', { method: 'POST', body: { action: 'seen' } }).catch(() => {});
        }
        if (!v) setTimeout(() => setReadAll(true), 250);
    };

    useEffect(() => {
        const outside = (e: MouseEvent) => { if (open && !panel.current?.contains(e.target as Node)) toggle(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { toggle(false); btn.current?.focus(); } };
        document.addEventListener('click', outside);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); };
    });

    const refresh = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const r = await q.refetch();
        if (r.error) toast(false, (r.error as Error).message);
    };

    return (
        <div className="relative">
            <button type="button" ref={btn} id="notifBtn" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); toggle(!open); }}
                className="relative w-11 h-11 bg-[#F8F8FA] rounded-full border border-gray-200/70 flex items-center justify-center text-gray-700 hover:bg-[#111827] hover:text-white hover:border-[#111827] transition-all shadow-sm">
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>
                <span id="notifBadge" className={`${unread ? 'notif-pop' : 'hidden'} absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-[#E86D58] text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white`}>
                    {unread > 9 ? '9+' : unread}
                </span>
            </button>
            <div id="notifPanel" ref={panel} role="dialog" aria-label="Notifications"
                className={`notif-panel fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-24 sm:top-14 sm:w-[380px] z-[60] bg-white rounded-[1.75rem] border border-gray-100 shadow-[0_24px_60px_-12px_rgba(17,24,39,.25)] overflow-hidden${open ? ' open' : ''}`}>
                <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
                    <div><p className="text-sm font-extrabold">Notifications</p><p id="notifSub" className="text-[10px] text-gray-400 font-bold">{subUnread ? `${subUnread} new · last 7 days` : 'Last 7 days'}</p></div>
                    <button type="button" className="icon-btn" title="Refresh" onClick={refresh}><Icon name="refresh" cls="w-3.5 h-3.5" /></button>
                </div>
                <div id="notifList" className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
                    {!q.data && !q.isError ? <p className="p-8 text-center text-xs text-gray-400">Loading…</p>
                        : items.length ? items.map((n, i) => {
                            const k = KIND[n.kind] || KIND.carrier;
                            return (
                                <a key={i} href={noteHref(n.href)} className={`flex gap-3 p-3 rounded-2xl hover:bg-[#F8F8FA] transition-colors ${n.unread ? 'bg-[#FFF5F3]/60' : ''}`}>
                                    <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${k.tone}`}><Icon name={k.icon} cls="w-4 h-4" /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-start justify-between gap-2"><span className="text-xs font-extrabold leading-snug">{n.title}</span>
                                            {n.unread && <span className="w-2 h-2 rounded-full bg-[#E86D58] mt-1 flex-shrink-0"></span>}</span>
                                        {n.body && <span className="block text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</span>}
                                        <span className="block text-[10px] font-bold text-gray-400 mt-1">{ago(n.at)}</span>
                                    </span>
                                </a>
                            );
                        })
                        : <div className="p-10 text-center"><span className="inline-flex w-12 h-12 rounded-full bg-[#F8F8FA] items-center justify-center text-gray-400 mb-2"><Icon name="checkCircle" cls="w-5 h-5" /></span><p className="text-xs font-bold text-gray-500">You're all caught up</p></div>}
                </div>
            </div>
        </div>
    );
}
