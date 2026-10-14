document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    container.innerHTML = `
    <aside class="h-[calc(100vh-2.5rem)] w-64 bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.05)] flex flex-col justify-between p-6 sticky top-5 border border-gray-100">
        <div>
            <!-- Logo for White Backgrounds -->
            <div class="mb-10 mt-4 px-2">
                <img src="../assets/LOGO%20BG%20W.svg" alt="Al-Farha Cargo" class="h-10 w-auto object-contain">
            </div>
            
            <!-- Navigation Links -->
            <nav class="space-y-2">
                <a href="super-dashboard.html" class="flex items-center gap-3 px-4 py-3.5 bg-gray-900 text-white rounded-2xl font-semibold shadow-md transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                    Dashboard
                </a>
                <a href="#" class="flex items-center gap-3 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
                    Shipments
                </a>
                <a href="#" class="flex items-center gap-3 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                    Branches
                </a>
                <a href="create-user.html" class="flex items-center gap-3 px-4 py-3.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-2xl font-medium transition-all">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                    Users & Roles
                </a>
            </nav>
        </div>
        
        <div class="mt-auto pt-8 border-t border-gray-100">
            <button onclick="handleLogout()" class="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 font-semibold py-3.5 rounded-2xl hover:bg-red-100 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                Sign Out
            </button>
        </div>
    </aside>
    `;
});

// Secure Logout Logic
window.handleLogout = function() {
    localStorage.removeItem('cargo_auth_token');
    localStorage.removeItem('cargo_user_role');
    window.location.replace('../login.html');
};
