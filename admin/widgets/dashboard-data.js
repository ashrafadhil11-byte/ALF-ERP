// File: admin/widgets/dashboard-data.js
// Loads /api/dashboard once (and every 60s), stores it in window.DASH, re-renders widgets.
// Also holds the small helpers every widget uses so they look the same.

window.DASH = null;
window.DASH_BRANCH = (() => { try { return localStorage.getItem('alfarha_dash_branch') || ''; } catch (e) { return ''; } })();

const STAGE_NAMES = ['', 'Booking', 'Pickup', 'Origin', 'Export', 'Transit', 'Destination', 'Last Mile', 'Delivered', 'Review'];

window.dashUI = {
    stageName: (s) => STAGE_NAMES[s] || `Stage ${s}`,
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    num: (v, d = 0) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }),
    kg: (v) => {
        const n = Number(v || 0);
        return n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} Tons` : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} kg`;
    },
    pct: (now, before) => {
        if (!before) return now ? { text: 'New', cls: 'text-emerald-600' } : { text: '—', cls: 'text-gray-400' };
        const p = ((now - before) / before) * 100;
        return { text: `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`, cls: p >= 0 ? 'text-emerald-600' : 'text-coral-500' };
    },
    ago: (iso) => {
        if (!iso) return '—';
        const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m} min ago`;
        if (m < 1440) return `${Math.round(m / 60)} hr ago`;
        return `${Math.round(m / 1440)} d ago`;
    },
    scopeLabel: () => {
        const d = window.DASH;
        if (!d) return '…';
        return d.scope === 'ALL' ? 'All Branches' : d.scope;
    },
    // Card shell used by every widget (same look as the original ERP widgets).
    card: (title, body, { badge = '', dark = false, pad = 'p-6' } = {}) => `
        <div class="h-full ${dark ? 'bg-[#111827] text-white' : 'bg-white'} rounded-[2rem] ${pad} border ${dark ? 'border-gray-800' : 'border-gray-100/80'} flex flex-col gap-3 overflow-hidden">
            <div class="flex flex-wrap justify-between items-center gap-x-2 gap-y-1.5 flex-shrink-0">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="font-extrabold ${dark ? 'text-white' : 'text-gray-900'} tracking-wider text-xs uppercase whitespace-nowrap">${title}</span>
                    <span class="w-2 h-2 rounded-full bg-coral-500 flex-shrink-0"></span>
                </div>
                ${badge ? `<span class="text-[10px] font-semibold ${dark ? 'text-gray-300 bg-gray-800 border-gray-700' : 'text-gray-600 bg-[#F8F8FA] border-gray-100'} px-2.5 py-1 rounded-full border flex-shrink-0">${badge}</span>` : ''}
            </div>
            <div class="flex-1 min-h-0 flex flex-col">${body}</div>
        </div>`,
    loading: () => `<div class="h-full bg-white rounded-[2rem] border border-gray-100/80 flex items-center justify-center"><span class="text-xs font-bold text-gray-300 animate-pulse">Loading live data…</span></div>`,
    empty: (msg) => `<div class="flex-1 flex items-center justify-center text-center px-4"><p class="text-xs text-gray-400 font-medium">${msg}</p></div>`
};

// Wraps a widget render so it shows a loading tile until data arrives.
window.withDash = (fn) => (size) => (window.DASH ? fn(window.DASH, size, window.dashUI) : window.dashUI.loading());

window.loadDashboardData = async function () {
    const token = localStorage.getItem('cargo_auth_token');
    if (!token) return;
    const status = document.getElementById('cloudSyncStatus');
    try {
        const q = window.DASH_BRANCH ? `?branch=${encodeURIComponent(window.DASH_BRANCH)}` : '';
        const res = await fetch(`/api/dashboard${q}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) {
            localStorage.removeItem('cargo_auth_token');
            return window.location.replace('../login.html');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load');
        window.DASH = data;
        window.dispatchEvent(new CustomEvent('dashboard:data', { detail: data }));
        if (typeof window.renderDashboardWidgets === 'function') window.renderDashboardWidgets();
        if (status) { status.textContent = `Live • ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`; status.className = 'text-[10px] font-bold text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-full border border-emerald-100'; }
    } catch (e) {
        if (status) { status.textContent = e.message || 'Offline'; status.className = 'text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100'; }
    }
};

window.setDashboardBranch = function (code) {
    window.DASH_BRANCH = code || '';
    try { localStorage.setItem('alfarha_dash_branch', window.DASH_BRANCH); } catch (e) {}
    window.DASH = null;
    if (typeof window.renderDashboardWidgets === 'function') window.renderDashboardWidgets();
    window.loadDashboardData();
};

document.addEventListener('DOMContentLoaded', () => {
    window.loadDashboardData();
    setInterval(() => { if (!document.hidden) window.loadDashboardData(); }, 60000);
});
