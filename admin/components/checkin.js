// File: admin/components/checkin.js — check in / out from anywhere in the app.
//  • Top bar (every page): Check in / Check out button; after check-out it shows the hours worked.
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
        busy = true; paintCard(); paintPopup();
        try {
            const c = state?.branch?.has_location ? await position() : await position().catch(() => null);
            const out = await UI.api('/api/attendance', { method: 'POST', body: { action: 'punch', kind, lat: c?.latitude, lng: c?.longitude, accuracy: c?.accuracy } });
            const r = out.record || {};
            UI.toast(true, kind === 'in' ? `Checked in at ${hm(r.check_in)}${r.late_min ? ` — ${r.late_min} min late` : ''}.` : `Checked out at ${hm(r.check_out)}. Worked ${hrs(r.worked_min)}.`);
            UI.beep?.(true);
            busy = false;
            await load();
            document.dispatchEvent(new CustomEvent('attendance:changed'));
        } catch (e) { busy = false; UI.toast(false, e.message); paintCard(); paintPopup(); }
    }

    // ---------- top bar button (every page) ----------
    function paintCard() {
        const el = document.getElementById('checkinSlot');
        if (!el) return;
        if (!state || state.on_leave) { el.innerHTML = ''; return; }
        const r = state.record, s = state.shift;
        const stage = !r?.check_in ? 'in' : !r.check_out ? 'out' : 'done';
        const label = busy ? 'Locating…' : stage === 'in' ? 'Check in' : stage === 'out' ? 'Check out' : `Done · ${hrs(r.worked_min)}`;
        const tip = stage === 'in' ? `Shift ${s.start}–${s.end}${s.break_start ? ` · break ${s.break_start}–${s.break_end}` : ''}` : stage === 'out' ? `In since ${hm(r.check_in)}${r.late_min ? ` (${r.late_min} min late)` : ''} · shift ends ${s.end}` : `${hm(r.check_in)} – ${hm(r.check_out)}`;
        el.innerHTML = stage === 'done'
            ? `<a href="attendance.html" class="fab ck-done" title="${UI.esc(tip)}">${UI.icon('check')}<span class="fab-label">${UI.esc(label)}</span></a>`
            : `<button type="button" data-punch="${stage}" ${busy ? 'disabled' : ''} class="fab fab-open ck-${stage}" title="${UI.esc(tip)}" aria-label="${label}">${UI.icon('clock')}<span class="fab-label">${label}</span></button>`;
    }

    // ---------- reminder popup ----------
    function paintPopup() {
        let box = document.getElementById('checkinPop');
        const kind = state?.remind;
        const onAttendancePage = /attendance\.html$/.test(location.pathname);
        if (!kind || snoozed(kind) || onAttendancePage) { box?.remove(); return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'checkinPop';
            box.setAttribute('role', 'alertdialog');
            box.setAttribute('aria-label', 'Attendance reminder');
            box.className = 'fixed z-[70] right-4 bottom-24 lg:bottom-6 w-[calc(100%-2rem)] max-w-sm bg-white rounded-[1.5rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] border border-gray-100 p-4 ui-fade';
            document.body.appendChild(box);
        }
        const s = state.shift;
        const title = kind === 'in' ? 'Time to check in' : 'Don’t forget to check out';
        const text = kind === 'in' ? `Shift ${s.start}–${s.end}. Check in at ${UI.esc(state.branch?.name || 'your branch')}.`
            : `Your shift ended at ${s.end}. Check out before you leave.`;
        box.innerHTML = `<div class="flex gap-3">
            <span class="w-11 h-11 rounded-2xl ${kind === 'in' ? 'bg-[#111827]' : 'bg-coral-500'} text-white flex items-center justify-center flex-shrink-0">${UI.icon('clock', 'w-5 h-5')}</span>
            <div class="min-w-0 flex-1"><p class="text-sm font-extrabold">${title}</p><p class="text-xs text-gray-500 mt-0.5">${text}</p>
            <div class="flex gap-2 mt-3"><button type="button" data-punch="${kind}" ${busy ? 'disabled' : ''} class="btn ${kind === 'in' ? 'btn-dark' : 'btn-coral'} btn-sm">${busy ? 'Getting location…' : kind === 'in' ? 'Check in now' : 'Check out now'}</button>
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
    // The Attendance page tells us when it punches, so the card / popup stay in step.

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
