// File: admin/components/ui.js — small helpers shared by the ERP pages.
window.UI = (() => {
    const token = () => localStorage.getItem('cargo_auth_token');
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clean = (v) => String(v || '').trim().replace(/^'/, '').replace(/\s+/g, '').toUpperCase();

    async function api(path, { method = 'GET', body } = {}) {
        const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
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

    const openModal = (id) => { document.getElementById(id).classList.add('open'); };
    const closeModal = (id) => { document.getElementById(id).classList.remove('open'); };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.ui-modal.open').forEach(m => m.classList.remove('open'));
    });
    document.addEventListener('click', (e) => {
        if (e.target.classList?.contains('ui-modal')) e.target.classList.remove('open');
        if (!e.target.closest('[data-menu-root]')) document.querySelectorAll('.row-menu').forEach(m => m.remove());
    });

    /** Styled confirm dialog. Resolves true/false. */
    function confirm({ title, message, confirmText = 'Confirm', danger = false }) {
        return new Promise((resolve) => {
            const m = document.createElement('div');
            m.className = 'ui-modal open';
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

    // ---------- Camera barcode / QR scanning ----------
    // Mark any input with data-camera="submit" (submits its form) or data-camera="click:buttonId";
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
                        if (action.startsWith('click:')) document.getElementById(action.slice(6))?.click();
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
    const boot = () => { paintIcons(); wireCameraInputs(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    return { api, esc, clean, toast, beep, openModal, closeModal, confirm, role, isAdmin, icon, paintIcons, menu, camera, wireCameraInputs };
})();
