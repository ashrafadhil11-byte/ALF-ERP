document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('topbar-container');
    if (!container) return;

    container.innerHTML = `
    <header class="flex justify-between items-center w-full mb-10 px-2 pt-2">
        <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-gray-900 text-white rounded-full flex justify-center items-center font-bold text-xl shadow-md tracking-tighter">№</div>
            <div>
                <h2 class="text-xl font-bold text-gray-900 leading-tight">Al-Farha</h2>
                <p class="text-sm text-gray-500">Global Dashboard</p>
            </div>
        </div>
        
        <div class="flex items-center gap-4 lg:gap-6">
            <button class="w-10 h-10 bg-white rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:text-gray-900 transition-colors shadow-sm">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
            </button>
            <div class="flex items-center gap-3 bg-white p-1 pr-4 rounded-full border border-gray-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
                <img src="https://ui-avatars.com/api/?name=Muhammed+Adhil&background=F58220&color=fff" class="w-10 h-10 rounded-full">
                <div class="hidden md:block text-left">
                    <p class="text-sm font-bold text-gray-900 leading-none">Muhammed Adhil</p>
                    <p class="text-[11px] font-semibold text-gray-500 mt-1">SUPER ADMIN</p>
                </div>
            </div>
            
            <div class="relative hidden lg:flex items-center bg-gray-50 rounded-full px-5 py-2.5 border border-gray-100 focus-within:border-gray-300 focus-within:bg-white transition-colors w-64 shadow-inner">
                <svg class="w-4 h-4 text-gray-400 mr-2" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input type="text" placeholder="Start searching here..." class="bg-transparent border-none focus:outline-none focus:ring-0 text-sm text-gray-700 w-full placeholder-gray-400">
            </div>
        </div>
    </header>
    `;
});
