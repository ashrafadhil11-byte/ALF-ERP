document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    container.innerHTML = `
    <aside class="h-[calc(100vh-2.5rem)] w-64 bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.05)] flex flex-col justify-between p-6 sticky top-5 border border-gray-100/80">
        <div>
            <!-- Centered Logo for White Backgrounds -->
            <div class="mb-10 mt-3 px-2 flex justify-center items-center">
                <img src="../assets/LOGO%20BG%20W.svg" alt="Al-Farha Cargo" class="h-11 w-auto object-contain mx-auto">
            </div>
            
            <!-- Navigation Links -->
            <nav class="space-y-1.5">
                <a href="super-dashboard.html" class="flex items-center gap-3.5 px-4 py-3.5 bg-[#111827] text-white rounded-2xl font-semibold text-sm shadow-sm transition-all">
                    <svg class="w-5 h-5 text-[#E86D58]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                    Global Overview
                </a>
                <a href="#" class="flex items-center justify-between px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium text-sm transition-all">
                    <span class="flex items-center gap-3.5">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                        Shipments & AWB
                    </span>
                    <span class="text-[10px] font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">1.4k</span>
                </a>
                <a href="#" class="flex items-center gap-3.5 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium text-sm transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                    Consolidation & Bulk
                </a>
                <a href="#" class="flex items-center gap-3.5 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium text-sm transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                    Branch Network
                </a>
                <a href="create-user.html" class="flex items-center gap-3.5 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium text-sm transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    Staff & Users
                </a>
                <a href="#" class="flex items-center gap-3.5 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium text-sm transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Branch Financials
                </a>
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

window.handleLogout = function() {
    localStorage.removeItem('cargo_auth_token');
    localStorage.removeItem('cargo_user_role');
    window.location.replace('../login.html');
};
