// File: admin/components/ui.js — small helpers shared by the ERP pages.
window.UI = (() => {
    const token = () => localStorage.getItem('cargo_auth_token');
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clean = (v) => String(v || '').trim().replace(/^'/, '').replace(/\s+/g, '').toUpperCase();

    // Identical reads that are already on their way share one request.
    const inflight = new Map();
    function api(path, opts = {}) {
        const m = (opts.method || 'GET').toUpperCase();
        if (m !== 'GET') return request(path, opts);
        const key = path + '|' + JSON.stringify(opts.headers || {});
        if (inflight.has(key)) return inflight.get(key);
        const p = request(path, opts).finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
    }
    async function request(path, { method = 'GET', body, headers = {} } = {}) {
        const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...headers },
            body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 401) {
            localStorage.removeItem('cargo_auth_token');
            location.replace('../login.html');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
        return data;
    }

    function toast(ok, msg) {
        let box = document.getElementById('ui-toast');
        if (!box) { box = document.createElement('div'); box.id = 'ui-toast'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
        const el = document.createElement('div');
        el.className = ok ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-[#FFF5F3] text-[#D55C48] border-[#FFE8E3]';
        el.textContent = msg;
        box.appendChild(el);
        setTimeout(() => el.remove(), ok ? 4500 : 8000);
    }

    function beep(ok) { // scanner feedback
        try { const a = new AudioContext(), o = a.createOscillator(); o.frequency.value = ok ? 880 : 220; o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch (e) {}
    }

    // ---------- unsaved changes ----------
    // Typing or picking something inside a popup (or a form marked data-guard) marks it "dirty".
    // Closing it by clicking outside, pressing Esc, or the ✕ / Cancel button then asks first.
    // Closing after a successful save (code, not a click) never asks.
    const TRACK = /^(INPUT|SELECT|TEXTAREA)$/;
    const tracked = (el) => el && TRACK.test(el.tagName) && !['search', 'button', 'submit', 'hidden', 'reset'].includes(el.type)
        && !el.closest('[data-nodirty]') && !/search|find|filter|scan/i.test(`${el.id || ''} ${el.name || ''} ${el.placeholder || ''}`);
    const markDirty = (e) => {
        if (!e.isTrusted || !tracked(e.target)) return;
        const box = e.target.closest('.ui-modal, [data-guard]');
        if (box) box.dataset.dirty = '1';
    };
    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);
    const isDirty = (el) => el?.dataset?.dirty === '1';
    const unmark = (el) => { if (el) delete el.dataset.dirty; };
    let asking = false;
    /** Ask before throwing away unsaved input. Resolves true when it is fine to close. */
    async function allowClose(el) {
        if (!isDirty(el)) return true;
        if (asking) return false;
        asking = true;
        const ok = await confirm({ title: 'Discard unsaved changes?', message: 'You have entered or changed details here that are not saved yet. If you close now they will be lost.', confirmText: 'Discard', danger: true });
        asking = false;
        if (ok) unmark(el);
        return ok;
    }
    async function dismiss(m) { if (await allowClose(m)) { m.classList.remove('open'); unmark(m); } }

    const openModal = (id) => { const m = document.getElementById(id); unmark(m); m.classList.add('open'); };
    const closeModal = (id, { force = false } = {}) => {
        const m = document.getElementById(id); if (!m) return;
        const ev = window.event;   // set while a click / key handler runs, not after a save finishes
        if (!force && ev && ev.isTrusted && (ev.type === 'click' || ev.type === 'keydown') && isDirty(m)) { dismiss(m); return; }
        m.classList.remove('open'); unmark(m);
    };
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = [...document.querySelectorAll('.ui-modal.open')];
        const top = open[open.length - 1]; if (!top) return;
        if (top.dataset.confirm) { top.querySelector('[data-v="0"]')?.click(); return; }
        dismiss(top);
    });
    document.addEventListener('click', (e) => {
        if (e.target.classList?.contains('ui-modal') && !e.target.dataset.confirm) dismiss(e.target);
        if (!e.target.closest('[data-menu-root]')) document.querySelectorAll('.row-menu').forEach(m => m.remove());
    });
    // Leaving the page (link, back, reload) with an unsaved form on it
    window.addEventListener('beforeunload', (e) => {
        if (document.querySelector('.ui-modal.open[data-dirty="1"], [data-guard][data-dirty="1"]')) { e.preventDefault(); e.returnValue = ''; }
    });

    /** Styled confirm dialog. Resolves true/false. */
    function confirm({ title, message, confirmText = 'Confirm', danger = false }) {
        return new Promise((resolve) => {
            const m = document.createElement('div');
            m.className = 'ui-modal open';
            m.dataset.confirm = '1';
            m.innerHTML = `
                <div class="panel max-w-md" role="dialog" aria-modal="true" aria-labelledby="cfTitle">
                    <h3 id="cfTitle" class="text-lg font-extrabold text-gray-900">${esc(title)}</h3>
                    <p class="text-sm text-gray-500 mt-2 leading-relaxed">${message}</p>
                    <div class="flex justify-end gap-2 mt-6">
                        <button type="button" data-v="0" class="btn btn-light">Cancel</button>
                        <button type="button" data-v="1" class="btn ${danger ? 'btn-coral' : 'btn-dark'}">${esc(confirmText)}</button>
                    </div>
                </div>`;
            const done = (v) => { m.remove(); resolve(v); };
            m.addEventListener('click', (e) => {
                if (e.target === m) return done(false);
                const b = e.target.closest('[data-v]');
                if (b) done(b.dataset.v === '1');
            });
            document.body.appendChild(m);
            m.querySelector('[data-v="1"]').focus();
        });
    }

    const role = () => localStorage.getItem('cargo_user_role') || 'staff';
    const isAdmin = () => ['super_admin', 'head_office'].includes(role());

    // Line icons (24×24, stroke) — same style as the sidebar. Usage: UI.icon('truck', 'w-4 h-4')
    const ICONS = {
        flag: '<path d="M4 22V4M4 4h12l-2 4 2 4H4"/>',
        lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
        fingerprint: '<path d="M12 11v3a8 8 0 01-1 4M8 12a4 4 0 018 0v1M5 13v-1a7 7 0 0114 0v2M16 17v1M12 3a9 9 0 019 9"/>',
        eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/>',
        refresh: '<path d="M21 12a9 9 0 01-15.3 6.4L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0115.3-6.4L21 8"/><path d="M21 3v5h-5"/>',
        message: '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>',
        ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
        trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
        key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2"/><path d="M16 7l3 3"/><path d="M19 4l2 2"/>',
        userCheck: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>',
        userX: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 8l5 5M22 8l-5 5"/>',
        more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
        alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
        x: '<path d="M18 6L6 18M6 6l12 12"/>',
        arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
        arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
        plane: '<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
        ship: '<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0021 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 00-2-2H7a2 2 0 00-2 2v6"/><path d="M12 10v4M12 2v3"/>',
        truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
        box: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
        boxCheck: '<path d="M21 10V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l1-.57"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/><path d="M16 19l2 2 4-4"/>',
        scale: '<path d="M12 3v18M5 21h14"/><path d="M3 7h18"/><path d="M6 7l-3 7a3 3 0 006 0zM18 7l-3 7a3 3 0 006 0z"/>',
        layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
        user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/>',
        pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
        building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
        warehouse: '<path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35a2 2 0 011.26-1.86l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12M6 14h12M6 22V10h12v12"/>',
        stamp: '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0017.5 13h-11A2.5 2.5 0 004 15.5V17a1 1 0 001 1h14a1 1 0 001-1v-1.5c0-.66-.26-1.3-.73-1.77z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 00-6 0c0 2 1 2 1 3.5V13"/>',
        clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><path d="M9 12h6M9 16h6"/>',
        star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
        cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
        link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
        hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
        check: '<path d="M20 6L9 17l-5-5"/>',
        checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
        copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
        menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
        camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
        sparkles: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
        sync: '<path d="M21 12a9 9 0 01-15.3 6.4L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0115.3-6.4L21 8"/><path d="M21 3v5h-5"/>'
    };
    const icon = (name, cls = 'w-4 h-4') =>
        `<svg class="${cls} flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

    /** Opens a floating action menu next to `btn` (never clipped by scrolling tables). */
    function menu(btn, innerHtml) {
        document.querySelectorAll('.row-menu').forEach(m => m.remove());
        const el = document.createElement('div');
        el.className = 'row-menu';
        el.setAttribute('role', 'menu');
        el.setAttribute('data-menu-root', '');
        el.innerHTML = innerHtml;
        document.body.appendChild(el);
        const r = btn.getBoundingClientRect(), h = el.offsetHeight, w = el.offsetWidth;
        const below = r.bottom + 6 + h <= window.innerHeight;
        el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
        el.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
        el.addEventListener('click', (e) => { if (e.target.closest('button, a')) el.remove(); });
    }
    window.addEventListener('scroll', () => document.querySelectorAll('.row-menu').forEach(m => m.remove()), true);
    window.addEventListener('resize', () => document.querySelectorAll('.row-menu').forEach(m => m.remove()));

    // ---------- Searchable dropdown (combobox) ----------
    // UI.combobox(input, { load: async () => [{ value, label, sub?, img? }], allowCustom, onSelect(item|null), placeholder })
    // Returns { reload(), setValue(value), clear() }. Typing filters; ↑ ↓ Enter Esc work; flags via item.img.
    function combobox(input, { load, allowCustom = false, onSelect = () => {}, emptyText = 'No matches' }) {
        let items = [], open = false, active = -1, loaded = false, loading = null;
        const wrap = document.createElement('div');
        wrap.className = 'relative';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('autocomplete', 'off');
        input.classList.add('!pr-10');
        const chev = document.createElement('span');
        chev.className = 'pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#E86D58]';
        chev.innerHTML = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 9l-7 7-7-7"/></svg>';
        wrap.appendChild(chev);
        const img = document.createElement('img');
        img.className = 'hidden absolute left-3.5 top-1/2 -translate-y-1/2 w-[22px] h-4 object-cover rounded-[3px] border border-gray-200';
        img.alt = '';
        wrap.appendChild(img);
        const list = document.createElement('div');
        list.className = 'hidden absolute z-40 left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5 max-h-64 overflow-y-auto custom-scrollbar';
        list.setAttribute('role', 'listbox');
        wrap.appendChild(list);
        let selected = null;

        const showImg = (src) => { img.classList.toggle('hidden', !src); input.classList.toggle('!pl-11', Boolean(src)); if (src) img.src = src; };
        async function ensure() {
            if (loaded) return;
            if (!loading) loading = Promise.resolve(load()).then(r => { items = r || []; loaded = true; }).catch(() => { items = []; loaded = true; });
            await loading;
        }
        const matches = () => {
            const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
            const q = fold(input.value.trim());
            const typed = selected && input.value === selected.label ? '' : q;
            if (!typed) return items.slice(0, 300);
            // Rank: exact name, then name starts with, then word starts with, then contains (label or code)
            const rank = (it) => {
                const l = fold(it.label);
                if (l === typed || fold(it.value) === typed) return 0;
                if (l.startsWith(typed)) return 1;
                if (l.split(/[\s,()-]+/).some(w => w.startsWith(typed))) return 2;
                if (l.includes(typed) || fold(it.sub).includes(typed)) return 3;
                return 9;
            };
            return items.map(it => [rank(it), it]).filter(([r]) => r < 9).sort((x, y) => x[0] - y[0]).map(([, it]) => it).slice(0, 300);
        };
        function render() {
            const m = matches();
            active = Math.min(active, m.length - 1);
            const custom = allowCustom && input.value.trim() && !m.some(it => it.label.toLowerCase() === input.value.trim().toLowerCase());
            list.innerHTML = (loading && !loaded ? '<p class="p-3 text-xs text-gray-400 text-center">Loading…</p>' : '')
                + m.map((it, i) => `<button type="button" role="option" data-i="${i}" aria-selected="${i === active}"
                    class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left ${i === active ? 'bg-[#F8F8FA]' : 'hover:bg-[#F8F8FA]'}">
                    ${it.img ? `<img src="${esc(it.img)}" alt="" class="w-[22px] h-4 object-cover rounded-[3px] border border-gray-200 flex-shrink-0" loading="lazy">` : ''}
                    <span class="flex-1 min-w-0 text-xs font-bold truncate">${esc(it.label)}</span>
                    ${it.sub ? `<span class="text-[10px] font-bold text-gray-400 flex-shrink-0">${esc(it.sub)}</span>` : ''}</button>`).join('')
                + (custom ? `<button type="button" data-custom class="w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold text-[#D55C48] hover:bg-[#FFF5F3]">Use “${esc(input.value.trim())}”</button>` : '')
                + (loaded && !m.length && !custom ? `<p class="p-3 text-xs text-gray-400 text-center">${esc(emptyText)}</p>` : '');
            list._m = m;
        }
        async function show() {
            open = true; list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
            render(); await ensure(); if (open) render();
        }
        function hide() { open = false; list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); active = -1; }
        function choose(it) {
            selected = it;
            input.value = it ? it.label : input.value;
            showImg(it && it.img);
            hide();
            onSelect(it);
        }
        input.addEventListener('focus', show);
        input.addEventListener('click', show);
        input.addEventListener('input', () => { if (selected && input.value !== selected.label) { selected = null; showImg(null); } active = 0; if (!open) show(); else render(); });
        input.addEventListener('keydown', (e) => {
            const m = list._m || [];
            if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); active = Math.min(m.length - 1, active + 1); render(); list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
            else if (e.key === 'Enter' && open) {
                e.preventDefault();
                // List still downloading: wait for it, then take the best match instead of the half-typed text.
                (loaded ? Promise.resolve() : ensure()).then(() => {
                    render();
                    const mm = list._m || [];
                    const pick = mm[Math.max(0, active)];
                    if (pick) choose(pick);
                    else if (allowCustom && input.value.trim()) choose({ value: input.value.trim(), label: input.value.trim(), custom: true });
                });
            }
            else if (e.key === 'Escape') hide();
        });
        list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus while clicking
        list.addEventListener('click', (e) => {
            const b = e.target.closest('[data-i]');
            if (b) return choose(list._m[+b.dataset.i]);
            if (e.target.closest('[data-custom]')) choose({ value: input.value.trim(), label: input.value.trim(), custom: true });
        });
        input.addEventListener('blur', () => setTimeout(async () => {
            if (!open) return;
            if (!loaded) await ensure();
            hide();
            const exact = items.find(it => it.label.toLowerCase() === input.value.trim().toLowerCase());
            if (exact) choose(exact);
            else if (allowCustom && input.value.trim()) { if (!selected || selected.label !== input.value) choose({ value: input.value.trim(), label: input.value.trim(), custom: true }); }
            else if (!selected) { input.value = ''; onSelect(null); }
            else input.value = selected.label;
        }, 120));

        return {
            reload() { loaded = false; loading = null; items = []; },
            preload() { return ensure(); },
            async setValue(value) {
                if (!value) { selected = null; input.value = ''; showImg(null); return; }
                await ensure();
                const v = String(value).toLowerCase();
                const it = items.find(x => String(x.value).toLowerCase() === v || x.label.toLowerCase() === v);
                selected = it || (allowCustom ? { value, label: value, custom: true } : null);
                input.value = selected ? selected.label : '';
                showImg(selected && selected.img);
            },
            clear() { selected = null; input.value = ''; showImg(null); },
            get value() { return selected; }
        };
    }

    // Country → state → city data (countriesnow.space, cached for the session).
    const geoCache = {};
    async function geo(url) {
        if (geoCache[url]) return geoCache[url];
        try { const ss = sessionStorage.getItem('geo:' + url); if (ss) return (geoCache[url] = JSON.parse(ss)); } catch (e) {}
        const r = await fetch(url).then(x => x.json()).catch(() => null);
        const data = r && !r.error ? r.data : null;
        geoCache[url] = data;
        try { if (data) sessionStorage.setItem('geo:' + url, JSON.stringify(data)); } catch (e) {}
        return data;
    }
    const GEO = 'https://countriesnow.space/api/v0.1/countries';
    // Oman uses the built-in list (components/oman-places.js → window.ALF_OMAN): governorates → wilayats/towns with postal codes.
    const omanGov = (state) => (window.ALF_OMAN || []).find(g => g.name.toLowerCase() === String(state || '').replace(/ Governorate$/i, '').toLowerCase());
    const statesOf = async (iso2) => {
        if (iso2 === 'OM' && window.ALF_OMAN) return window.ALF_OMAN.map(g => ({ value: g.name, label: g.name, sub: `${g.wilayats.length} wilayats` }));
        return ((await geo(`${GEO}/states/q?iso2=${encodeURIComponent(iso2)}`))?.states || [])
            .map(s => ({ value: s.name, label: s.name.replace(/ (Governorate|Region|Province|District)$/i, ''), sub: s.state_code || '' }));
    };
    const citiesOf = async (countryName, state) => {
        if (countryName === 'Oman' && window.ALF_OMAN) {
            const g = omanGov(state);
            if (g) return g.wilayats.flatMap(w => w.towns.map(t => ({
                value: t.name, label: t.name, sub: [t.name !== w.name && w.name, t.code].filter(Boolean).join(' · '),
                postalCode: t.code, wilayat: w.name
            })));
        }
        return ((await geo(`${GEO}/state/cities/q?country=${encodeURIComponent(countryName)}&state=${encodeURIComponent(state)}`)) || [])
            .map(c => ({ value: c, label: c }));
    };
    const countryItems = () => (window.ALF_COUNTRIES || []).map(c => ({ value: c.c, label: c.n, sub: `${c.c} · ${c.d}`, img: `https://flagcdn.com/w40/${c.c.toLowerCase()}.png`, dial: c.d }));

    // ---------- WhatsApp: one dedicated window, reused for every chat ----------
    // WhatsApp Web cannot be shown inside another site (it blocks embedding), so the ERP keeps a single
    // WhatsApp window docked to the right of the screen and sends every "chat" to it.
    let waWin = null;
    const whatsappOpen = () => Boolean(waWin && !waWin.closed);
    function whatsapp(phone, text) {
        const digits = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
        const url = digits ? `https://web.whatsapp.com/send?phone=${digits}${text ? `&text=${encodeURIComponent(text)}` : ''}` : 'https://web.whatsapp.com/';
        const w = Math.min(980, Math.round(screen.availWidth * 0.5)), h = screen.availHeight;
        const left = (screen.availLeft || 0) + screen.availWidth - w, top = screen.availTop || 0;
        if (!whatsappOpen() || digits) waWin = window.open(url, 'alf_whatsapp', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
        if (!waWin) { toast(false, 'Allow pop-ups for this site to open WhatsApp.'); return null; }
        try { waWin.focus(); } catch (e) { /* ignore */ }
        return waWin;
    }

    // ---------- automatic phone / country / city fields ----------
    // <input data-phone="OM">            → country-code picker (read the full number with UI.phoneValue(input))
    // <input data-country>               → country list with flags (stores the country name; the code in input.dataset.cc)
    // <input data-city-of="countryInputId"> → cities of the chosen country (typing a new one is allowed)
    const citiesOfCountry = async (countryName) => {
        if (!countryName) return [];
        if (countryName === 'Oman' && window.ALF_OMAN) {
            return window.ALF_OMAN.flatMap(g => g.wilayats.flatMap(w => w.towns.map(t => ({ value: t.name, label: t.name, sub: [w.name !== t.name && w.name, g.name, t.code].filter(Boolean).join(' · '), postalCode: t.code }))));
        }
        return ((await geo(`${GEO}/cities/q?country=${encodeURIComponent(countryName)}`)) || []).map(c => ({ value: c, label: c }));
    };
    const phoneValue = (el) => (el && el._phone ? el._phone.value : String(el?.value || '').trim());
    function autoFields(root = document) {
        root.querySelectorAll('input[data-phone]:not([data-auto])').forEach((input) => {
            input.setAttribute('data-auto', '');
            const start = input.value;
            input.value = '';
            input._phone = phoneField(input, { country: input.dataset.phone || 'OM' });
            if (start) input._phone.setValue(start, input.dataset.phone || 'OM');
        });
        root.querySelectorAll('input[data-country]:not([data-auto])').forEach((input) => {
            input.setAttribute('data-auto', '');
            const box = combobox(input, {
                load: () => countryItems(), allowCustom: true,
                onSelect: (it) => {
                    input.dataset.cc = it?.value || '';
                    document.querySelectorAll(`input[data-city-of="${input.id}"]`).forEach(c => { c._box?.reload(); });
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            const c = (window.ALF_COUNTRIES || []).find(x => x.n.toLowerCase() === input.value.trim().toLowerCase());
            if (c) { input.dataset.cc = c.c; box.setValue?.(c.c); }
        });
        root.querySelectorAll('input[data-city-of]:not([data-auto])').forEach((input) => {
            input.setAttribute('data-auto', '');
            input._box = combobox(input, {
                load: () => citiesOfCountry(document.getElementById(input.dataset.cityOf)?.value.trim()),
                allowCustom: true, emptyText: 'Pick the country first, or type the city'
            });
        });
    }
    // forms that are drawn later (popups built in code) are picked up automatically
    new MutationObserver((list) => {
        if (list.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('input[data-phone],input[data-country],input[data-city-of]') || n.querySelector?.('input[data-phone],input[data-country],input[data-city-of]'))))) autoFields();
    }).observe(document.documentElement, { childList: true, subtree: true });

    // ---------- Camera barcode / QR scanning ----------
    // Mark any input with data-camera="submit" (submits its form), data-camera="click:buttonId" or data-camera="fill" (just fills it);
    // add data-camera-continuous to keep scanning (batch). A camera button appears inside the input.
    const SCANNER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
    let scannerLib;
    const loadScanner = () => scannerLib || (scannerLib = new Promise((ok, fail) => {
        if (window.Html5Qrcode) return ok();
        const s = document.createElement('script');
        s.src = SCANNER_SRC; s.onload = ok; s.onerror = () => { scannerLib = null; fail(new Error('Could not load the scanner. Check your connection.')); };
        document.head.appendChild(s);
    }));

    async function camera({ title = 'Scan barcode', continuous = false, onScan }) {
        const m = document.createElement('div');
        m.className = 'ui-modal open';
        m.innerHTML = `
            <div class="panel max-w-md !p-5" role="dialog" aria-modal="true" aria-label="${esc(title)}">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-2"><span class="w-8 h-8 rounded-full bg-[#111827] text-white flex items-center justify-center">${icon('camera')}</span>
                        <div><p class="text-sm font-extrabold">${esc(title)}</p><p data-hint class="text-[11px] text-gray-400">${continuous ? 'Keep scanning — each code is added' : 'Point the camera at the barcode'}</p></div></div>
                    <button type="button" data-close class="icon-btn bg-[#F8F8FA]" aria-label="Close camera">${icon('x')}</button>
                </div>
                <div class="relative rounded-[1.5rem] overflow-hidden bg-black aspect-[4/3]"><div id="ui-cam-reader" class="w-full h-full"></div>
                    <p data-status class="absolute inset-0 flex items-center justify-center px-8 text-center text-xs font-bold text-white/80 leading-relaxed">Starting camera…</p></div>
                ${continuous ? '<div data-log class="flex flex-wrap gap-1.5 mt-3 min-h-[26px]"></div>' : ''}
                <button type="button" data-close class="btn btn-dark w-full mt-4">${continuous ? 'Done' : 'Cancel'}</button>
            </div>`;
        document.body.appendChild(m);
        let scanner = null, last = '', lastAt = 0, closed = false;
        const close = async () => {
            if (closed) return; closed = true;
            try { if (scanner && scanner.isScanning) await scanner.stop(); } catch (e) {}
            m.remove();
        };
        m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
        try {
            await loadScanner();
            if (closed) return;
            scanner = new window.Html5Qrcode('ui-cam-reader', { verbose: false });
            await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.round(w * 0.8), height: Math.round(h * 0.45) }) },
                (text) => {
                    const code = String(text).trim();
                    if (!code || (code === last && Date.now() - lastAt < 2500)) return; // ignore the same code held in view
                    last = code; lastAt = Date.now();
                    beep(true);
                    if (navigator.vibrate) navigator.vibrate(60);
                    onScan(code);
                    if (continuous) m.querySelector('[data-log]').insertAdjacentHTML('afterbegin', `<span class="pill-tag pill-dark">${esc(code)}</span>`);
                    else close();
                }, () => {});
            m.querySelector('[data-status]').remove();
        } catch (err) {
            const msg = /permission|notallowed/i.test(String(err)) ? 'Camera permission was denied. Allow camera access for this site and try again.'
                : /notfound|no camera|devices/i.test(String(err)) ? 'No camera found on this device.' : (err.message || String(err));
            m.querySelector('[data-status]').textContent = msg;
        }
    }

    function wireCameraInputs(root = document) {
        root.querySelectorAll('input[data-camera]:not([data-camera-ready])').forEach((input) => {
            input.setAttribute('data-camera-ready', '');
            const wrap = document.createElement('div');
            wrap.className = 'relative flex-1 min-w-0';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
            input.classList.add('!pr-14');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center hover:bg-[#E86D58] transition-colors';
            btn.setAttribute('aria-label', 'Scan with camera');
            btn.title = 'Scan with camera';
            btn.innerHTML = icon('camera', 'w-[18px] h-[18px]');
            btn.addEventListener('click', () => {
                const action = input.dataset.camera || 'submit';
                camera({
                    title: input.getAttribute('aria-label') ? `Scan ${input.getAttribute('aria-label')}` : 'Scan barcode',
                    continuous: input.hasAttribute('data-camera-continuous'),
                    onScan: (code) => {
                        input.value = code;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        if (action === 'fill') { beep(true); input.focus(); }
                        else if (action.startsWith('click:')) document.getElementById(action.slice(6))?.click();
                        else if (input.form) input.form.requestSubmit();
                    }
                });
            });
            wrap.appendChild(btn);
        });
    }

    // <span data-icon="truck" data-cls="w-5 h-5"></span> in static HTML → SVG
    const paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => {
        el.outerHTML = icon(el.dataset.icon, el.dataset.cls || 'w-4 h-4') ;
    });
    const boot = () => { paintIcons(); wireCameraInputs(); autoFields(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    /**
     * Postcode / ZIP / PIN / Saudi short-address lookup on an input. Calls /api/postal-lookup (providers in connectors.js).
     *   UI.postalLookup(input, listEl, badgeEl, { country: () => 'GB', onPick: (place) => {...} })
     */
    function postalLookup(input, list, badge, { country, onPick }) {
        let timer, seq = 0, found = [];
        const hide = () => list.classList.add('hidden');
        const setBadge = (t) => { if (badge) badge.textContent = t; };
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const code = input.value.trim(), cc = country();
            if (code.length < 3 || !cc) { hide(); setBadge('Lookup'); return; }
            if (cc === 'SA' && /^[a-z]/i.test(code)) input.value = input.value.toUpperCase();
            timer = setTimeout(async () => {
                const mine = ++seq;
                setBadge('Searching…');
                let j = {};
                // Oman: answered from the built-in list (code or place name), no server round trip.
                if (cc === 'OM' && window.ALF_OMAN_SEARCH) j = { locations: window.ALF_OMAN_SEARCH(code) };
                else try { j = await api(`/api/postal-lookup?code=${encodeURIComponent(code)}&countryCode=${encodeURIComponent(cc)}`); } catch (e) { j = { errors: [e.message] }; }
                if (mine !== seq) return; // a newer search is running
                found = j.locations || [];
                setBadge(found.length ? `${found.length} found` : 'No match');
                const keyHint = (j.errors || []).find(e => /Missing api_key|HTTP 401|HTTP 403/i.test(e));
                list.innerHTML = found.length ? found.map((l, i) => `
                    <button type="button" data-i="${i}" class="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F8F8FA] text-left">
                        <span class="min-w-0"><span class="block text-xs font-extrabold truncate">${esc([l.building, l.street, l.postOffice].filter(Boolean).join(' · ') || l.city)}</span>
                        <span class="block text-[10px] text-gray-400 truncate">${esc([l.wilayat || l.city, l.state].filter(Boolean).join(', '))}</span></span>
                        <span class="pill-tag pill-coral font-mono flex-shrink-0">${esc(l.shortAddress || l.postalCode || '')}</span></button>`).join('')
                    : `<p class="p-3 text-xs text-gray-400 text-center">${keyHint ? `No match. ${esc(keyHint)}` :`Nothing found for "${esc(code)}" — type the address manually.`}</p>`;
                list.classList.remove('hidden');
            }, 400);
        });
        list.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-i]');
            if (!b) return;
            hide();
            onPick(found[+b.dataset.i]);
        });
        document.addEventListener('click', (e) => { if (!list.contains(e.target) && e.target !== input) hide(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    }

    // ---------- Phone numbers with their own country code ----------
    // The phone's country is independent of the address (an Oman shipper can have an Indian mobile).
    const DIAL_PREF = { '+1': 'US', '+44': 'GB', '+7': 'RU', '+61': 'AU', '+39': 'IT', '+47': 'NO', '+358': 'FI', '+212': 'MA', '+262': 'RE', '+590': 'GP', '+599': 'CW', '+290': 'SH' };
    const flagUrl = (cc) => `https://flagcdn.com/w40/${String(cc).toLowerCase()}.png`;

    /** '+91 98765 43210' / '0091…' → { cc: 'IN', dial: '+91', national: '9876543210' }; no prefix → { cc: null, national } */
    function splitPhone(full, prefer) {
        const s = String(full || '').trim().replace(/^00/, '+');
        if (!s.startsWith('+')) return { cc: null, dial: null, national: s.replace(/[^\d]/g, '') };
        const digits = s.replace(/[^\d]/g, ''), C = window.ALF_COUNTRIES || [];
        for (let n = 4; n >= 1; n--) {
            const dial = '+' + digits.slice(0, n), hits = C.filter(c => c.d === dial);
            if (hits.length) return { cc: (hits.find(c => c.c === prefer) || hits.find(c => c.c === DIAL_PREF[dial]) || hits[0]).c, dial, national: digits.slice(n) };
        }
        return { cc: null, dial: null, national: digits };
    }

    /**
     * Turns a tel input into [flag +code ▾][number].
     *   const ph = UI.phoneField(input, { country: 'OM' });
     *   ph.value → '+91 9876543210' ('' when empty) · ph.valid · ph.setValue('+968 9123…') · ph.setCountry('IN', { soft: true })
     * soft = only if the user hasn't picked a code themselves (used to follow the branch / destination country).
     */
    function phoneField(input, { country = 'OM', onChange = () => {} } = {}) {
        const C = window.ALF_COUNTRIES || [];
        let cc = country, touched = false;
        const wrap = document.createElement('div');
        wrap.className = 'relative flex gap-2';
        input.parentNode.insertBefore(wrap, input);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'field soft !w-auto flex items-center gap-1.5 !px-3 flex-shrink-0';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.innerHTML = `<img alt="" class="w-[22px] h-4 object-cover rounded-[3px] border border-gray-200"><span class="text-xs font-extrabold tabular-nums"></span>
            <svg class="w-3 h-3 text-[#E86D58]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 9l-7 7-7-7"/></svg>`;
        wrap.appendChild(btn);
        wrap.appendChild(input);
        input.type = 'tel'; input.inputMode = 'tel'; input.autocomplete = 'off';
        const pop = document.createElement('div');
        pop.className = 'hidden absolute z-40 left-0 top-full mt-1.5 w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5';
        pop.innerHTML = `<input class="field !py-2 text-xs mb-1" placeholder="Search country or code" aria-label="Search country code">
            <div role="listbox" class="max-h-60 overflow-y-auto custom-scrollbar"></div>`;
        wrap.appendChild(pop);
        const search = pop.querySelector('input'), list = pop.querySelector('[role=listbox]');
        const dialOf = (c) => (C.find(x => x.c === c) || {}).d || '+';

        function paint() {
            const c = C.find(x => x.c === cc);
            btn.querySelector('img').src = c ? flagUrl(cc) : '';
            btn.querySelector('img').classList.toggle('hidden', !c);
            btn.querySelector('span').textContent = dialOf(cc);
            btn.title = c ? `${c.n} ${c.d}` : 'Choose country code';
        }
        function set(newCc, byUser) {
            if (!newCc) return;
            if (byUser) touched = true;
            if (newCc !== cc) { cc = newCc; paint(); onChange(api_); }
        }
        function renderList() {
            const q = search.value.trim().toLowerCase().replace(/^00/, '+');
            const dq = '+' + q.replace(/\D/g, '');
            const m = C.filter(c => !q || c.n.toLowerCase().includes(q) || c.c.toLowerCase() === q || (dq.length > 1 && c.d.startsWith(dq)))
                // exact code first, the main country for shared codes (+1 US, +44 UK) on top
                .map(c => [c.d === dq ? (DIAL_PREF[c.d] === c.c ? 0 : 1) : c.n.toLowerCase().startsWith(q) ? 1 : 2, c])
                .sort((a, b) => a[0] - b[0]).map(([, c]) => c);
            list.innerHTML = m.slice(0, 250).map(c => `<button type="button" role="option" data-cc="${c.c}" aria-selected="${c.c === cc}"
                class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-[#F8F8FA] ${c.c === cc ? 'bg-[#FFF5F3]' : ''}">
                <img src="${flagUrl(c.c)}" alt="" loading="lazy" class="w-[22px] h-4 object-cover rounded-[3px] border border-gray-200 flex-shrink-0">
                <span class="flex-1 min-w-0 text-xs font-bold truncate">${esc(c.n)}</span><span class="text-[11px] font-extrabold text-gray-500 tabular-nums">${esc(c.d)}</span></button>`).join('')
                || '<p class="p-3 text-xs text-gray-400 text-center">No match</p>';
        }
        const close = () => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
        btn.onclick = () => {
            if (!pop.classList.contains('hidden')) return close();
            search.value = ''; renderList(); pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');
            search.focus();
            list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'center' });
        };
        search.oninput = renderList;
        search.onkeydown = (e) => {
            if (e.key === 'Escape') { close(); btn.focus(); }
            if (e.key === 'Enter') { e.preventDefault(); list.querySelector('[data-cc]')?.click(); }
        };
        list.onclick = (e) => { const b = e.target.closest('[data-cc]'); if (!b) return; set(b.dataset.cc, true); close(); input.focus(); };
        document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });

        // Typing / pasting a number with +code or 00code switches the country and keeps only the local part
        input.addEventListener('input', () => {
            const v = input.value.trim();
            if (/^(\+|00)\d{1,4}/.test(v)) {
                const p = splitPhone(v, cc);
                if (p.cc && (p.national.length >= 4 || v.includes(' '))) { set(p.cc, true); input.value = p.national; }
            }
            input.classList.remove('!border-[#E86D58]');
        });
        input.addEventListener('blur', () => input.classList.toggle('!border-[#E86D58]', Boolean(input.value.trim()) && !api_.valid));

        const national = () => {
            let n = input.value.replace(/\D/g, '');
            if (cc !== 'IT') n = n.replace(/^0+/, ''); // drop trunk 0 (07911… → +44 7911…)
            return n;
        };
        const api_ = {
            get value() { const n = national(); return n ? `${dialOf(cc)} ${n}` : ''; },
            get valid() { const n = national(); return !n || (n.length >= 6 && n.length <= 14); },
            get country() { return cc; },
            setCountry(newCc, { soft = false } = {}) { if (soft && touched) return; set(newCc, false); },
            setValue(full, fallbackCc) {
                const p = splitPhone(full, fallbackCc || cc);
                touched = Boolean(p.cc);
                if (p.cc) { cc = p.cc; paint(); } else if (fallbackCc) { cc = fallbackCc; paint(); }
                input.value = p.national;
            },
            reset(newCc) { touched = false; input.value = ''; if (newCc) { cc = newCc; paint(); } }
        };
        paint();
        return api_;
    }

    /**
     * Which boxes of a shipment? Shows every box ticked; staff untick the ones not here.
     *   const r = await UI.pickBoxes('311000041', { title: 'Add to MAWB' })
     *   → { awb, pieces: null (all boxes) | [1,2], total }   or null when cancelled / not found
     * One-box shipments return straight away without asking.
     */
    async function pickBoxes(awb, { title = 'Which boxes?', confirmText = 'Continue', only = null } = {}) {
        let d;
        try { d = await api(`/api/status?boxes=${encodeURIComponent(awb)}`); } catch (e) { toast(false, e.message); return null; }
        d.boxes = d.boxes || [];
        const boxes = only ? d.boxes.filter(b => only.includes(b.piece_no)) : d.boxes;
        if (boxes.length <= 1) return { awb: d.booking.awb, pieces: only && boxes.length ? boxes.map(b => b.piece_no) : null, total: d.boxes.length };
        return new Promise((resolve) => {
            const m = document.createElement('div');
            m.className = 'ui-modal open';
            const dims = (b) => b.l && b.w && b.h ? `${+b.l}×${+b.w}×${+b.h} cm` : '';
            m.innerHTML = `
                <div class="panel max-w-md" role="dialog" aria-modal="true" aria-labelledby="pbTitle">
                    <div class="flex items-start justify-between gap-3"><div>
                        <h3 id="pbTitle" class="text-lg font-extrabold">${esc(title)}</h3>
                        <p class="text-xs text-gray-500 mt-0.5"><b class="font-mono">${esc(d.booking.awb)}</b> · ${esc(d.booking.consignee || '')} · ${d.boxes.length} boxes. Untick boxes that are not here.</p></div>
                        <span class="pill-tag pill-dark" data-count></span></div>
                    <div class="flex gap-2 mt-4"><button type="button" class="btn btn-light btn-sm" data-all>All</button><button type="button" class="btn btn-light btn-sm" data-none>None</button></div>
                    <div class="mt-3 space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">${boxes.map(b => `
                        <label class="flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-4 py-2.5 cursor-pointer has-[:checked]:bg-[#FFF5F3] has-[:checked]:ring-1 has-[:checked]:ring-[#FFD0C7]">
                            <input type="checkbox" class="w-4 h-4 accent-[#E86D58]" value="${b.piece_no}" checked>
                            <span class="font-extrabold text-sm w-16">Box ${b.piece_no}</span>
                            <span class="text-[11px] text-gray-500 flex-1">${b.weight ? `${+b.weight} kg` : ''} ${dims(b)}</span>
                            <span class="text-[10px] font-bold text-gray-400 text-right">${esc(b.status || '')}</span></label>`).join('')}</div>
                    <div class="flex justify-end gap-2 mt-5"><button type="button" class="btn btn-light" data-cancel>Cancel</button><button type="button" class="btn btn-dark" data-ok>${esc(confirmText)}</button></div>
                </div>`;
            const ticks = () => [...m.querySelectorAll('input[type=checkbox]')];
            const count = () => { const n = ticks().filter(x => x.checked).length; m.querySelector('[data-count]').textContent = `${n} of ${boxes.length}`; m.querySelector('[data-ok]').disabled = !n; };
            const done = (v) => { m.remove(); resolve(v); };
            m.addEventListener('change', count);
            m.querySelector('[data-all]').onclick = () => { ticks().forEach(x => x.checked = true); count(); };
            m.querySelector('[data-none]').onclick = () => { ticks().forEach(x => x.checked = false); count(); };
            m.querySelector('[data-cancel]').onclick = () => done(null);
            m.addEventListener('click', (e) => { if (e.target === m) done(null); });
            m.querySelector('[data-ok]').onclick = () => {
                const sel = ticks().filter(x => x.checked).map(x => +x.value);
                done({ awb: d.booking.awb, pieces: sel.length === d.boxes.length ? null : sel, total: d.boxes.length });
            };
            document.body.appendChild(m); count();
            m.querySelector('[data-ok]').focus();
        });
    }

    return { whatsapp, whatsappOpen, autoFields, phoneValue, citiesOfCountry, allowClose, markClean: unmark, api, esc, clean, toast, beep, openModal, closeModal, confirm, role, isAdmin, icon, paintIcons, menu, camera, wireCameraInputs, combobox, statesOf, citiesOf, countryItems, postalLookup, phoneField, splitPhone, pickBoxes };
})();

// Smooth page switches for browsers without cross-document view transitions (see ui.css "Motion").
(() => {
    if (window.CSS?.supports?.('view-transition-name: none')) return;
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download')) return;
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin || url.pathname === location.pathname || !/\.html$|\/$/.test(url.pathname)) return;
        document.documentElement.classList.add('page-leaving');
    });
    window.addEventListener('pageshow', () => document.documentElement.classList.remove('page-leaving'));
})();
