// Messages — chat between users: one-to-one and groups. Data: /api/chat.
// Left: my chats (unread first in mind, newest on top). Right: the open chat — bubbles grouped by sender, day lines,
// replies, "Seen", delete own message. New messages arrive by polling (every few seconds while the page is visible).
// ?t=<chat id> keeps the open chat in the address; ?to=<user id> opens the one-to-one chat with that user.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { jwtPayload } from '../lib/session';
import { toast } from '../lib/toast';
import './messages.css';

type Person = { id: string; name: string; role?: string; branch?: string; branch_name?: string };
type Thread = { id: number; kind: 'direct' | 'group'; title?: string | null; last_message_at: string; last_message?: string | null; last_sender?: string | null; unread: number; members: Person[] };
type Msg = { id: number; sender_id: string | null; sender_name: string | null; body: string; reply_to?: number | null; system?: boolean; created_at: string; deleted_at?: string | null; pending?: boolean; failed?: boolean };
type Member = Person & { last_read_at: string };
type Open = { thread: { id: number; kind: 'direct' | 'group'; title?: string | null }; members: Member[]; messages: Msg[]; more: boolean; quoted: { id: number; sender_name: string; body: string; deleted: boolean }[] };

const ME = () => String(jwtPayload()?.sub || '');
const ROLE: Record<string, string> = { super_admin: 'Super admin', head_office: 'Head office', branch_manager: 'Branch manager', staff: 'Staff' };
const TONES = ['bg-[#E86D58]', 'bg-[#111827]', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-600'];
const tone = (s: string) => TONES[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const EMOJI = ['👍', '🙏', '✅', '👌', '😊', '😂', '🔥', '🎉', '❤️', '👏', '🙌', '🤝', '📦', '🚚', '✈️', '🚢', '📄', '💰', '⏰', '⚠️', '❗', '❓', '👀', '💯'];

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
    const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const listTime = (iso: string) => {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return clock(iso);
    if (Date.now() - +d < 6 * 864e5) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const threadName = (t: { kind: string; title?: string | null; members: Person[] }) => t.kind === 'group' ? (t.title || 'Group') : (t.members[0]?.name || 'Just you');

export function Avatar({ name, group = false, size = 'w-11 h-11', text = 'text-xs' }: { name: string; group?: boolean; size?: string; text?: string }) {
    return <span className={`${size} ${text} ${group ? 'bg-[#FFF5F3] text-[#E86D58]' : `${tone(name)} text-white`} rounded-full flex items-center justify-center font-extrabold flex-shrink-0 select-none`}>
        {group ? <Icon name="users" cls="w-1/2 h-1/2" /> : initials(name)}</span>;
}

// links: web addresses, and shipment numbers (9 digits, or AFC-123456) open the shipment
function Rich({ text }: { text: string }) {
    const parts = text.split(/(https?:\/\/[^\s]+|\b\d{9}\b|\bAFC-\d{6}\b)/g);
    return <>{parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 break-all">{p}</a>
        : /^(\d{9}|AFC-\d{6})$/.test(p) ? <a key={i} href={`/app/shipments?awb=${encodeURIComponent(p)}`} className="font-mono font-bold underline underline-offset-2">{p}</a>
            : <span key={i}>{p}</span>)}</>;
}

export function Messages() {
    const qc = useQueryClient();
    const me = ME();
    const params = new URLSearchParams(location.search);
    const [active, setActive] = useState<number | null>(() => Number(params.get('t')) || null);
    const [filter, setFilter] = useState('');
    const inbox = useQuery({ queryKey: ['chat-inbox'], queryFn: () => api<{ threads: Thread[]; unread: number }>('/api/chat'), refetchInterval: 8_000, staleTime: 0 });
    const threads = inbox.data?.threads || [];

    // ---------- open chat ----------
    const [open, setOpen] = useState<Open | null>(null);
    const [loading, setLoading] = useState(false);
    const openRef = useRef<Open | null>(null); openRef.current = open;
    const scroller = useRef<HTMLDivElement>(null);
    const stick = useRef(true);           // keep the view at the bottom unless the user scrolled up
    const [newBelow, setNewBelow] = useState(0);

    const pick = (id: number | null) => {
        setActive(id); setReply(null); setDraft(''); setNewBelow(0);
        history.replaceState(null, '', id ? `?t=${id}` : location.pathname);
    };
    const markRead = (id: number) => api('/api/chat', { method: 'POST', body: { action: 'read', thread: id } })
        .then(() => { qc.invalidateQueries({ queryKey: ['chat-unread'] }); qc.invalidateQueries({ queryKey: ['chat-inbox'] }); }).catch(() => {});

    useEffect(() => {
        if (!active) { setOpen(null); return; }
        let stop = false;
        setLoading(true); stick.current = true;
        api<Open>(`/api/chat?thread=${active}`).then(d => { if (!stop) { setOpen(d); markRead(active); } })
            .catch(e => { if (!stop) { toast(false, (e as Error).message); pick(null); } })
            .finally(() => { if (!stop) setLoading(false); });
        return () => { stop = true; };
    }, [active]);   // eslint-disable-line react-hooks/exhaustive-deps

    // new messages: poll after the last one (paused while the tab is hidden)
    useEffect(() => {
        if (!active) return;
        const tick = async () => {
            const cur = openRef.current;
            if (!cur || cur.thread.id !== active || document.hidden) return;
            const last = [...cur.messages].reverse().find(m => !m.pending)?.id || 0;
            try {
                const d = await api<Open>(`/api/chat?thread=${active}&after=${last}`);
                setOpen(o => {
                    if (!o || o.thread.id !== active) return o;
                    const have = new Set(o.messages.map(m => m.id));
                    const fresh = d.messages.filter(m => !have.has(m.id));
                    if (fresh.some(m => m.sender_id !== me)) { markRead(active); if (!stick.current) setNewBelow(n => n + fresh.length); }
                    return { ...o, members: d.members, thread: d.thread, quoted: [...o.quoted, ...d.quoted], messages: fresh.length ? [...o.messages.filter(m => !m.pending), ...fresh, ...o.messages.filter(m => m.pending)] : o.messages };
                });
            } catch { /* try again next tick */ }
        };
        const t = setInterval(tick, 3_500);
        const vis = () => { if (!document.hidden) tick(); };
        document.addEventListener('visibilitychange', vis);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
    }, [active, me]);   // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        const el = scroller.current;
        if (el && stick.current) el.scrollTop = el.scrollHeight;
    }, [open?.messages.length, open?.thread.id]);
    const onScroll = () => {
        const el = scroller.current; if (!el) return;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (stick.current) setNewBelow(0);
    };
    const toBottom = () => { const el = scroller.current; if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); stick.current = true; setNewBelow(0); } };
    async function older() {
        const cur = openRef.current; if (!cur || !cur.messages.length) return;
        const el = scroller.current, h = el?.scrollHeight || 0;
        try {
            const d = await api<Open>(`/api/chat?thread=${cur.thread.id}&before=${cur.messages[0].id}`);
            stick.current = false;
            setOpen(o => o ? { ...o, more: d.more, quoted: [...o.quoted, ...d.quoted], messages: [...d.messages, ...o.messages] } : o);
            requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - h; });
        } catch (e) { toast(false, (e as Error).message); }
    }

    // ---------- composer ----------
    const [draft, setDraft] = useState('');
    const [reply, setReply] = useState<Msg | null>(null);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const box = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; } }, [draft]);
    useEffect(() => { if (active) setTimeout(() => box.current?.focus(), 50); }, [active]);

    async function sendNow(text = draft) {
        const body = text.trim();
        if (!body || !open) return;
        const temp: Msg = { id: -Date.now(), sender_id: me, sender_name: 'You', body, reply_to: reply?.id || null, created_at: new Date().toISOString(), pending: true };
        const tid = open.thread.id;
        setOpen(o => o ? { ...o, messages: [...o.messages, temp] } : o);
        setDraft(''); setReply(null); setEmojiOpen(false); stick.current = true;
        try {
            const r = await api<{ message: Msg }>('/api/chat', { method: 'POST', body: { action: 'send', thread: tid, body, reply_to: temp.reply_to } });
            setOpen(o => o && o.thread.id === tid ? { ...o, messages: o.messages.some(m => m.id === r.message.id) ? o.messages.filter(m => m.id !== temp.id) : o.messages.map(m => m.id === temp.id ? r.message : m) } : o);
            qc.invalidateQueries({ queryKey: ['chat-inbox'] });
        } catch (e) {
            setOpen(o => o ? { ...o, messages: o.messages.map(m => m.id === temp.id ? { ...m, pending: false, failed: true } : m) } : o);
            toast(false, (e as Error).message);
        }
    }
    const retry = (m: Msg) => { setOpen(o => o ? { ...o, messages: o.messages.filter(x => x.id !== m.id) } : o); sendNow(m.body); };
    async function remove(m: Msg) {
        try {
            await api('/api/chat', { method: 'POST', body: { action: 'delete', id: m.id } });
            setOpen(o => o ? { ...o, messages: o.messages.map(x => x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: '' } : x) } : o);
        } catch (e) { toast(false, (e as Error).message); }
    }

    // ---------- new chat / group info ----------
    const [people, setPeople] = useState<Person[] | null>(null);
    const [newOpen, setNewOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const loadPeople = async () => {
        if (people) return people;
        try { const d = await api<{ people: Person[] }>('/api/chat?view=people'); setPeople(d.people); return d.people; } catch (e) { toast(false, (e as Error).message); return []; }
    };
    async function direct(userId: string) {
        try {
            const r = await api<{ thread: number }>('/api/chat', { method: 'POST', body: { action: 'direct', user_id: userId } });
            setNewOpen(false); pick(r.thread);
        } catch (e) { toast(false, (e as Error).message); }
    }
    useEffect(() => { const to = params.get('to'); if (to) direct(to); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const visible = threads.filter(t => !filter.trim() || threadName(t).toLowerCase().includes(filter.trim().toLowerCase()) || t.members.some(m => (m.branch || '').toLowerCase().includes(filter.trim().toLowerCase())));
    const current = threads.find(t => t.id === active);
    const others = (open?.members || []).filter(m => m.id !== me);
    const title = open ? (open.thread.kind === 'group' ? open.thread.title || 'Group' : others[0]?.name || current?.members[0]?.name || 'Chat') : '';
    const sub = open ? (open.thread.kind === 'group' ? `${open.members.length} members · ${open.members.map(m => m.id === me ? 'You' : m.name.split(' ')[0]).join(', ')}`
        : [ROLE[others[0]?.role || ''] || others[0]?.role, others[0]?.branch].filter(Boolean).join(' · ')) : '';

    // "Seen": on my latest message — a direct chat says Seen / Sent; a group says who has seen it
    const seenLine = useMemo(() => {
        if (!open) return null;
        const mine = [...open.messages].reverse().find(m => m.sender_id === me && !m.system && !m.deleted_at);
        if (!mine || mine.pending || mine.failed) return null;
        const seenBy = others.filter(o => new Date(o.last_read_at) >= new Date(mine.created_at));
        const text = open.thread.kind === 'direct' ? (seenBy.length ? `Seen ${clock(seenBy[0].last_read_at)}` : 'Sent')
            : seenBy.length === others.length && others.length ? 'Seen by everyone' : seenBy.length ? `Seen by ${seenBy.map(s => s.name.split(' ')[0]).join(', ')}` : 'Sent';
        return { id: mine.id, text, seen: seenBy.length > 0 };
    }, [open, me]);   // eslint-disable-line react-hooks/exhaustive-deps

    const quote = (id?: number | null) => {
        if (!id || !open) return null;
        const m = open.messages.find(x => x.id === id);
        if (m) return { name: m.sender_id === me ? 'You' : m.sender_name || '', body: m.deleted_at ? 'Message deleted' : m.body };
        const q = open.quoted.find(x => x.id === id);
        return q ? { name: q.sender_name, body: q.deleted ? 'Message deleted' : q.body } : null;
    };

    return (
        <AppFrame after={<>
            <NewChat open={newOpen} onClose={() => setNewOpen(false)} load={loadPeople} onDirect={direct} onGroup={(id) => { setNewOpen(false); pick(id); qc.invalidateQueries({ queryKey: ['chat-inbox'] }); }} />
            {open && <GroupInfo open={infoOpen} onClose={() => setInfoOpen(false)} data={open} me={me} load={loadPeople}
                onChanged={async (left) => { setInfoOpen(false); qc.invalidateQueries({ queryKey: ['chat-inbox'] }); if (left) pick(null); else if (active) setOpen(await api<Open>(`/api/chat?thread=${active}`)); }} />}
        </>}>
            <div id="chatApp" className="chat-app grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-0">
                {/* ---------- chat list ---------- */}
                <aside className={`${active ? 'hidden lg:flex' : 'flex'} flex-col min-h-0 bg-[#F8F8FA] rounded-[1.75rem] p-3`}>
                    <div className="flex items-center justify-between px-2 pt-1 pb-3">
                        <div><h2 className="text-lg font-extrabold">Messages</h2><p className="text-[11px] text-gray-400 font-bold">{inbox.data?.unread ? `${inbox.data.unread} unread` : 'Chat with your team'}</p></div>
                        <button type="button" id="newChat" className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center hover:bg-[#E86D58] transition-colors" aria-label="New chat" title="New chat" onClick={() => { loadPeople(); setNewOpen(true); }}><Icon name="edit" /></button>
                    </div>
                    <label className="flex items-center gap-2 bg-white rounded-full border border-gray-100 px-4 py-2.5 mb-3">
                        <Icon name="search" cls="w-4 h-4 text-gray-400" />
                        <input id="chatFilter" className="bg-transparent border-none outline-none text-xs font-medium w-full" placeholder="Search chats" value={filter} onChange={e => setFilter(e.target.value)} /></label>
                    <div id="chatList" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                        {inbox.isLoading ? [0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-white/70 animate-pulse" />)
                            : visible.length ? visible.map(t => {
                                const name = threadName(t), on = t.id === active;
                                return <button key={t.id} type="button" data-thread={t.id} onClick={() => pick(t.id)}
                                    className={`chat-row w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-colors ${on ? 'bg-white shadow-sm ring-1 ring-gray-100' : 'hover:bg-white/70'}`}>
                                    <span className="relative"><Avatar name={name} group={t.kind === 'group'} />{t.unread > 0 && !on && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#E86D58] ring-2 ring-[#F8F8FA]" />}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline justify-between gap-2"><b className={`text-[13px] truncate ${t.unread && !on ? 'text-gray-900' : 'text-gray-800'}`}>{name}</b><span className={`text-[10px] flex-shrink-0 ${t.unread && !on ? 'text-[#E86D58] font-extrabold' : 'text-gray-400 font-bold'}`}>{listTime(t.last_message_at)}</span></span>
                                        <span className="flex items-center justify-between gap-2 mt-0.5"><span className={`text-xs truncate ${t.unread && !on ? 'text-gray-800 font-bold' : 'text-gray-400'}`}>
                                            {t.last_message ? `${t.kind === 'group' && t.last_sender && !t.last_message.startsWith(t.last_sender) ? t.last_sender.split(' ')[0] + ': ' : ''}${t.last_message}` : 'No messages yet'}</span>
                                            {t.unread > 0 && !on && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#E86D58] text-white text-[10px] font-extrabold flex items-center justify-center">{t.unread > 99 ? '99+' : t.unread}</span>}</span>
                                    </span>
                                </button>;
                            }) : <div className="text-center px-6 py-14"><span className="mx-auto w-14 h-14 rounded-full bg-white flex items-center justify-center text-gray-300 mb-3"><Icon name="message" cls="w-6 h-6" /></span>
                                <p className="text-sm font-extrabold text-gray-700">{filter ? 'No chat found' : 'No chats yet'}</p><p className="text-xs text-gray-400 mt-1">{filter ? 'Try another name.' : 'Start one with anyone in the team.'}</p>
                                {!filter && <button type="button" className="btn btn-dark btn-sm mt-4" onClick={() => { loadPeople(); setNewOpen(true); }}><Icon name="plus" />New chat</button>}</div>}
                    </div>
                </aside>

                {/* ---------- open chat ---------- */}
                <section className={`${active ? 'flex' : 'hidden lg:flex'} flex-col min-h-0 rounded-[1.75rem] border border-gray-100 bg-white overflow-hidden relative`}>
                    {!active ? <div className="flex-1 flex flex-col items-center justify-center text-center p-10 chat-empty">
                        <span className="w-20 h-20 rounded-[1.75rem] bg-[#FFF5F3] text-[#E86D58] flex items-center justify-center mb-4"><Icon name="message" cls="w-9 h-9" /></span>
                        <h3 className="text-lg font-extrabold">Your messages</h3><p className="text-sm text-gray-400 mt-1 max-w-xs">Pick a chat on the left, or start a new one with a colleague or a group.</p>
                        <button type="button" className="btn btn-coral mt-5" onClick={() => { loadPeople(); setNewOpen(true); }}><Icon name="plus" />New chat</button>
                    </div> : <>
                        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                            <button type="button" className="lg:hidden w-9 h-9 rounded-full hover:bg-gray-50 flex items-center justify-center" aria-label="Back to chats" onClick={() => pick(null)}><Icon name="arrowLeft" /></button>
                            <Avatar name={title || '…'} group={open?.thread.kind === 'group'} size="w-10 h-10" />
                            <div className="min-w-0 flex-1"><h3 id="chatTitle" className="text-sm font-extrabold truncate">{title || ' '}</h3><p className="text-[11px] text-gray-400 truncate">{sub}</p></div>
                            {open?.thread.kind === 'group' && <button type="button" id="chatInfo" className="icon-btn" aria-label="Group details" title="Group details" onClick={() => { loadPeople(); setInfoOpen(true); }}><Icon name="users" /></button>}
                        </header>
                        <div ref={scroller} onScroll={onScroll} id="chatScroll" className="chat-scroll flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 sm:px-6 py-4">
                            {loading && !open ? <div className="space-y-3">{[60, 40, 70, 30].map((w, i) => <div key={i} className={`h-10 rounded-2xl bg-gray-100 animate-pulse ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />)}</div> : open && <>
                                {open.more && <div className="text-center mb-3"><button type="button" className="btn btn-light btn-sm" onClick={older}>Earlier messages</button></div>}
                                {!open.messages.length && <p className="text-center text-xs text-gray-400 py-10">{`Say hello to ${title} 👋`}</p>}
                                {open.messages.map((m, i) => {
                                    const prev = open.messages[i - 1], next = open.messages[i + 1];
                                    const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                                    const mine = m.sender_id === me;
                                    const sameAsPrev = prev && !prev.system && !newDay && prev.sender_id === m.sender_id && +new Date(m.created_at) - +new Date(prev.created_at) < 5 * 60e3;
                                    const sameAsNext = next && !next.system && dayKey(next.created_at) === dayKey(m.created_at) && next.sender_id === m.sender_id && +new Date(next.created_at) - +new Date(m.created_at) < 5 * 60e3;
                                    const q = quote(m.reply_to);
                                    return <div key={m.id}>
                                        {newDay && <div className="flex items-center gap-3 my-4"><span className="flex-1 h-px bg-gray-100" /><span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">{dayLabel(m.created_at)}</span><span className="flex-1 h-px bg-gray-100" /></div>}
                                        {m.system ? <p className="text-center my-3"><span className="inline-block text-[11px] text-gray-500 bg-[#F8F8FA] rounded-full px-3 py-1">{m.body}</span></p> :
                                            <div className={`chat-msg group flex items-end gap-2 ${mine ? 'justify-end' : ''} ${sameAsPrev ? 'mt-0.5' : 'mt-3'}`} data-msg={m.id}>
                                                {!mine && (open.thread.kind === 'group' ? (sameAsNext ? <span className="w-8 flex-shrink-0" /> : <Avatar name={m.sender_name || '?'} size="w-8 h-8" text="text-[10px]" />) : null)}
                                                <div className={`max-w-[78%] sm:max-w-[65%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                                                    {!mine && open.thread.kind === 'group' && !sameAsPrev && <span className="text-[10px] font-extrabold text-gray-500 mb-1 ml-3">{m.sender_name}</span>}
                                                    <div className={`flex items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
                                                        <div tabIndex={-1} className={`bubble outline-none ${mine ? 'bubble-me' : 'bubble-them'} ${sameAsNext ? (mine ? 'join-next-me' : 'join-next-them') : ''} ${sameAsPrev ? (mine ? 'join-prev-me' : 'join-prev-them') : ''} ${m.pending ? 'opacity-60' : ''} ${m.failed ? 'ring-2 ring-[#E86D58]' : ''}`}>
                                                            {q && <span className={`block text-[11px] rounded-xl px-2.5 py-1.5 mb-1.5 border-l-2 ${mine ? 'bg-white/10 border-white/50' : 'bg-white border-[#E86D58]'}`}><b className="block">{q.name}</b><span className="line-clamp-2 opacity-80">{q.body}</span></span>}
                                                            {m.deleted_at ? <i className="opacity-60">Message deleted</i> : <span className="whitespace-pre-wrap break-words"><Rich text={m.body} /></span>}
                                                            <span className={`bubble-time ${mine ? 'text-white/60' : 'text-gray-400'}`}>{m.pending ? 'sending…' : clock(m.created_at)}</span>
                                                        </div>
                                                        {!m.deleted_at && !m.pending && !m.failed && <span className="msg-tools flex gap-0.5">
                                                            <button type="button" className="tool" title="Reply" aria-label="Reply" onClick={() => { setReply(m); box.current?.focus(); }}><Icon name="reply" cls="w-3.5 h-3.5" /></button>
                                                            <button type="button" className="tool" title="Copy" aria-label="Copy" onClick={() => navigator.clipboard?.writeText(m.body).then(() => toast(true, 'Copied'))}><Icon name="copy" cls="w-3.5 h-3.5" /></button>
                                                            {mine && <button type="button" className="tool hover:!text-[#D55C48]" title="Delete" aria-label="Delete" onClick={() => remove(m)}><Icon name="trash" cls="w-3.5 h-3.5" /></button>}
                                                        </span>}
                                                    </div>
                                                    {m.failed && <button type="button" className="text-[10px] font-extrabold text-[#D55C48] mt-1 mr-1" onClick={() => retry(m)}>Not sent — tap to retry</button>}
                                                    {seenLine?.id === m.id && <span className={`text-[10px] font-bold mt-1 mr-1 flex items-center gap-1 ${seenLine.seen ? 'text-[#E86D58]' : 'text-gray-400'}`}><Icon name="check" cls="w-3 h-3" />{seenLine.text}</span>}
                                                </div>
                                            </div>}
                                    </div>;
                                })}
                            </>}
                        </div>
                        {newBelow > 0 && <button type="button" onClick={toBottom} className="absolute left-1/2 -translate-x-1/2 bottom-24 bg-[#111827] text-white text-[11px] font-extrabold rounded-full px-4 py-2 shadow-lg">{`${newBelow} new message${newBelow > 1 ? 's' : ''} ↓`}</button>}
                        <footer className="border-t border-gray-100 p-3 sm:p-4">
                            {reply && <div className="flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-3 py-2 mb-2 border-l-2 border-[#E86D58]">
                                <Icon name="reply" cls="w-4 h-4 text-[#E86D58]" />
                                <span className="min-w-0 flex-1 text-xs"><b className="block">{reply.sender_id === me ? 'You' : reply.sender_name}</b><span className="block truncate text-gray-500">{reply.body}</span></span>
                                <button type="button" className="icon-btn" aria-label="Cancel reply" onClick={() => setReply(null)}><Icon name="x" cls="w-3.5 h-3.5" /></button></div>}
                            {emojiOpen && <div className="emoji-pop grid grid-cols-8 gap-1 bg-white rounded-2xl border border-gray-100 shadow-lg p-2 mb-2 w-fit">
                                {EMOJI.map(e => <button key={e} type="button" className="w-9 h-9 rounded-xl hover:bg-[#F8F8FA] text-lg" onClick={() => { setDraft(d => d + e); box.current?.focus(); }}>{e}</button>)}</div>}
                            <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); sendNow(); }}>
                                <button type="button" className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${emojiOpen ? 'bg-[#FFF5F3] text-[#E86D58]' : 'bg-[#F8F8FA] text-gray-500 hover:text-gray-800'}`} aria-label="Emoji" onClick={() => setEmojiOpen(v => !v)}><Icon name="smile" cls="w-5 h-5" /></button>
                                <textarea ref={box} id="chatInput" rows={1} value={draft} maxLength={4000} placeholder="Write a message…" aria-label={`Message ${title}`}
                                    onChange={e => setDraft(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendNow(); } if (e.key === 'Escape') { setReply(null); setEmojiOpen(false); } }}
                                    className="flex-1 resize-none bg-[#F8F8FA] rounded-[1.4rem] border border-transparent focus:border-gray-200 focus:bg-white outline-none px-4 py-3 text-sm leading-5 custom-scrollbar" />
                                <button type="submit" id="chatSend" disabled={!draft.trim()} className="w-11 h-11 rounded-full bg-[#E86D58] text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-[#D55C48] transition-colors" aria-label="Send"><Icon name="send" cls="w-[18px] h-[18px]" /></button>
                            </form>
                            <p className="hidden sm:block text-[10px] text-gray-300 mt-1.5 ml-14">Enter to send · Shift + Enter for a new line</p>
                        </footer>
                    </>}
                </section>
            </div>
        </AppFrame>
    );
}

// ---------- start a chat: one person → one-to-one; several → a group ----------
function PeoplePicker({ people, picked, toggle, exclude = [] }: { people: Person[] | null; picked: Set<string>; toggle: (p: Person) => void; exclude?: string[] }) {
    const [q, setQ] = useState('');
    const list = (people || []).filter(p => !exclude.includes(p.id) && (!q.trim() || `${p.name} ${p.branch_name} ${p.branch} ${ROLE[p.role || ''] || ''}`.toLowerCase().includes(q.trim().toLowerCase())));
    return <>
        <label className="flex items-center gap-2 bg-[#F8F8FA] rounded-full px-4 py-2.5 mb-3"><Icon name="search" cls="w-4 h-4 text-gray-400" />
            <input id="peopleFilter" autoFocus className="bg-transparent border-none outline-none text-sm w-full" placeholder="Search by name or branch" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="max-h-[46vh] overflow-y-auto custom-scrollbar space-y-1 pr-1" id="peopleList">
            {!people ? [0, 1, 2].map(i => <div key={i} className="h-14 rounded-2xl bg-gray-50 animate-pulse" />)
                : list.length ? list.map(p => <label key={p.id} className={`flex items-center gap-3 p-2 rounded-2xl cursor-pointer ${picked.has(p.id) ? 'bg-[#FFF5F3]' : 'hover:bg-[#F8F8FA]'}`}>
                    <Avatar name={p.name} size="w-10 h-10" />
                    <span className="min-w-0 flex-1"><b className="block text-sm truncate">{p.name}</b><span className="block text-[11px] text-gray-400 truncate">{[ROLE[p.role || ''] || p.role, p.branch_name].filter(Boolean).join(' · ')}</span></span>
                    <input type="checkbox" className="w-4 h-4 accent-[#E86D58]" checked={picked.has(p.id)} onChange={() => toggle(p)} aria-label={`Pick ${p.name}`} /></label>)
                    : <p className="text-center text-xs text-gray-400 py-8">No one found.</p>}
        </div>
    </>;
}

function NewChat({ open, onClose, load, onDirect, onGroup }: { open: boolean; onClose: () => void; load: () => Promise<Person[]>; onDirect: (id: string) => void; onGroup: (id: number) => void }) {
    const [people, setPeople] = useState<Person[] | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open) { setPicked(new Set()); setName(''); load().then(setPeople); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
    const toggle = (p: Person) => setPicked(s => { const x = new Set(s); if (x.has(p.id)) x.delete(p.id); else x.add(p.id); return x; });
    const group = picked.size > 1;
    async function go() {
        if (!picked.size) return toast(false, 'Pick someone to chat with.');
        if (!group) return onDirect([...picked][0]);
        if (!name.trim()) return toast(false, 'Give the group a name.');
        setBusy(true);
        try { const r = await api<{ thread: number }>('/api/chat', { method: 'POST', body: { action: 'group', title: name, members: [...picked] } }); onGroup(r.thread); }
        catch (e) { toast(false, (e as Error).message); } finally { setBusy(false); }
    }
    return <Modal id="newChatModal" open={open} onClose={onClose} panelClassName="max-w-md">
        <div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="text-lg font-extrabold">New chat</h3><p className="text-xs text-gray-400 mt-0.5">Pick one person for a private chat, or several for a group.</p></div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <PeoplePicker people={people} picked={picked} toggle={toggle} />
        {group && <div className="mt-3"><label className="ui-label" htmlFor="groupName">Group name</label><input id="groupName" className="field" maxLength={80} placeholder="e.g. Salalah team" value={name} onChange={e => setName(e.target.value)} /></div>}
        <div className="flex items-center justify-between gap-3 mt-4"><span className="text-xs text-gray-400">{picked.size ? `${picked.size} picked` : ''}</span>
            <button type="button" id="startChat" className="btn btn-coral" disabled={busy || !picked.size} onClick={go}><Icon name={group ? 'users' : 'message'} />{group ? 'Create group' : 'Start chat'}</button></div>
    </Modal>;
}

function GroupInfo({ open, onClose, data, me, load, onChanged }: { open: boolean; onClose: () => void; data: Open; me: string; load: () => Promise<Person[]>; onChanged: (left: boolean) => void }) {
    const [title, setTitle] = useState(data.thread.title || '');
    const [adding, setAdding] = useState(false);
    const [people, setPeople] = useState<Person[] | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    useEffect(() => { if (open) { setTitle(data.thread.title || ''); setAdding(false); setPicked(new Set()); } }, [open, data.thread.id]);   // eslint-disable-line react-hooks/exhaustive-deps
    const post = async (body: object, left = false) => {
        try { await api('/api/chat', { method: 'POST', body: { ...body, thread: data.thread.id } }); onChanged(left); } catch (e) { toast(false, (e as Error).message); }
    };
    return <Modal id="groupInfo" open={open} onClose={onClose} panelClassName="max-w-md">
        <div className="flex items-start justify-between gap-3 mb-4"><div className="flex items-center gap-3"><Avatar name={data.thread.title || 'Group'} group /><div><h3 className="text-lg font-extrabold">{data.thread.title}</h3><p className="text-xs text-gray-400">{`${data.members.length} members`}</p></div></div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        {!adding ? <>
            <div className="flex gap-2 mb-4"><input className="field" maxLength={80} aria-label="Group name" value={title} onChange={e => setTitle(e.target.value)} />
                <button type="button" className="btn btn-light" disabled={!title.trim() || title.trim() === data.thread.title} onClick={() => post({ action: 'rename', title })}>Rename</button></div>
            <p className="sd-label mb-2">Members</p>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto custom-scrollbar">{data.members.map(m => <div key={m.id} className="flex items-center gap-3 p-2 rounded-2xl">
                <Avatar name={m.name} size="w-9 h-9" text="text-[10px]" /><span className="min-w-0"><b className="block text-sm">{m.id === me ? `${m.name} (you)` : m.name}</b><span className="block text-[11px] text-gray-400">{[ROLE[m.role || ''] || m.role, m.branch].filter(Boolean).join(' · ')}</span></span></div>)}</div>
            <div className="flex justify-between gap-2 mt-5">
                <button type="button" className="btn btn-light text-[#D55C48]" onClick={() => post({ action: 'leave' }, true)}>Leave group</button>
                <button type="button" className="btn btn-dark" onClick={() => { setAdding(true); load().then(setPeople); }}><Icon name="plus" />Add people</button></div>
        </> : <>
            <PeoplePicker people={people} picked={picked} toggle={p => setPicked(s => { const x = new Set(s); if (x.has(p.id)) x.delete(p.id); else x.add(p.id); return x; })} exclude={data.members.map(m => m.id)} />
            <div className="flex justify-between gap-2 mt-4"><button type="button" className="btn btn-light" onClick={() => setAdding(false)}>Back</button>
                <button type="button" className="btn btn-coral" disabled={!picked.size} onClick={() => post({ action: 'add', members: [...picked] })}>{`Add ${picked.size || ''}`.trim()}</button></div>
        </>}
    </Modal>;
}
