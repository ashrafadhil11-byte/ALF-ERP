// File: admin/components/sidebar.js
// Desktop sidebar: grouped menu that never grows past the screen (the menu scrolls inside the panel).
// Groups fold open / closed; the group of the current page always opens. Sign out stays pinned at the bottom.
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    const currentPage = window.location.pathname.split('/').pop() || 'super-dashboard.html';

    // UI only — the API enforces the same rules server-side.
    const role = localStorage.getItem('cargo_user_role') || 'staff';
    const isAdmin = role === 'super_admin' || role === 'head_office';
    const isWarehouse = localStorage.getItem('cargo_is_warehouse') === '1';

    // Pages already moved to the React app (web/) open there. Keep in step with CONVERTED in web/src/lib/pages.ts.
    const REACT_PAGES = new Set(['activity.html', 'crm.html', 'status-update.html', 'customers.html', 'integrations.html']);
    const link = (page) => REACT_PAGES.has(page) ? '/app/' + page.replace(/\.html$/, '') : page;

    const svg = (d, extra = '') => `<svg class="w-[18px] h-[18px] flex-shrink-0 ${extra}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    const I = {
        home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        ship: '<path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        scan: '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10"/>',
        truck: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
        layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
        users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
        cash: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2m0 8v2"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        warehouse: '<path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-8h10v8M7 17h10"/>',
        building: '<path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M16 9h2a2 2 0 012 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
        staff: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a6 6 0 0112 0v2M19 8v6M22 11h-6"/>',
        link: '<path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"/>',
        pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        chat: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.9-.9L3 21l1.9-5.1a8.4 8.4 0 01-.9-3.9 8.5 8.5 0 019-8.5 8.4 8.4 0 019 8z"/>',
        chev: '<path d="M6 9l6 6 6-6"/>'
    };

    // [label, page, icon, show?]
    const GROUPS = [
        { id: 'top', items: [[isAdmin ? 'Global Overview' : 'Dashboard', 'super-dashboard.html', 'home', true]] },
        { id: 'ops', label: 'Operations', items: [
            ['Shipments & AWB', 'shipments.html', 'ship', true],
            ['New Booking', 'booking.html', 'plus', true],
            ['Scan & Update', 'status-update.html', 'scan', true],
            ['Delivery & POD', 'delivery.html', 'truck', true],
            ['Consolidation & Bulk', 'consolidation.html', 'layers', true]
        ] },
        { id: 'crm', label: 'CRM', items: [
            ['Customers', 'customers.html', 'users', true],
            ['WhatsApp', 'crm.html', 'chat', true]
        ] },
        { id: 'biz', label: 'Money & stock', items: [
            ['Accounts', 'accounts.html', 'cash', role !== 'staff'],
            ['Warehouse', 'warehouse.html', 'warehouse', isWarehouse || isAdmin]
        ] },
        { id: 'team', label: 'Team', items: [
            ['Attendance', 'attendance.html', 'clock', true],
            ['Staff & Users', 'create-user.html', 'staff', isAdmin]
        ] },
        { id: 'admin', label: 'Settings', items: [
            ['Branch Network', 'branches.html', 'building', isAdmin],
            ['Integrations', 'integrations.html', 'link', isAdmin],
            ['Activity Log', 'activity.html', 'pulse', isAdmin]
        ] }
    ].map(g => ({ ...g, items: g.items.filter(i => i[3]) })).filter(g => g.items.length);

    let folded = {};
    try { folded = JSON.parse(localStorage.getItem('alf_nav_folded') || '{}'); } catch (e) { folded = {}; }
    const item = ([label, page, icon]) => {
        const on = currentPage === page;
        return `<a href="${link(page)}" ${on ? 'aria-current="page"' : ''} class="nav-item flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors ${on ? 'bg-[#111827] text-white font-semibold shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50 font-medium'}">
            ${svg(I[icon], on ? 'text-[#E86D58]' : '')}<span class="truncate">${label}</span></a>`;
    };
    const group = (g) => {
        if (!g.label) return `<div class="space-y-0.5">${g.items.map(item).join('')}</div>`;
        const hasCurrent = g.items.some(i => i[1] === currentPage);
        const open = hasCurrent || !folded[g.id];
        return `<div class="nav-group" data-group="${g.id}">
            <button type="button" class="nav-head w-full flex items-center justify-between px-3.5 pt-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-gray-400 hover:text-gray-600" aria-expanded="${open}">
                <span>${g.label}</span>${svg(I.chev, `nav-chev transition-transform ${open ? '' : '-rotate-90'}`)}</button>
            <div class="nav-items space-y-0.5 ${open ? '' : 'hidden'}">${g.items.map(item).join('')}</div></div>`;
    };

    container.innerHTML = `
    <aside class="h-[calc(100dvh-2.5rem)] w-60 bg-white rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.05)] flex flex-col p-4 sticky top-5 border border-gray-100/80">
        <a href="super-dashboard.html" class="flex justify-center items-center py-3 mb-2 flex-shrink-0" aria-label="Home">
            <img src="../assets/LOGO%20BG%20W.svg" alt="Al-Farha Cargo" class="h-9 w-auto object-contain">
        </a>
        <nav class="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-1" aria-label="Main menu">
            ${GROUPS.map(group).join('')}
        </nav>
        <div class="pt-3 mt-2 border-t border-gray-100 flex-shrink-0">
            <button onclick="handleLogout()" class="w-full flex items-center justify-center gap-2 bg-[#FFF5F3] text-[#E86D58] font-semibold text-sm py-2.5 rounded-xl hover:bg-[#FFEAE5] transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                Sign Out
            </button>
        </div>
    </aside>
    `;

    container.querySelectorAll('.nav-head').forEach(btn => btn.addEventListener('click', () => {
        const g = btn.closest('.nav-group');
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        g.querySelector('.nav-items').classList.toggle('hidden', !open);
        g.querySelector('.nav-chev').classList.toggle('-rotate-90', !open);
        folded[g.dataset.group] = !open;
        try { localStorage.setItem('alf_nav_folded', JSON.stringify(folded)); } catch (e) { /* ignore */ }
    }));
    // Keep the current page's link in view when the menu is long.
    container.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });

    // Faster page changes: start loading a page as soon as the pointer rests on its link.
    const done = new Set();
    container.addEventListener('pointerover', (e) => {
        const a = e.target.closest('a.nav-item'); if (!a || done.has(a.href) || a.getAttribute('aria-current')) return;
        done.add(a.href);
        const l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href; document.head.appendChild(l);
    });
});

// Phones / tablets: app-style bottom navigation (hidden on desktop, where the sidebar shows).
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('sidebar-container') || document.getElementById('bottom-nav')) return;
    const page = window.location.pathname.split('/').pop() || 'super-dashboard.html';
    const REACT_PAGES = new Set(['activity.html', 'crm.html', 'status-update.html', 'customers.html', 'integrations.html']);   // see above
    const link = (p) => REACT_PAGES.has(p) ? '/app/' + p.replace(/\.html$/, '') : p;
    const ic = (d) => `<svg class="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const items = [
        { href: 'super-dashboard.html', label: 'Home', d: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
        { href: 'shipments.html', label: 'Shipments', d: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>' },
        { href: 'status-update.html', label: 'Scan', d: '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10"/>', primary: true },
        { href: 'booking.html', label: 'Book', d: '<path d="M12 5v14M5 12h14"/>' },
        { label: 'Menu', d: '<path d="M3 6h18M3 12h18M3 18h18"/>', menu: true }
    ];
    const nav = document.createElement('nav');
    nav.id = 'bottom-nav';
    nav.setAttribute('aria-label', 'Main');
    nav.className = 'lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-gray-100 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.12)]';
    nav.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    nav.innerHTML = `<div class="grid grid-cols-5 max-w-lg mx-auto h-16 items-center">${items.map(it => {
        const active = it.href && it.href.split('?')[0] === page && !it.href.includes('?');
        if (it.primary) {
            return `<a href="${link(it.href)}" class="flex flex-col items-center justify-center gap-0.5 -mt-6" aria-label="${it.label}">
                <span class="w-14 h-14 rounded-full ${active ? 'bg-coral-500' : 'bg-[#111827]'} text-white flex items-center justify-center shadow-lg ring-4 ring-white">${ic(it.d)}</span>
                <span class="text-[10px] font-extrabold ${active ? 'text-coral-500' : 'text-gray-500'}">${it.label}</span></a>`;
        }
        const cls = `flex flex-col items-center justify-center gap-1 h-full text-[10px] font-extrabold ${active ? 'text-coral-500' : 'text-gray-500'}`;
        return it.menu
            ? `<button type="button" onclick="toggleMobileNav(true)" class="${cls}">${ic(it.d)}${it.label}</button>`
            : `<a href="${link(it.href)}" class="${cls}" ${active ? 'aria-current="page"' : ''}>${ic(it.d)}${it.label}</a>`;
    }).join('')}</div>`;
    document.body.appendChild(nav);
    document.body.classList.add('max-lg:pb-24'); // keep content clear of the bar
});

