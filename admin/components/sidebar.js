// File: admin/components/sidebar.js
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    const currentPage = window.location.pathname.split('/').pop() || 'super-dashboard.html';

    const navItemClass = (page) => {
        const isActive = currentPage === page;
        return isActive
            ? 'flex items-center gap-3.5 px-4 py-3.5 bg-[#111827] text-white rounded-2xl font-semibold text-sm shadow-sm transition-all'
            : 'flex items-center gap-3.5 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium text-sm transition-all';
    };

    // UI only — the API enforces the same rules server-side.
    const role = localStorage.getItem('cargo_user_role') || 'staff';
    const isAdmin = role === 'super_admin' || role === 'head_office';
    const onlyIf = (cond, html) => (cond ? html : '');

    const iconClass = (page) => currentPage === page ? 'w-5 h-5 text-[#E86D58]' : 'w-5 h-5';

    container.innerHTML = `
    <aside class="h-[calc(100vh-2.5rem)] w-64 bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.05)] flex flex-col justify-between p-6 sticky top-5 border border-gray-100/80">
        <div>
            <!-- Centered Logo for White Backgrounds -->
            <div class="mb-10 mt-3 px-2 flex justify-center items-center">
                <img src="../assets/LOGO%20BG%20W.svg" alt="Al-Farha Cargo" class="h-11 w-auto object-contain mx-auto">
            </div>
            
            <!-- Navigation Links -->
            <nav class="space-y-1.5">
                <a href="super-dashboard.html" class="${navItemClass('super-dashboard.html')}">
                    <svg class="${iconClass('super-dashboard.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                    ${isAdmin ? 'Global Overview' : 'Dashboard'}
                </a>
                <a href="shipments.html" class="${navItemClass('shipments.html')} justify-between">
                    <span class="flex items-center gap-3.5">
                        <svg class="${iconClass('shipments.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                        Shipments & AWB
                    </span>
                </a>
                <a href="customers.html" class="${navItemClass('customers.html')}">
                    <svg class="${iconClass('customers.html')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
                    Customers
                </a>
                <a href="booking.html" class="${navItemClass('booking.html')}">
                    <svg class="${iconClass('booking.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    New Booking
                </a>
                <a href="status-update.html" class="${navItemClass('status-update.html')}">
                    <svg class="${iconClass('status-update.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path></svg>
                    Scan & Update
                </a>
                <a href="delivery.html" class="${navItemClass('delivery.html')}">
                    <svg class="${iconClass('delivery.html')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Delivery & POD
                </a>
                <a href="consolidation.html" class="${navItemClass('consolidation.html')}">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                    Consolidation & Bulk
                </a>
                ${onlyIf(isAdmin, `<a href="branches.html" class="${navItemClass('branches.html')}">
                    <svg class="${iconClass('branches.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                    Branch Network
                </a>
                <a href="create-user.html" class="${navItemClass('create-user.html')}">
                    <svg class="${iconClass('create-user.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    Staff & Users
                </a>
                <a href="integrations.html" class="${navItemClass('integrations.html')}">
                    <svg class="${iconClass('integrations.html')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                    Integrations
                </a>`)}
                ${onlyIf(role !== 'staff', `<a href="accounts.html" class="${navItemClass('accounts.html')}">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Accounts
                </a>`)}
                <div class="flex items-center justify-between gap-3.5 px-4 py-3.5 text-gray-400 rounded-2xl font-medium text-sm cursor-default" title="Reserved for AI features — coming later">
                    <span class="flex items-center gap-3.5">
                        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>
                        AI Assistant
                    </span>
                    <span class="text-[9px] font-extrabold uppercase bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Soon</span>
                </div>
            </nav>
        </div>
        
        <div class="mt-auto pt-6 border-t border-gray-100">
            <button onclick="handleLogout()" class="w-full flex items-center justify-center gap-2 bg-[#FFF5F3] text-[#E86D58] font-semibold text-sm py-3.5 rounded-2xl hover:bg-[#FFEAE5] transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                Sign Out
            </button>
        </div>
    </aside>
    `;
});

// Phones / tablets: app-style bottom navigation (hidden on desktop, where the sidebar shows).
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('sidebar-container') || document.getElementById('bottom-nav')) return;
    const page = window.location.pathname.split('/').pop() || 'super-dashboard.html';
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
            return `<a href="${it.href}" class="flex flex-col items-center justify-center gap-0.5 -mt-6" aria-label="${it.label}">
                <span class="w-14 h-14 rounded-full ${active ? 'bg-coral-500' : 'bg-[#111827]'} text-white flex items-center justify-center shadow-lg ring-4 ring-white">${ic(it.d)}</span>
                <span class="text-[10px] font-extrabold ${active ? 'text-coral-500' : 'text-gray-500'}">${it.label}</span></a>`;
        }
        const cls = `flex flex-col items-center justify-center gap-1 h-full text-[10px] font-extrabold ${active ? 'text-coral-500' : 'text-gray-500'}`;
        return it.menu
            ? `<button type="button" onclick="toggleMobileNav(true)" class="${cls}">${ic(it.d)}${it.label}</button>`
            : `<a href="${it.href}" class="${cls}" ${active ? 'aria-current="page"' : ''}>${ic(it.d)}${it.label}</a>`;
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
    window.location.replace('../login.html');
};
