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

    return { api, esc, clean, toast, beep, openModal, closeModal, confirm, role, isAdmin };
})();
