document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('topbar-container');
    if (!container) return;

    // Extract Full Name from localStorage or Supabase JWT Token
    let fullName = localStorage.getItem('cargo_user_name') || 'Muhammed Adhil';
    try {
        const token = localStorage.getItem('cargo_auth_token');
        if (token) {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(window.atob(base64));
            if (payload?.user_metadata?.full_name) {
                fullName = payload.user_metadata.full_name;
            }
        }
    } catch (e) {
        // Fallback to default if token parsing fails
    }

    const encodedName = encodeURIComponent(fullName);

    container.innerHTML = `
    <header class="flex justify-between items-center w-full mb-8 px-1">
        <!-- Clean Left Title (Removed button before Executive ERP) -->
        <div class="flex items-center">
            <div>
                <h2 class="text-lg font-extrabold text-gray-900 leading-tight tracking-tight">Executive ERP</h2>
                <p class="text-xs text-gray-400 font-medium">Super Admin Control</p>
            </div>
        </div>
        
        <!-- Right Actions & User Profile -->
        <div class="flex items-center gap-4 lg:gap-5">
            <a href="create-user.html" title="Add Team Member" class="w-10 h-10 bg-gray-50 rounded-full border border-gray-100 flex items-center justify-center text-gray-700 hover:bg-gray-900 hover:text-white transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
            </a>

            <div class="flex items-center gap-3 bg-white p-1 pr-4 rounded-full border border-gray-100 shadow-sm">
                <img src="https://ui-avatars.com/api/?name=${encodedName}&background=E86D58&color=fff&bold=true" alt="Profile" class="w-9 h-9 rounded-full">
                <div class="hidden md:block text-left">
                    <p class="text-xs font-bold text-gray-900 leading-none">${fullName}</p>
                    <p class="text-[10px] font-medium text-gray-400 mt-1">Super Admin</p>
                </div>
            </div>
            
            <div class="relative hidden lg:flex items-center bg-[#F8F8FA] rounded-full px-4 py-2.5 border border-gray-100 focus-within:border-gray-300 focus-within:bg-white transition-colors w-64">
                <svg class="w-4 h-4 text-gray-400 mr-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input type="text" placeholder="Search AWB, Branch, Staff..." class="bg-transparent border-none focus:outline-none focus:ring-0 text-xs text-gray-700 w-full placeholder-gray-400">
            </div>
        </div>
    </header>
    `;
});
