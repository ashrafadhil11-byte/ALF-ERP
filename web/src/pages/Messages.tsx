// Messages — chat between users: one-to-one and groups. Data: /api/chat.
// Left: my chats (unread first in mind, newest on top). Right: the open chat — bubbles grouped by sender, day lines,
// replies, "Seen", delete own message. New messages arrive by polling (every few seconds while the page is visible).
// ?t=<chat id> keeps the open chat in the address; ?to=<user id> opens the one-to-one chat with that user.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { jwtPayload } from '../lib/session';
import { toast } from '../lib/toast';
import './messages.css';

type Person = { id: string; name: string; role?: string; branch?: string; branch_name?: string };
type Thread = { id: number; kind: 'direct' | 'group' | 'assistant'; title?: string | null; last_message_at: string; last_message?: string | null; last_sender?: string | null; unread: number; members: Person[] };
type Card = { awb: string; consignee?: string; dest_city?: string; dest_country?: string; current_status?: string; current_status_code?: string; pieces?: number; weight?: number; chargeable_weight?: number };
type Msg = { id: number; sender_id: string | null; sender_name: string | null; body: string; reply_to?: number | null; system?: boolean; created_at: string; deleted_at?: string | null; pending?: boolean; failed?: boolean;
    file_name?: string | null; file_type?: string | null; file_size?: number | null; file_url?: string | null; awb?: string | null; card?: Card | null; ai_actions?: Job[] | null };
/** a job Farah prepared (status update, pickup, message, report) — done only when the user taps Confirm */
type Job = { id: string; kind: string; title: string; lines: string[]; state: 'ready' | 'done' | 'cancelled' | 'error'; result?: string };
type Member = Person & { last_read_at: string; typing?: boolean };
type Outgoing = { body: string; file?: { name: string; data: string; type: string; size: number; preview?: string } | null; awb?: string | null };

const kb = (n?: number | null) => !n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const MAX_FILE = 3 * 1024 * 1024;
/** photos are made smaller before sending (longest side 1600 px, JPEG); PDFs go as they are */
async function readFile(f: File): Promise<NonNullable<Outgoing['file']>> {
    const asData = (b: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(b); });
    if (f.type.startsWith('image/') && f.type !== 'image/gif') {
        const img = await createImageBitmap(f);
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise<Blob>((ok) => c.toBlob(b => ok(b!), 'image/jpeg', 0.85));
        const data = await asData(blob);
        return { name: f.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', data, type: 'image/jpeg', size: blob.size, preview: data };
    }
    if (f.type !== 'application/pdf' && f.type !== 'image/gif') throw new Error('Send a photo or a PDF.');
    if (f.size > MAX_FILE) throw new Error('The file is too large (max 3 MB).');
    const data = await asData(f);
    return { name: f.name, data, type: f.type, size: f.size, preview: f.type === 'image/gif' ? data : undefined };
}

