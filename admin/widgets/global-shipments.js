// File: admin/widgets/global-shipments.js
window.registerCargoWidget({
    id: 'global-shipments',
    title: 'Global Shipments Overview',
    category: 'Operations',
    description: 'Total consolidated & active bookings comparing Daily vs Monthly performance.',
    colSpan: 'col-span-12 xl:col-span-4',
    render: () => `
        <div class="h-full bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex flex-col justify-between">
            <div class="flex justify-between items-center mb-5">
                <div class="flex items-center gap-2">
                    <span class="font-extrabold text-gray-900 tracking-wider text-xs uppercase">Global Shipments</span>
                    <span class="w-2 h-2 rounded-full bg-coral-500"></span>
                </div>
                <span class="text-[11px] font-semibold text-gray-600 bg-[#F8F8FA] px-3 py-1.5 rounded-full border border-gray-100">
                    All Branches (SLH • MCT • SHR)
                </span>
            </div>

            <div class="mb-5">
                <p class="text-xs text-gray-400 font-medium mb-1">Total Consolidated & Active Bookings</p>
                <div class="flex items-baseline gap-3">
                    <p class="text-3xl font-extrabold text-gray-900 tracking-tight">1,842 <span class="text-sm font-semibold text-gray-400">AWBs</span></p>
                    <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">+16.4% vs last mo</span>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-3 mb-6">
                <div class="bg-[#111827] text-white rounded-2xl p-3.5 flex flex-col justify-between">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Daily Overview</span>
                        <span class="text-[10px] font-bold text-emerald-400">+12%</span>
                    </div>
                    <p class="text-xl font-extrabold leading-none">74 <span class="text-[11px] font-normal text-gray-300">Bookings</span></p>
                    <p class="text-[10px] text-gray-400 mt-1.5">Today • 920 kg</p>
                </div>

                <div class="bg-[#F8F8FA] text-gray-900 rounded-2xl p-3.5 border border-gray-100 flex flex-col justify-between">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Monthly Overview</span>
                        <span class="text-[10px] font-bold text-coral-500">+16.4%</span>
                    </div>
                    <p class="text-xl font-extrabold leading-none">1,842 <span class="text-[11px] font-normal text-gray-500">Bookings</span></p>
                    <p class="text-[10px] text-gray-400 mt-1.5">Oct • 22.4 Tons</p>
                </div>
            </div>

            <div class="flex justify-between items-end border-t border-gray-100 pt-4">
                <div>
                    <p class="text-[11px] text-gray-400 font-medium mb-0.5">Daily Average (This Month)</p>
                    <p class="text-base font-extrabold text-gray-900">61.4 <span class="text-xs font-semibold text-gray-400">Shipments / day</span></p>
                </div>
                <a href="#" class="flex items-center gap-1.5 text-coral-500 text-[11px] font-bold hover:underline">
                    <span class="w-5 h-5 rounded-full bg-coral-50 flex items-center justify-center">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                    </span>
                    Full Breakdown
                </a>
            </div>
        </div>
    `
});
