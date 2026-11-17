// File: admin/components/checkin.js — check in / out from anywhere in the app.
//  • Dashboard: a "Today" card with the Check in / Check out button (any element with id="checkinCard").
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

    // ---------- dashboard card ----------
    function paintCard() {
        const el = document.getElementById('checkinCard');
        if (!el) return;
        if (!state) { el.innerHTML = ''; return; }
        const r = state.record, s = state.shift;
        const stage = state.on_leave ? 'leave' : !r?.check_in ? 'in' : !r.check_out ? 'out' : 'done';
        const line = stage === 'leave' ? `On ${state.on_leave} leave today`
            : stage === 'in' ? `Not checked in yet · shift ${s.start}–${s.end}`
            : stage === 'out' ? `In since ${hm(r.check_in)}${r.late_min ? ` · ${r.late_min} min late` : ''} · shift ends ${s.end}`
            : `${hm(r.check_in)} – ${hm(r.check_out)} · worked ${hrs(r.worked_min)}`;
        const btn = stage === 'in' || stage === 'out'
            ? `<button type="button" data-punch="${stage}" ${busy ? 'disabled' : ''} class="btn ${stage === 'in' ? 'btn-dark' : 'btn-coral'} !h-11 !px-5 flex-shrink-0">${busy ? 'Getting location…' : stage === 'in' ? 'Check in' : 'Check out'}</button>`
            : `<span class="pill-tag ${stage === 'done' ? 'pill-green' : 'pill-gray'}">${stage === 'done' ? 'Day complete' : 'Leave'}</span>`;
        el.innerHTML = `<div class="flex items-center justify-between gap-3 bg-[#F8F8FA] border border-gray-100 rounded-[1.5rem] pl-3 pr-3 py-2.5 mb-5">
            <div class="flex items-center gap-3 min-w-0">
                <span class="w-10 h-10 rounded-full ${stage === 'out' ? 'bg-emerald-500' : stage === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-[#111827]'} ${stage === 'done' ? '' : 'text-white'} flex items-center justify-center flex-shrink-0">${UI.icon(stage === 'done' ? 'check' : 'clock')}</span>
                <div class="min-w-0"><p class="text-xs font-extrabold">Attendance · ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</p>
                <p class="text-[11px] text-gray-500 truncate">${UI.esc(line)}</p></div>
            </div>
            <div class="flex items-center gap-2">${btn}<a href="attendance.html" class="icon-btn hidden sm:flex" aria-label="Open attendance">${UI.icon('calendar')}</a></div></div>`;
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
        if (p && (p.closest('#checkinCard') || p.closest('#checkinPop'))) return punch(p.dataset.punch);
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