// Phones / tablets: the sidebar slides in as an overlay (menu button in the top bar).
const MOBILE_OPEN = ['fixed', 'inset-0', 'z-[60]', 'p-3', 'bg-gray-900/40', 'backdrop-blur-sm'];
window.toggleMobileNav = function (force) {
    const c = document.getElementById('sidebar-container');
    if (!c) return;
    const open = force ?? c.classList.contains('hidden');
    c.classList.toggle('hidden', !open);
    MOBILE_OPEN.forEach(cls => c.classList.toggle(cls, open));
    document.body.style.overflow = open ? 'hidden' : '';
};
document.addEventListener('click', (e) => {
    const c = document.getElementById('sidebar-container');
    if (c && e.target === c && !c.classList.contains('hidden') && window.innerWidth < 1024) window.toggleMobileNav(false);
});
window.addEventListener('resize', () => {
    const c = document.getElementById('sidebar-container');
    if (window.innerWidth >= 1024 && c && c.classList.contains('fixed')) window.toggleMobileNav(false);
});

window.handleLogout = function() {
    localStorage.removeItem('cargo_auth_token');
    localStorage.removeItem('cargo_user_role');
    localStorage.removeItem('cargo_is_warehouse');
    try { sessionStorage.removeItem('alf_wh_token'); } catch (e) { /* ignore */ }
    window.location.replace('../login.html');
};
