// File: admin/components/topbar.js
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
                localStorage.setItem('cargo_user_name', fullName);
            }
        }
    } catch (e) {}

    const encodedName = encodeURIComponent(fullName);

    function getGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning,';
        if (hour < 17) return 'Good Afternoon,';
        return 'Good Evening,';
    }

    container.innerHTML = `
    <header class="flex flex-col xl:flex-row xl:items-center justify-between w-full mb-7 pb-6 border-b border-gray-100 gap-5">
        
        <!-- Top-Left: Greeting + Full Name + Super Admin Portal Badge -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
            <div>
                <div class="flex items-center gap-3">
                    <p class="text-sm lg:text-base font-semibold text-gray-400 tracking-tight" id="topbarGreeting">
                        ${getGreeting()}
                    </p>
                    <!-- Super Admin Portal Pill -->
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#111827] text-white shadow-sm">
                        <span class="w-1.5 h-1.5 rounded-full bg-coral-500"></span>
                        Super Admin Portal
                    </span>
                </div>
                <h1 class="text-2xl lg:text-3xl font-extrabold text-gray-900 tracking-tight leading-tight mt-0.5" id="topbarUserName">
                    ${fullName}
                </h1>
            </div>
        </div>
        
        <!-- Top-Right: Date & Time + Widget Controls + Search + Profile -->
        <div class="flex flex-wrap items-center gap-3 self-start xl:self-center">
            
            <!-- Live Time & Date Pill -->
            <div class="flex items-center gap-4 bg-[#F8F8FA] px-4 py-2 rounded-full border border-gray-100">
                <div class="text-right pr-3.5 border-r border-gray-200/80">
                    <p class="text-sm lg:text-base font-extrabold text-gray-900 tracking-tight tabular-nums leading-none" id="currentTime">
                        --:-- --
                    </p>
                    <p class="text-[9px] font-bold text-coral-500 uppercase tracking-widest mt-0.5">
                        Local Time
                    </p>
                </div>
                <div class="flex items-center gap-2.5 pr-1">
                    <div class="w-9 h-9 rounded-full bg-white border border-gray-200/80 flex items-center justify-center shadow-sm">
                        <span class="text-xs font-extrabold text-gray-900 leading-none" id="currentDay">--</span>
                    </div>
                    <div class="text-left">
                        <p class="text-[11px] font-bold text-gray-900 leading-tight" id="currentDayName">---</p>
                        <p class="text-[10px] font-medium text-gray-400 leading-tight" id="currentMonthYear">---</p>
                    </div>
                </div>
            </div>

            <!-- Add Widgets Button (Only active/visible or opens catalog) -->
            <button onclick="openWidgetModal()" class="bg-white hover:bg-gray-50 text-gray-800 px-4 py-2.5 rounded-full border border-gray-200/80 text-xs font-bold flex items-center gap-2 shadow-sm transition-all">
                <svg class="w-3.5 h-3.5 text-coral-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
                <span>Widgets</span>
                <span id="active-widget-count" class="bg-[#F8F8FA] text-gray-600 px-2 py-0.5 rounded-full text-[10px] border border-gray-100">8/8</span>
            </button>

            <!-- Customize Mode Toggle Button -->
            <button id="editLayoutBtn" onclick="toggleEditLayoutMode()" class="bg-[#F8F8FA] hover:bg-gray-100 text-gray-800 px-4 py-2.5 rounded-full border border-gray-200/60 text-xs font-bold flex items-center gap-2 transition-all">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
                <span>Customize</span>
            </button>

            <!-- Quick Add Employee -->
            <a href="create-user.html" title="Add Team Member" class="w-10 h-10 bg-gray-50 rounded-full border border-gray-100 flex items-center justify-center text-gray-700 hover:bg-gray-900 hover:text-white transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
            </a>

            <!-- User Avatar -->
            <div class="flex items-center gap-2.5 bg-white p-1 pr-3 rounded-full border border-gray-100 shadow-sm">
                <img src="https://ui-avatars.com/api/?name=${encodedName}&background=E86D58&color=fff&bold=true" alt="Profile" class="w-8 h-8 rounded-full">
                <span id="cloudSyncStatus" class="text-[10px] font-bold text-gray-400 hidden sm:inline">Synced</span>
            </div>
        </div>
    </header>
    `;

    // Start Live Clock inside Topbar
    function updateClock() {
        const now = new Date();
        const greetingEl = document.getElementById('topbarGreeting');
        const dayEl = document.getElementById('currentDay');
        const dayNameEl = document.getElementById('currentDayName');
        const monthYearEl = document.getElementById('currentMonthYear');
        const timeEl = document.getElementById('currentTime');

        if (greetingEl) greetingEl.textContent = getGreeting();
        if (dayEl) dayEl.textContent = String(now.getDate()).padStart(2, '0');
        if (dayNameEl) dayNameEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short' });
        if (monthYearEl) monthYearEl.textContent = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: true 
            });
        }
    }
    updateClock();
    setInterval(updateClock, 1000);
});
