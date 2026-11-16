// File: admin/components/notifications.js — bell + panel in the top bar (loaded by topbar.js).
// Data: GET /api/notifications (polled every 60 s while the tab is visible). Opening the panel marks all as read.
(() => {
    const POLL_MS = 60000;
    const KIND = {
        inbound:   { icon: 'truck',   tone: 'bg-[#111827] text-white' },
        exception: { icon: 'alert',   tone: 'bg-[#FFF5F3] text-[#D55C48]' },
        review:    { icon: 'star',    tone: 'bg-amber-50 text-amber-500' },
        carrier:   { icon: 'globe',   tone: 'bg-gray-100 text-gray-600' }
    };
    let items = [], unread = 0, open = false, timer = null, loaded = false;

    const ago = (iso) => {
        const s = Math.max(1, (Date.now() - new Date(iso)) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.floor(s / 60)} min ago`;
        if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
        return `${Math.floor(s / 86400)} d ago`;
    };

    function mount() {
        const anchor = document.getElementById('notifSlot');
        if (!anchor || !window.UI) return;
        anchor.innerHTML = `
            <div class="relative">
                <button type="button" id="notifBtn" aria-label="Notifications" aria-haspopup="dialog" aria-expanded="false"
                        class="relative w-11 h-11 bg-[#F8F8FA] rounded-full border border-gray-200/70 flex items-center justify-center text-gray-700 hover:bg-[#111827] hover:text-white hover:border-[#111827] transition-all shadow-sm">
                    <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
                    <span id="notifBadge" class="hidden absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-[#E86D58] text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white"></span>
                </button>
                <div id="notifPanel" role="dialog" aria-label="Notifications"
                     class="notif-panel fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-24 sm:top-14 sm:w-[380px] z-[60] bg-white rounded-[1.75rem] border border-gray-100 shadow-[0_24px_60px_-12px_rgba(17,24,39,.25)] overflow-hidden">
                    <div class="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
                        <div><p class="text-sm font-extrabold">Notifications</p><p id="notifSub" class="text-[10px] text-gray-400 font-bold">Last 7 days</p></div>
                        <button type="button" id="notifRefresh" class="icon-btn" title="Refresh">${UI.icon('refresh', 'w-3.5 h-3.5')}</button>
                    </div>
                    <div id="notifList" class="max-h-[60vh] overflow-y-auto custom-scrollbar p-2"></div>
                </div>
            </div>`;
        const btn = document.getElementById('notifBtn');
        btn.onclick = (e) => { e.stopPropagation(); toggle(!open); };
        document.getElementById('notifRefresh').onclick = (e) => { e.stopPropagation(); load(true); };
        document.addEventListener('click', (e) => { if (open && !document.getElementById('notifPanel').contains(e.target)) toggle(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { toggle(false); btn.focus(); } });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
        load();
        timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    }

    async function load(force) {
        try {
            const r = await UI.api('/api/notifications');
            items = r.items || []; unread = r.unread || 0; loaded = true;
        } catch (e) { if (force) UI.toast(false, e.message); }
        paint();
    }

    function paint() {
        const badge = document.getElementById('notifBadge');
        if (!badge) return;
        badge.textContent = unread > 9 ? '9+' : unread;
        badge.classList.toggle('hidden', !unread);
        if (unread) badge.classList.add('notif-pop');
        const list = document.getElementById('notifList');
        list.innerHTML = !loaded ? '<p class="p-8 text-center text-xs text-gray-400">Loading…</p>'
            : items.map(n => {
                const k = KIND[n.kind] || KIND.carrier;
                return `<a href="${UI.esc(n.href)}" class="flex gap-3 p-3 rounded-2xl hover:bg-[#F8F8FA] transition-colors ${n.unread ? 'bg-[#FFF5F3]/60' : ''}">
                    <span class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${k.tone}">${UI.icon(k.icon, 'w-4 h-4')}</span>
                    <span class="min-w-0 flex-1">
                        <span class="flex items-start justify-between gap-2"><span class="text-xs font-extrabold leading-snug">${UI.esc(n.title)}</span>
                        ${n.unread ? '<span class="w-2 h-2 rounded-full bg-[#E86D58] mt-1 flex-shrink-0"></span>' : ''}</span>
                        ${n.body ? `<span class="block text-[11px] text-gray-500 mt-0.5 line-clamp-2">${UI.esc(n.body)}</span>` : ''}
                        <span class="block text-[10px] font-bold text-gray-400 mt-1">${ago(n.at)}</span>
                    </span></a>`;
            }).join('') || `<div class="p-10 text-center"><span class="inline-flex w-12 h-12 rounded-full bg-[#F8F8FA] items-center justify-center text-gray-400 mb-2">${UI.icon('checkCircle', 'w-5 h-5')}</span><p class="text-xs font-bold text-gray-500">You're all caught up</p></div>`;
        document.getElementById('notifSub').textContent = unread ? `${unread} new · last 7 days` : 'Last 7 days';
    }

    function toggle(v) {
        open = v;
        document.getElementById('notifPanel').classList.toggle('open', v);
        document.getElementById('notifBtn').setAttribute('aria-expanded', String(v));
        if (v && unread) {
            unread = 0;
            document.getElementById('notifBadge').classList.add('hidden');
            UI.api('/api/notifications', { method: 'POST', body: { action: 'seen' } }).catch(() => {});
        }
        if (!v) items = items.map(n => ({ ...n, unread: false }));
        if (!v) setTimeout(paint, 250);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 0));
    else setTimeout(mount, 0);
})();
