document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('topbar-container');
    if (!container) return;

    container.innerHTML = `
    <header class="flex justify-between items-center w-full mb-8 px-1">
        <div class="flex items-center gap-3.5">
            <button class="w-11 h-11 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8h16M4 16h10"></path></svg>
            </button>
            <div class="w-11 h-11 bg-[#111827] text-white rounded-full flex justify-center items-center font-extrabold text-sm shadow-sm tracking-tight">AF</div>
            <div>
                <h2 class="text-base font-bold text-gray-900 leading-tight">Executive ERP</h2>
                <p class="text-xs text-gray-400 font-medium">Super Admin Control</p>
            </div>
        </div>
        
        <div class="flex items-center gap-4 lg:gap-5">
            <a href="create-user.html" title="Add Team Member" class="w-10 h-10 bg-gray-50 rounded-full border border-gray-100 flex items-center justify-center text-gray-700 hover:bg-gray-900 hover:text-white transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
            </a>

            <div class="flex items-center gap-3 bg-white p-1 pr-4 rounded-full border border-gray-100 shadow-sm">
                <img src="https://ui-avatars.com/api/?name=Muhammed+Adhil&background=E86D58&color=fff&bold=true" alt="Profile" class="w-9 h-9 rounded-full">
                <div class="hidden md:block text-left">
                    <p class="text-xs font-bold text-gray-900 leading-none">Muhammed Adhil</p>
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
