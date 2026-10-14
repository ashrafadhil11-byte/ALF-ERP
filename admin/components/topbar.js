// File: admin/components/topbar.js
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('topbar-container');
    if (!container) return;

    let fullName = localStorage.getItem('cargo_user_name') || 'Muhammed Adhil';
    let roleLabel = 'Super Admin';
    try {
        const token = localStorage.getItem('cargo_auth_token');
        if (token) {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(window.atob(base64));
            if (payload?.user_metadata?.full_name) {
                fullName = payload.user_metadata.full_name;
                localStorage.setItem('cargo_user_name', fullName);
            }
            if (payload?.user_metadata?.role) {
                roleLabel = payload.user_metadata.role.replace('_', ' ').toUpperCase();
            }
        }
    } catch (e) {}

    const encodedName = encodeURIComponent(fullName);

    function getGreetingText() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning,';
        if (hour < 17) return 'Good Afternoon,';
        return 'Good Evening,';
    }

    container.innerHTML = `
    <header class="flex flex-col sm:flex-row sm:items-center justify-between w-full mb-6 px-1 gap-4">
        
        <!-- Top-Left: Personalized Greeting & Full Name -->
        <div class="text-left">
            <p class="text-sm lg:text-base font-semibold text-gray-400 tracking-tight leading-snug" id="topbarGreeting">
                ${getGreetingText()}
            </p>
            <h1 class="text-2xl lg:text-[32px] font-extrabold text-gray-900 tracking-tight leading-tight mt-0.5" id="topbarUserFullName">
                ${fullName}
            </h1>
        </div>
        
        <!-- Top-Right: Animated Collapsible Search + Quick Add + Clickable Profile -->
        <div class="flex items-center gap-3 lg:gap-3.5 self-start sm:self-center">
            
            <!-- Animated Collapsible Search Bar -->
            <div id="collapsibleSearchWrapper" 
                 class="relative flex items-center bg-[#F8F8FA] border border-gray-200/70 rounded-full h-11 w-11 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-sm">
                
                <button type="button" onclick="expandTopSearch()" 
                        title="Search ERP (Ctrl+K)"
                        class="w-11 h-11 flex-shrink-0 flex items-center justify-center text-gray-600 hover:text-gray-900 focus:outline-none">
                    <svg class="w-4 h-4 transition-transform duration-300" id="topSearchIcon" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </button>

                <input id="topSearchInput" 
                       type="text" 
                       oninput="handleGlobalSearchInput(this.value)"
                       placeholder="Search AWB, Branch, Staff..." 
                       class="bg-transparent border-none focus:outline-none focus:ring-0 text-xs font-medium text-gray-800 w-full pr-16 opacity-0 pointer-events-none transition-opacity duration-300 placeholder-gray-400">

                <button type="button" id="topSearchClearBtn" onclick="collapseTopSearch(event)" 
                        class="hidden absolute right-2.5 px-2 py-0.5 rounded-full bg-gray-200/70 hover:bg-gray-300 text-[9px] font-extrabold text-gray-600 uppercase tracking-wider transition-colors">
                    ESC
                </button>
            </div>

            <!-- Add Employee Shortcut -->
            <a href="create-user.html" title="Register New Employee" 
               class="w-11 h-11 bg-[#F8F8FA] rounded-full border border-gray-200/70 flex items-center justify-center text-gray-700 hover:bg-[#111827] hover:text-white hover:border-[#111827] transition-all shadow-sm flex-shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path>
                </svg>
            </a>

            <!-- Clickable Profile Pill -->
            <button type="button" onclick="openProfileModal()" 
                    class="group flex items-center gap-3 bg-white hover:bg-[#F8F8FA] p-1.5 pr-4 rounded-full border border-gray-200/80 shadow-sm hover:shadow transition-all cursor-pointer text-left">
                <div class="relative">
                    <img id="topbarProfileAvatar" src="https://ui-avatars.com/api/?name=${encodedName}&background=E86D58&color=fff&bold=true" alt="Profile" class="w-8 h-8 rounded-full object-cover">
                    <span class="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></span>
                </div>
                <div class="hidden md:block">
                    <p id="topbarProfileName" class="text-xs font-extrabold text-gray-900 leading-none group-hover:text-coral-500 transition-colors">${fullName}</p>
                    <p id="topbarProfileRole" class="text-[10px] font-semibold text-gray-400 mt-1 leading-none">${roleLabel}</p>
                </div>
                <svg class="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-700 transition-transform group-hover:translate-x-0.5 hidden md:block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path>
                </svg>
            </button>

        </div>
    </header>
    `;

    // Close collapsible search when clicking outside
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('collapsibleSearchWrapper');
        const input = document.getElementById('topSearchInput');
        if (wrapper && input && !wrapper.contains(e.target) && !input.value.trim()) {
            window.collapseTopSearch();
        }
    });

    // Keyboard shortcut Ctrl+K / Cmd+K or Escape
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            window.expandTopSearch();
        } else if (e.key === 'Escape') {
            window.collapseTopSearch();
        }
    });
});

window.expandTopSearch = function() {
    const wrapper = document.getElementById('collapsibleSearchWrapper');
    const input = document.getElementById('topSearchInput');
    const clearBtn = document.getElementById('topSearchClearBtn');
    const icon = document.getElementById('topSearchIcon');
    if (!wrapper || !input) return;

    wrapper.classList.remove('w-11', 'bg-[#F8F8FA]');
    wrapper.classList.add('w-64', 'sm:w-80', 'bg-white', 'border-gray-300', 'ring-4', 'ring-coral-500/10');
    input.classList.remove('opacity-0', 'pointer-events-none');
    input.classList.add('opacity-100');
    if (clearBtn) clearBtn.classList.remove('hidden');
    if (icon) icon.classList.add('text-coral-500', 'scale-110');

    setTimeout(() => input.focus(), 120);
};

window.collapseTopSearch = function(e) {
    if (e) e.stopPropagation();
    const wrapper = document.getElementById('collapsibleSearchWrapper');
    const input = document.getElementById('topSearchInput');
    const clearBtn = document.getElementById('topSearchClearBtn');
    const icon = document.getElementById('topSearchIcon');
    if (!wrapper || !input) return;

    input.value = '';
    if (typeof window.searchLatestBookings === 'function') {
        window.searchLatestBookings('');
    }
    input.blur();

    wrapper.classList.add('w-11', 'bg-[#F8F8FA]');
    wrapper.classList.remove('w-64', 'sm:w-80', 'bg-white', 'border-gray-300', 'ring-4', 'ring-coral-500/10');
    input.classList.add('opacity-0', 'pointer-events-none');
    input.classList.remove('opacity-100');
    if (clearBtn) clearBtn.classList.add('hidden');
    if (icon) icon.classList.remove('text-coral-500', 'scale-110');
};

window.handleGlobalSearchInput = function(query) {
    if (typeof window.searchLatestBookings === 'function') {
        window.searchLatestBookings(query);
    }
};