function ShipmentCard({ c, mine }: { c: Card; mine: boolean }) {
    return <a href={`/app/shipments?awb=${encodeURIComponent(c.awb)}`} className={`block mt-1 mb-1.5 rounded-xl px-3 py-2.5 no-underline ${mine ? 'bg-white/10 hover:bg-white/15' : 'bg-white hover:bg-gray-50'} border ${mine ? 'border-white/15' : 'border-gray-100'}`}>
        <span className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider opacity-70"><Icon name="box" cls="w-3.5 h-3.5" />Shipment</span>
        <span className="block font-mono font-extrabold text-sm mt-0.5">{c.awb}</span>
        <span className="block text-xs opacity-80">{[c.consignee, [c.dest_city, c.dest_country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span>
        <span className="flex items-center justify-between gap-2 mt-1.5 text-[11px]"><span className={`pill-tag ${mine ? '!bg-white/15 !text-white' : 'pill-gray'}`}>{c.current_status || '—'}</span>
            <span className="opacity-70">{[c.pieces && `${c.pieces} pcs`, (c.chargeable_weight || c.weight) && `${c.chargeable_weight || c.weight} kg`].filter(Boolean).join(' · ')}</span></span>
    </a>;
}
function JobCard({ j, busy, onAct }: { j: Job; busy: boolean; onAct: (what: 'run' | 'cancel') => void }) {
    return <div className="farah-job mt-2 mb-1 bg-white border border-gray-200 rounded-xl p-3 space-y-1 text-gray-800" data-job={j.id}>
        <p className="font-extrabold text-[13px]">{j.title}</p>
        {j.lines.map((l, i) => <p key={i} className="text-xs text-gray-500 break-words">{l}</p>)}
        {(j.state === 'ready' || j.state === 'error') && <div className="flex gap-2 pt-1.5">
            <button type="button" disabled={busy} className="btn btn-coral btn-sm" onClick={() => onAct('run')}><Icon name="check" />{busy ? 'Doing it…' : j.state === 'error' ? 'Try again' : 'Confirm'}</button>
            <button type="button" disabled={busy} className="btn btn-light btn-sm" onClick={() => onAct('cancel')}>Cancel</button></div>}
        {j.state === 'done' && <p className="text-xs font-bold text-emerald-600 pt-1">{`✓ ${j.result || 'Done.'}`}</p>}
        {j.state === 'cancelled' && <p className="text-xs text-gray-400 pt-1">Cancelled — nothing was changed.</p>}
        {j.state === 'error' && j.result && <p className="text-xs font-bold text-[#D55C48]">{j.result}</p>}
    </div>;
}
type Open = { thread: { id: number; kind: 'direct' | 'group' | 'assistant'; title?: string | null }; members: Member[]; messages: Msg[]; more: boolean; quoted: { id: number; sender_name: string; body: string; deleted: boolean }[] };

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
const FARAH = 'Farah';
const threadName = (t: { kind: string; title?: string | null; members: Person[] }) => t.kind === 'assistant' ? FARAH : t.kind === 'group' ? (t.title || 'Group') : (t.members[0]?.name || 'Just you');

export function Avatar({ name, group = false, ai = false, size = 'w-11 h-11', text = 'text-xs' }: { name: string; group?: boolean; ai?: boolean; size?: string; text?: string }) {
    if (ai) return <span className={`${size} rounded-full bg-gradient-to-br from-[#E86D58] to-[#111827] text-white flex items-center justify-center flex-shrink-0 select-none`} title="Farah — AI assistant"><Icon name="sparkles" cls="w-1/2 h-1/2" /></span>;
    return <span className={`${size} ${text} ${group ? 'bg-[#FFF5F3] text-[#E86D58]' : `${tone(name)} text-white`} rounded-full flex items-center justify-center font-extrabold flex-shrink-0 select-none`}>
        {group ? <Icon name="users" cls="w-1/2 h-1/2" /> : initials(name)}</span>;
}

// links: web addresses, and shipment numbers (9 digits, or AFC-123456) open the shipment
function Rich({ text, bold = false }: { text: string; bold?: boolean }) {
    const parts = text.split(bold ? /(\*\*[^*\n]+\*\*|https?:\/\/[^\s]+|\/app\/[a-z-]+(?:\?[^\s)]*)?|\b\d{9}\b|\bAFC-\d{6}\b)/g : /(https?:\/\/[^\s]+|\b\d{9}\b|\bAFC-\d{6}\b)/g);
    return <>{parts.map((p, i) => bold && /^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b>
        : bold && /^\/app\/[a-z-]+/.test(p) ? <a key={i} href={p} className="font-bold underline underline-offset-2 break-all">{`Open ${p.replace(/^\/app\//, '').replace(/\?.*$/, '').replace(/-/g, ' ')} ›`}</a>
        : /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 break-all">{p}</a>
        : /^(\d{9}|AFC-\d{6})$/.test(p) ? <a key={i} href={`/app/shipments?awb=${encodeURIComponent(p)}`} className="font-mono font-bold underline underline-offset-2">{p}</a>
            : <span key={i}>{p}</span>)}</>;
}

/** The Messages page: the chat panel full size. */
export function Messages() {
    return <AppFrame><ChatPanel /></AppFrame>;
}

/** The chat itself — on the Messages page (list beside the chat; the address keeps the open chat) or in the floating
 *  popup (`popup`: one column, list or chat; `tools` = the popup's own buttons, shown in both headers). */
export function ChatPanel({ popup = false, tools }: { popup?: boolean; tools?: ReactNode }) {
    const qc = useQueryClient();
    const me = ME();
    const params = new URLSearchParams(popup ? '' : location.search);
    const [active, setActive] = useState<number | null>(() => Number(params.get('t')) || (popup ? Number(sessionStorage.getItem('alf_chat_open')) || null : null));
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
        if (popup) { try { if (id) sessionStorage.setItem('alf_chat_open', String(id)); else sessionStorage.removeItem('alf_chat_open'); } catch { /* ignore */ } }
        else history.replaceState(null, '', id ? `?t=${id}` : location.pathname);
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

    async function sendNow(text = draft, extra: Partial<Outgoing> = {}) {
        const body = text.trim();
        const file = extra.file === undefined ? pending : extra.file;
        if ((!body && !file && !extra.awb) || !open) return;
        const temp: Msg = { id: -Date.now(), sender_id: me, sender_name: 'You', body: body || (file ? `📎 ${file.name}` : `📦 Shipment ${extra.awb}`), reply_to: reply?.id || null, created_at: new Date().toISOString(), pending: true,
            file_name: file?.name, file_type: file?.type, file_size: file?.size, file_url: file?.preview || null };
        const tid = open.thread.id;
        setOpen(o => o ? { ...o, messages: [...o.messages, temp] } : o);
        setDraft(''); setReply(null); setEmojiOpen(false); setPending(null); stick.current = true;
        try {
            const r = await api<{ message: Msg }>('/api/chat', { method: 'POST', body: { action: 'send', thread: tid, body, reply_to: temp.reply_to, awb: extra.awb || undefined, file: file ? { name: file.name, data: file.data } : undefined } });
            if (file?.preview && !r.message.file_url) r.message.file_url = file.preview;
            setOpen(o => o && o.thread.id === tid ? { ...o, messages: o.messages.some(m => m.id === r.message.id) ? o.messages.filter(m => m.id !== temp.id) : o.messages.map(m => m.id === temp.id ? r.message : m) } : o);
            qc.invalidateQueries({ queryKey: ['chat-inbox'] });
            if (open.thread.kind === 'assistant') askFarah(tid);
        } catch (e) {
            setOpen(o => o ? { ...o, messages: o.messages.map(m => m.id === temp.id ? { ...m, pending: false, failed: true } : m) } : o);
            toast(false, (e as Error).message);
        }
    }
    // ---------- Farah ----------
    const [farahBusy, setFarahBusy] = useState(false);
    const [jobBusy, setJobBusy] = useState<string | null>(null);
    async function askFarah(tid: number) {
        setFarahBusy(true); stick.current = true;
        try {
            const r = await api<{ message: Msg | null }>('/api/assistant', { method: 'POST', body: { action: 'reply', thread: tid } });
            if (r.message) { const m = r.message; setOpen(o => o && o.thread.id === tid && !o.messages.some(x => x.id === m.id) ? { ...o, messages: [...o.messages.filter(x => !x.pending), m, ...o.messages.filter(x => x.pending)] } : o); }
            markRead(tid);
        } catch (e) { toast(false, (e as Error).message); }
        finally { setFarahBusy(false); }
    }
    async function actJob(m: Msg, j: Job, what: 'run' | 'cancel') {
        setJobBusy(j.id);
        try {
            const r = await api<{ message: { id: number; ai_actions: Job[] }; ok: boolean; result: string }>('/api/assistant', { method: 'POST', body: { action: what, message: m.id, id: j.id } });
            setOpen(o => o ? { ...o, messages: o.messages.map(x => x.id === m.id ? { ...x, ai_actions: r.message.ai_actions } : x) } : o);
            if (what === 'run') toast(r.ok, r.result);
        } catch (e) { toast(false, (e as Error).message); }
        finally { setJobBusy(null); }
    }
    const retry = (m: Msg) => { setOpen(o => o ? { ...o, messages: o.messages.filter(x => x.id !== m.id) } : o); sendNow(m.body); };
    // attachments and shipment cards
    const [pending, setPending] = useState<Outgoing['file']>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    async function pickFile(f?: File | null) {
        if (!f) return;
        try { setPending(await readFile(f)); setEmojiOpen(false); box.current?.focus(); } catch (e) { toast(false, (e as Error).message); }
        if (fileInput.current) fileInput.current.value = '';
    }
    function shareShipment() {
        const awb = window.prompt('Shipment number (AWB) to share:')?.trim().toUpperCase();
        if (awb) { setEmojiOpen(false); sendNow(draft, { awb, file: null }); }
    }
    // "typing…": tell the others at most every 3 s while typing
    const typedAt = useRef(0);
    const typing = () => {
        if (!open || Date.now() - typedAt.current < 3000) return;
        typedAt.current = Date.now();
        api('/api/chat', { method: 'POST', body: { action: 'typing', thread: open.thread.id } }).catch(() => {});
    };
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
    useEffect(() => { const to = params.get('to'); if (to && !popup) direct(to); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    // ?farah=1 (the old AI Assistant page links here): open Farah's chat
    useEffect(() => { if (!popup && params.get('farah') && !active) { const f = threads.find(t => t.kind === 'assistant'); if (f) { pick(f.id); const ask = params.get('ask'); if (ask) setTimeout(() => setDraft(ask.slice(0, 1000)), 80); } } }, [threads.length]);   // eslint-disable-line react-hooks/exhaustive-deps

    const visible = [...threads].sort((a, b) => (b.kind === 'assistant' ? 1 : 0) - (a.kind === 'assistant' ? 1 : 0)).filter(t => !filter.trim() || threadName(t).toLowerCase().includes(filter.trim().toLowerCase()) || t.members.some(m => (m.branch || '').toLowerCase().includes(filter.trim().toLowerCase())));
    const current = threads.find(t => t.id === active);
    const others = (open?.members || []).filter(m => m.id !== me);
    const isFarah = open?.thread.kind === 'assistant';
    const title = open ? (isFarah ? FARAH : open.thread.kind === 'group' ? open.thread.title || 'Group' : others[0]?.name || current?.members[0]?.name || 'Chat') : '';
    const typers = (open?.members || []).filter(m => m.typing && m.id !== me);
    const sub = isFarah ? (farahBusy ? 'Farah is typing…' : 'AI assistant · reads live ERP data · asks before any change') : typers.length ? `${typers.map(t => t.name.split(' ')[0]).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…` : open ? (open.thread.kind === 'group' ? `${open.members.length} members · ${open.members.map(m => m.id === me ? 'You' : m.name.split(' ')[0]).join(', ')}`
        : [ROLE[others[0]?.role || ''] || others[0]?.role, others[0]?.branch].filter(Boolean).join(' · ')) : '';

    // "Seen": on my latest message — a direct chat says Seen / Sent; a group says who has seen it
    const seenLine = useMemo(() => {
        if (!open || open.thread.kind === 'assistant') return null;
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
        <>
            <NewChat open={newOpen} onClose={() => setNewOpen(false)} load={loadPeople} onDirect={direct} onGroup={(id) => { setNewOpen(false); pick(id); qc.invalidateQueries({ queryKey: ['chat-inbox'] }); }} />
            {open && <GroupInfo open={infoOpen} onClose={() => setInfoOpen(false)} data={open} me={me} load={loadPeople}
                onChanged={async (left) => { setInfoOpen(false); qc.invalidateQueries({ queryKey: ['chat-inbox'] }); if (left) pick(null); else if (active) setOpen(await api<Open>(`/api/chat?thread=${active}`)); }} />}
            <div id={popup ? 'chatPop' : 'chatApp'} className={`chat-ui ${popup ? 'h-full flex flex-col' : 'chat-app grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-0'}`}>
                {/* ---------- chat list ---------- */}
                <aside className={`${active ? (popup ? 'hidden' : 'hidden lg:flex') : 'flex'} flex-col min-h-0 ${popup ? 'flex-1 bg-white p-3' : 'bg-[#F8F8FA] rounded-[1.75rem] p-3'}`}>
                    <div className="flex items-center justify-between px-2 pt-1 pb-3">
                        <div><h2 className="text-lg font-extrabold">Messages</h2><p className="text-[11px] text-gray-400 font-bold">{inbox.data?.unread ? `${inbox.data.unread} unread` : 'Chat with your team'}</p></div>
                        <span className="flex items-center gap-1.5">{tools}<button type="button" id="newChat" className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center hover:bg-[#E86D58] transition-colors" aria-label="New chat" title="New chat" onClick={() => { loadPeople(); setNewOpen(true); }}><Icon name="edit" /></button></span>
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
                                    <span className="relative"><Avatar name={name} group={t.kind === 'group'} ai={t.kind === 'assistant'} />{t.unread > 0 && !on && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#E86D58] ring-2 ring-[#F8F8FA]" />}</span>
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
                <section className={`${active ? 'flex' : (popup ? 'hidden' : 'hidden lg:flex')} flex-col min-h-0 ${popup ? 'flex-1' : 'rounded-[1.75rem] border border-gray-100'} bg-white overflow-hidden relative`}>
                    {!active ? <div className="flex-1 flex flex-col items-center justify-center text-center p-10 chat-empty">
                        <span className="w-20 h-20 rounded-[1.75rem] bg-[#FFF5F3] text-[#E86D58] flex items-center justify-center mb-4"><Icon name="message" cls="w-9 h-9" /></span>
                        <h3 className="text-lg font-extrabold">Your messages</h3><p className="text-sm text-gray-400 mt-1 max-w-xs">Pick a chat on the left, or start a new one with a colleague or a group.</p>
                        <button type="button" className="btn btn-coral mt-5" onClick={() => { loadPeople(); setNewOpen(true); }}><Icon name="plus" />New chat</button>
                    </div> : <>
                        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                            <button type="button" className={`${popup ? '' : 'lg:hidden '}w-9 h-9 rounded-full hover:bg-gray-50 flex items-center justify-center`} aria-label="Back to chats" onClick={() => pick(null)}><Icon name="arrowLeft" /></button>
                            <Avatar name={title || '…'} group={open?.thread.kind === 'group'} ai={isFarah} size="w-10 h-10" />
                            <div className="min-w-0 flex-1"><h3 id="chatTitle" className="text-sm font-extrabold truncate">{title || ' '}</h3><p className={`text-[11px] truncate ${typers.length || (isFarah && farahBusy) ? 'text-[#E86D58] font-bold' : 'text-gray-400'}`}>{sub}</p></div>
                            {open?.thread.kind === 'group' && <button type="button" id="chatInfo" className="icon-btn" aria-label="Group details" title="Group details" onClick={() => { loadPeople(); setInfoOpen(true); }}><Icon name="users" /></button>}
                            {tools}
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
                                                {!mine && (open.thread.kind === 'group' ? (sameAsNext ? <span className="w-8 flex-shrink-0" /> : <Avatar name={m.sender_name || '?'} size="w-8 h-8" text="text-[10px]" />) : isFarah ? (sameAsNext ? <span className="w-8 flex-shrink-0" /> : <Avatar name={FARAH} ai size="w-8 h-8" />) : null)}
                                                <div className={`max-w-[78%] sm:max-w-[65%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                                                    {!mine && open.thread.kind === 'group' && !sameAsPrev && <span className="text-[10px] font-extrabold text-gray-500 mb-1 ml-3">{m.sender_name}</span>}
                                                    <div className={`flex items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
                                                        <div tabIndex={-1} className={`bubble outline-none ${mine ? 'bubble-me' : 'bubble-them'} ${sameAsNext ? (mine ? 'join-next-me' : 'join-next-them') : ''} ${sameAsPrev ? (mine ? 'join-prev-me' : 'join-prev-them') : ''} ${m.pending ? 'opacity-60' : ''} ${m.failed ? 'ring-2 ring-[#E86D58]' : ''}`}>
                                                            {q && <span className={`block text-[11px] rounded-xl px-2.5 py-1.5 mb-1.5 border-l-2 ${mine ? 'bg-white/10 border-white/50' : 'bg-white border-[#E86D58]'}`}><b className="block">{q.name}</b><span className="line-clamp-2 opacity-80">{q.body}</span></span>}
                                                            {m.deleted_at ? <i className="opacity-60">Message deleted</i> : <>
                                                                {m.file_type?.startsWith('image/') && m.file_url && <a href={m.file_url} target="_blank" rel="noopener" className="block -mx-1.5 -mt-0.5 mb-1.5"><img src={m.file_url} alt={m.file_name || 'photo'} loading="lazy" className="rounded-xl max-h-60 w-auto max-w-full object-cover" /></a>}
                                                                {m.file_type === 'application/pdf' && <a href={m.file_url || undefined} target="_blank" rel="noopener" className={`flex items-center gap-2.5 rounded-xl px-3 py-2 mb-1.5 no-underline ${m.sender_id === me ? 'bg-white/10' : 'bg-white border border-gray-100'}`}>
                                                                    <span className="w-8 h-8 rounded-lg bg-[#E86D58] text-white text-[9px] font-extrabold flex items-center justify-center">PDF</span>
                                                                    <span className="min-w-0"><b className="block text-xs truncate">{m.file_name}</b><span className="block text-[10px] opacity-70">{kb(m.file_size)}{m.file_url ? '' : ' · uploading'}</span></span></a>}
                                                                {m.card && <ShipmentCard c={m.card} mine={m.sender_id === me} />}
                                                                {!(m.file_name && /^(📷|📎) /.test(m.body)) && !(m.card && m.body === `📦 Shipment ${m.awb}`) && <span className="whitespace-pre-wrap break-words"><Rich text={m.body} bold={isFarah && !mine} /></span>}
                                                                {m.ai_actions?.map(j => <JobCard key={j.id} j={j} busy={jobBusy === j.id} onAct={(what) => actJob(m, j, what)} />)}
                                                            </>}
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
                                {isFarah && farahBusy && <div className="flex items-end gap-2 mt-3" id="farahTyping"><Avatar name={FARAH} ai size="w-8 h-8" />
                                    <div className="bubble bubble-them"><span className="farah-dots inline-flex gap-1 py-1"><i /><i /><i /></span></div></div>}
                            </>}
                        </div>
                        {newBelow > 0 && <button type="button" onClick={toBottom} className="absolute left-1/2 -translate-x-1/2 bottom-24 bg-[#111827] text-white text-[11px] font-extrabold rounded-full px-4 py-2 shadow-lg">{`${newBelow} new message${newBelow > 1 ? 's' : ''} ↓`}</button>}
                        <footer className="border-t border-gray-100 p-3 sm:p-4">
                            {reply && <div className="flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-3 py-2 mb-2 border-l-2 border-[#E86D58]">
                                <Icon name="reply" cls="w-4 h-4 text-[#E86D58]" />
                                <span className="min-w-0 flex-1 text-xs"><b className="block">{reply.sender_id === me ? 'You' : reply.sender_name}</b><span className="block truncate text-gray-500">{reply.body}</span></span>
                                <button type="button" className="icon-btn" aria-label="Cancel reply" onClick={() => setReply(null)}><Icon name="x" cls="w-3.5 h-3.5" /></button></div>}
                            {pending && <div id="chatAttach" className="flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-3 py-2 mb-2">
                                {pending.preview ? <img src={pending.preview} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <span className="w-10 h-10 rounded-lg bg-[#E86D58] text-white text-[10px] font-extrabold flex items-center justify-center">PDF</span>}
                                <span className="min-w-0 flex-1 text-xs"><b className="block truncate">{pending.name}</b><span className="text-gray-400">{`${kb(pending.size)} · add a caption or press send`}</span></span>
                                <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => setPending(null)}><Icon name="x" cls="w-3.5 h-3.5" /></button></div>}
                            {emojiOpen && <div className="emoji-pop bg-white rounded-2xl border border-gray-100 shadow-lg p-2 mb-2 w-fit">
                                <div className="flex gap-1.5 mb-2">
                                    <button type="button" id="chatPhoto" className="btn btn-light btn-sm" onClick={() => fileInput.current?.click()}><Icon name="camera" cls="w-3.5 h-3.5" />Photo / PDF</button>
                                    <button type="button" id="chatShip" className="btn btn-light btn-sm" onClick={shareShipment}><Icon name="box" cls="w-3.5 h-3.5" />Share shipment</button></div>
                                <div className="grid grid-cols-8 gap-1">{EMOJI.map(e => <button key={e} type="button" className="w-9 h-9 rounded-xl hover:bg-[#F8F8FA] text-lg" onClick={() => { setDraft(d => d + e); box.current?.focus(); }}>{e}</button>)}</div></div>}
                            <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
                            <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); sendNow(); }}>
                                {!isFarah && <button type="button" className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${emojiOpen ? 'bg-[#FFF5F3] text-[#E86D58]' : 'bg-[#F8F8FA] text-gray-500 hover:text-gray-800'}`} aria-label="Attach, share or emoji" title="Photo, PDF, shipment, emoji" onClick={() => setEmojiOpen(v => !v)}><Icon name={emojiOpen ? 'x' : 'plus'} cls="w-5 h-5" /></button>}
                                <textarea ref={box} id="chatInput" rows={1} value={draft} maxLength={4000} placeholder={isFarah ? 'Ask Farah anything…' : 'Write a message…'} aria-label={`Message ${title}`}
                                    onChange={e => { setDraft(e.target.value); typing(); }}
                                    onPaste={e => { const f = Array.from(e.clipboardData.files)[0]; if (f) { e.preventDefault(); pickFile(f); } }}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendNow(); } if (e.key === 'Escape') { setReply(null); setEmojiOpen(false); } }}
                                    className="flex-1 resize-none bg-[#F8F8FA] rounded-[1.4rem] border border-transparent focus:border-gray-200 focus:bg-white outline-none px-4 py-3 text-sm leading-5 custom-scrollbar" />
                                <button type="submit" id="chatSend" disabled={!draft.trim() && !pending} className="w-11 h-11 rounded-full bg-[#E86D58] text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-[#D55C48] transition-colors" aria-label="Send"><Icon name="send" cls="w-[18px] h-[18px]" /></button>
                            </form>
                            <p className={`hidden sm:block text-[10px] text-gray-300 mt-1.5 ${isFarah ? 'ml-2' : 'ml-14'}`}>{isFarah ? 'Farah reads live ERP data and asks you to confirm before changing anything' : 'Enter to send · Shift + Enter for a new line'}</p>
                        </footer>
                    </>}
                </section>
            </div>
        </>
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
