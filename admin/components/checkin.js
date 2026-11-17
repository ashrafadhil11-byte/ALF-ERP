// File: admin/components/checkin.js — check in / out from anywhere in the app.
//  • Top bar (every page): Check in → Start break / End break → Check out; after check-out it shows the hours worked.
//  • Every page: a reminder popup when your shift has started and you have not checked in,
//    or your shift is over and you have not checked out. "Later" hides it for 30 minutes.
// Data: GET /api/attendance?view=status (the server decides when to remind, in the branch's time zone).
(() => {
    if (window.Checkin) return;
    const CHECK_EVERY_MS = 5 * 60e3;
    const SNOOZE_MS = 30 * 60e3;
    const KEY = 'alf_checkin_snooze';
    let state = null, busy = false;

    const hm = (v) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const hrs = (m) => m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '0h';
    const snoozed = (kind) => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.kind === kind && s.day === state?.today && s.until > Date.now(); } catch (e) { return false; } };

    async function load() {
        try { state = await UI.api('/api/attendance?view=status'); } catch (e) { state = null; }
        paintCard(); paintPopup();
        return state;
    }

    function position() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
            navigator.geolocation.getCurrentPosition(p => resolve(p.coords), err => reject(new Error(err.code === 1
                ? 'Location is blocked. Allow location for this site in your browser settings, then try again.'
                : 'Could not get your location. Turn on GPS or move near a window and try again.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        });
    }

    async function punch(kind) {
        if (busy) return;
        busy = kind; paintCard(); paintPopup();
        try {
            const needsGps = kind === 'in' || kind === 'out';
            const c = !needsGps ? null : state?.branch?.has_location ? await position() : await position().catch(() => null);
            const out = await UI.api('/api/attendance', { method: 'POST', body: { action: 'punch', kind, lat: c?.latitude, lng: c?.longitude, accuracy: c?.accuracy } });
            const r = out.record || {};
            UI.toast(true, {
                in: `Checked in at ${hm(r.check_in)}${r.late_min ? ` — ${r.late_min} min late` : ''}.`,
                break: `Break started at ${hm(r.break_started_at)}.`,
                resume: `Back from break at ${hm(r.break_ended_at)}${r.break_over_min ? ` — ${r.break_over_min} min over` : ''}.`,
                out: `Checked out at ${hm(r.check_out)}. Worked ${hrs(r.worked_min)}.`
            }[kind]);
            UI.beep?.(true);
            busy = false;
            await load();
            document.dispatchEvent(new CustomEvent('attendance:changed'));
        } catch (e) { busy = false; UI.toast(false, e.message); paintCard(); paintPopup(); }
    }

    // where the day stands: in → work → (break → work) → done
    const stageOf = (r) => !r?.check_in ? 'in' : r.check_out ? 'done' : r.break_started_at && !r.break_ended_at ? 'onbreak' : 'work';
    const ICON_BREAK = '<svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/></svg>';

    // ---------- top bar buttons (every page) ----------
    function paintCard() {
        const el = document.getElementById('checkinSlot');
        if (!el) return;
        if (!state || state.on_leave) { el.innerHTML = ''; return; }
        const r = state.record, s = state.shift, stage = stageOf(r);
        const brk = s.break_start ? ` · break ${s.break_start}–${s.break_end}` : '';
        const btn = (kind, cls, icon, label, tip, open = true) => `<button type="button" data-punch="${kind}" ${busy ? 'disabled' : ''} class="fab ${open ? 'fab-open' : ''} ${cls}" title="${UI.esc(tip)}" aria-label="${label}">${icon}<span class="fab-label">${busy === kind ? (kind === 'in' || kind === 'out' ? 'Locating…' : 'Saving…') : label}</span></button>`;
        if (stage === 'done') {
            el.innerHTML = `<a href="attendance.html" class="fab ck-done" title="${UI.esc(`${hm(r.check_in)} – ${hm(r.check_out)}`)}">${UI.icon('check')}<span class="fab-label">Done · ${hrs(r.worked_min)}</span></a>`;
        } else if (stage === 'in') {
            el.innerHTML = btn('in', 'ck-in', UI.icon('clock'), 'Check in', `Shift ${s.start}–${s.end}${brk}`);
        } else if (stage === 'onbreak') {
            el.innerHTML = btn('resume', 'ck-break', ICON_BREAK, 'End break', `On break since ${hm(r.break_started_at)}${brk}`);
        } else {
            // working: a small round "Start break" (opens on hover) next to Check out
            const canBreak = !r.break_started_at;
            el.innerHTML = `<div class="flex items-center gap-2">${canBreak ? btn('break', 'ck-brk-start', ICON_BREAK, 'Start break', `Start your break${brk}`, false) : ''}
                ${btn('out', 'ck-out', UI.icon('clock'), 'Check out', `In since ${hm(r.check_in)}${r.late_min ? ` (${r.late_min} min late)` : ''} · shift ends ${s.end}`)}</div>`;
        }
    }

    // ---------- reminder popup ----------
    const POP = {
        in: { title: 'Time to check in', btn: 'Check in now', tone: 'bg-[#111827]', cls: 'btn-dark' },
        out: { title: 'Don’t forget to check out', btn: 'Check out now', tone: 'bg-coral-500', cls: 'btn-coral' },
        resume: { title: 'Your break is over', btn: 'End break', tone: 'bg-amber-500', cls: 'btn-dark' }
    };
    function paintPopup() {
        let box = document.getElementById('checkinPop');
        const kind = state?.remind;
        const onAttendancePage = /attendance\.html$/.test(location.pathname);
        if (!kind || !POP[kind] || snoozed(kind) || onAttendancePage) { box?.remove(); return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'checkinPop';
            box.setAttribute('role', 'alertdialog');
            box.setAttribute('aria-label', 'Attendance reminder');
            box.className = 'fixed z-[70] right-4 bottom-24 lg:bottom-6 w-[calc(100%-2rem)] max-w-sm bg-white rounded-[1.5rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] border border-gray-100 p-4 ui-fade';
            document.body.appendChild(box);
        }
        const s = state.shift, P = POP[kind];
        const text = kind === 'in' ? `Shift ${s.start}–${s.end}. Check in at ${UI.esc(state.branch?.name || 'your branch')}.`
            : kind === 'resume' ? `You started your break at ${hm(state.record?.break_started_at)}${s.break_end ? ` — it was due to end at ${s.break_end}` : ''}.`
            : `Your shift ended at ${s.end}. Check out before you leave.`;
        box.innerHTML = `<div class="flex gap-3">
            <span class="w-11 h-11 rounded-2xl ${P.tone} text-white flex items-center justify-center flex-shrink-0">${kind === 'resume' ? ICON_BREAK.replace('w-4 h-4', 'w-5 h-5') : UI.icon('clock', 'w-5 h-5')}</span>
            <div class="min-w-0 flex-1"><p class="text-sm font-extrabold">${P.title}</p><p class="text-xs text-gray-500 mt-0.5">${text}</p>
            <div class="flex gap-2 mt-3"><button type="button" data-punch="${kind}" ${busy ? 'disabled' : ''} class="btn ${P.cls} btn-sm">${busy ? 'Saving…' : P.btn}</button>
            <button type="button" data-snooze class="btn btn-light btn-sm">Later</button></div></div>
            <button type="button" data-snooze class="icon-btn !w-7 !h-7 flex-shrink-0" aria-label="Close reminder">${UI.icon('x', 'w-3 h-3')}</button></div>`;
    }

    document.addEventListener('click', (e) => {
        const p = e.target.closest('[data-punch]');
        if (p && (p.closest('#checkinSlot') || p.closest('#checkinPop'))) return punch(p.dataset.punch);
        if (e.target.closest('#checkinPop [data-snooze]')) {
            try { localStorage.setItem(KEY, JSON.stringify({ kind: state.remind, day: state.today, until: Date.now() + SNOOZE_MS })); } catch (err) { /* ignore */ }
            document.getElementById('checkinPop')?.remove();
        }
    });

    const start = () => {
        if (!localStorage.getItem('cargo_auth_token')) return;
        setTimeout(load, 400);   // let the page's own data load first
        setInterval(() => { if (!document.hidden) load(); }, CHECK_EVERY_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden && state && Date.now() - (window.__ckAt || 0) > 60e3) { window.__ckAt = Date.now(); load(); } });
    };
    window.Checkin = { load, punch };
    // Some pages (the dashboard) do not include the shared helpers — load them first.
    const boot = () => {
        if (window.UI) return start();
        const s = document.createElement('script'); s.src = 'components/ui.js'; s.onload = start; document.head.appendChild(s);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
