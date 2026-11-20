// Floating chat: a round button at the bottom right of every page; it opens the chat as a popup.
// The badge counts unread messages (checked every 15 s, also while the tab is in the background).
// A new message while you are not reading it → a chime, a short preview above the button, and — when the tab is
// in the background — a system notification (if allowed). Click either to open that chat.
// On the Messages page the button is hidden, but the alerts still work when that tab is in the background.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { askNotify, chime, notifyState, setSound, soundOn, systemNotify } from '../../lib/alerts';
import { Icon } from '../Icon';

const ChatPanel = lazy(() => import('../../pages/Messages').then(m => ({ default: m.ChatPanel })));
type Thread = { id: number; kind: string; title?: string | null; last_message?: string | null; last_sender?: string | null; unread: number; members: { name: string }[] };

export function ChatWidget() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [key, setKey] = useState(0);                 // re-mounts the panel to jump straight into a chat
    const [peek, setPeek] = useState<{ id: number; who: string; text: string } | null>(null);
    const [sound, setSoundState] = useState(soundOn);
    const [perm, setPerm] = useState(notifyState);
    const q = useQuery({ queryKey: ['chat-unread'], queryFn: () => api<{ unread: number }>('/api/chat?view=unread'), refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0, retry: false });
    const unread = q.data?.unread || 0;
    const last = useRef<number | null>(null);
    const onPage = pathname.endsWith('/messages');
    const reading = () => (open || onPage) && !document.hidden && document.hasFocus();

    // tab title: unread count while you are not reading
    useEffect(() => {
        const base = document.title.replace(/^\(\d+\+?\) /, '');
        document.title = unread && !open && !onPage ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
    }, [unread, open, onPage]);

    // a new message you are not looking at → chime + preview (+ system notification when the tab is in the background)
    useEffect(() => {
        if (!q.data) return;                               // not loaded yet: the first count is never "new"
        const before = last.current; last.current = unread;
        if (before === null || unread <= before || reading()) return;
        api<{ threads: Thread[] }>('/api/chat').then(d => {
            const t = d.threads.find(x => x.unread > 0);
            if (!t) return;
            const name = t.kind === 'assistant' ? 'AI Assistant' : t.kind === 'group' ? t.title || 'Group' : t.members[0]?.name || t.last_sender || 'New message';
            const who = t.kind === 'group' ? `${(t.last_sender || '').split(' ')[0]} · ${name}` : name;
            const text = t.last_message || '';
            chime();
            if (!onPage && !open) setPeek({ id: t.id, who, text });
            if (document.hidden || !document.hasFocus()) systemNotify(t.kind === 'group' ? `${name}` : name, t.kind === 'group' ? `${(t.last_sender || '').split(' ')[0]}: ${text}` : text, `/app/messages?t=${t.id}`, `chat-${t.id}`);
        }).catch(() => {});
    }, [unread, q.data]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!peek) return; const t = setTimeout(() => setPeek(null), 7000); return () => clearTimeout(t); }, [peek]);

    useEffect(() => {
        if (!open) return;
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.ui-modal.open')) setOpen(false); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [open]);

    const openChat = (id?: number) => {
        if (id) { try { sessionStorage.setItem('alf_chat_open', String(id)); } catch { /* ignore */ } setKey(k => k + 1); }
        setPeek(null); setOpen(true);
    };
    const close = () => { setOpen(false); qc.invalidateQueries({ queryKey: ['chat-unread'] }); };
    if (onPage) return null;

    const tools = <>
        <button type="button" className="icon-btn" title={sound ? 'Sound on — click to mute' : 'Sound off — click to turn on'} aria-label={sound ? 'Mute message sound' : 'Turn on message sound'}
            onClick={() => { const v = !sound; setSound(v); setSoundState(v); if (v) chime(); }}><Icon name={sound ? 'volume' : 'volumeOff'} cls="w-4 h-4" /></button>
        <button type="button" className="icon-btn" title="Open full screen" aria-label="Open Messages full screen" onClick={() => {
            let t = ''; try { t = sessionStorage.getItem('alf_chat_open') || ''; } catch { /* ignore */ }
            setOpen(false); navigate(`/messages${t ? `?t=${t}` : ''}`);
        }}><Icon name="expand" cls="w-4 h-4" /></button>
        <button type="button" className="icon-btn" title="Close" aria-label="Close chat" onClick={close}><Icon name="x" cls="w-4 h-4" /></button>
    </>;

    return <>
        {peek && !open && <button type="button" id="chatPeek" onClick={() => openChat(peek.id)}
            className="chat-peek fixed z-[71] right-4 lg:right-6 bottom-[9.5rem] lg:bottom-[5.5rem] w-[min(320px,calc(100vw-2rem))] text-left bg-white rounded-[1.25rem] border border-gray-100 shadow-[0_20px_50px_-12px_rgba(17,24,39,.35)] p-3.5 flex gap-3 items-start">
            <span className="w-9 h-9 rounded-full bg-[#FFF5F3] text-[#E86D58] flex items-center justify-center flex-shrink-0"><Icon name="message" cls="w-4 h-4" /></span>
            <span className="min-w-0"><b className="block text-xs truncate">{peek.who}</b><span className="block text-xs text-gray-500 line-clamp-2">{peek.text}</span></span>
        </button>}

        <div id="chatPopup" role="dialog" aria-label="Messages" aria-hidden={!open}
            className={`chat-popup fixed z-[72] bg-white border border-gray-100 shadow-[0_30px_80px_-20px_rgba(17,24,39,.45)] overflow-hidden flex flex-col
                inset-x-2 top-2 bottom-[9.5rem] rounded-[1.75rem] sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24 sm:w-[400px] sm:h-[min(620px,calc(100dvh-8rem))]
                ${open ? 'open' : ''}`}>
            {open && perm === 'default' && <div id="alertAsk" className="flex items-center gap-2 bg-[#111827] text-white px-4 py-2.5 text-[11px]">
                <Icon name="bell" cls="w-4 h-4 text-[#E86D58] flex-shrink-0" /><span className="flex-1">Get a pop-up when a message comes in, even in another tab.</span>
                <button type="button" className="font-extrabold text-[#E86D58] hover:underline" onClick={async () => setPerm(await askNotify())}>Turn on</button>
                <button type="button" className="text-white/50 hover:text-white" aria-label="Not now" onClick={() => setPerm('denied')}><Icon name="x" cls="w-3.5 h-3.5" /></button></div>}
            {open && <Suspense fallback={<div className="flex-1 flex items-center justify-center text-xs text-gray-400">Loading…</div>}>
                <ChatPanel key={key} popup tools={tools} />
            </Suspense>}
        </div>

        <button type="button" id="chatFab" onClick={() => (open ? close() : openChat())} aria-expanded={open}
            aria-label={open ? 'Close chat' : unread ? `Messages, ${unread} unread` : 'Messages'} title="Messages"
            className={`chat-fab fixed z-[73] right-4 bottom-24 lg:right-6 lg:bottom-6 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-[0_14px_34px_-8px_rgba(232,109,88,.65)] transition-all duration-200 hover:scale-105 active:scale-95
                ${open ? 'bg-[#111827]' : 'bg-[#E86D58]'}`}>
            <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}><Icon name={open ? 'x' : 'message'} cls="w-6 h-6" /></span>
            {!open && unread > 0 && <span id="chatBadge" className="notif-pop absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#111827] text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white">
                {unread > 99 ? '99+' : unread}</span>}
        </button>
    </>;
}
