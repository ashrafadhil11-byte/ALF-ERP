// File: admin/widgets/cargo-velocity.js
window.registerCargoWidget({
    id: 'cargo-velocity',
    title: 'Consolidation Lots & Cargo Tonnage',
    category: 'Logistics',
    description: 'Tracks active consolidation lots, Month-over-Month comparison, and total KG volume.',
    colSpan: 'col-span-12 xl:col-span-3',
    render: () => `
        <div class="h-full flex flex-col gap-5">
            <div class="grid grid-cols-2 gap-4 flex-1">
                <div class="bg-white rounded-[2rem] p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex flex-col justify-between">
                    <div class="w-7 h-7 rounded-full border border-gray-100 flex justify-center items-center">
                        <svg class="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                    </div>
                    <div>
                        <p class="text-base font-extrabold text-gray-900 leading-tight">14 Lots</p>
                        <p class="text-[10px] text-gray-400 font-medium">3 Dispatched Today</p>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-bold pt-2 border-t border-gray-50">
                        <span class="text-gray-400">Break-Bulk</span>
                        <span class="text-coral-500">4 Active</span>
                    </div>
                </div>

                <div class="bg-white rounded-[2rem] p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex flex-col justify-between relative overflow-hidden">
                    <div class="w-7 h-7 rounded-lg bg-[#F8F8FA] flex justify-center items-center">
                        <svg class="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                    </div>
                    <div class="flex items-end justify-around h-20 pt-2">
                        <div class="flex flex-col items-center">
                            <span class="text-[9px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full mb-1">Sep</span>
                            <div class="w-0.5 h-8 bg-gray-300"></div>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="text-[9px] font-bold text-white bg-coral-500 px-2 py-0.5 rounded-full mb-1 shadow-sm">Oct</span>
                            <div class="w-0.5 h-12 bg-coral-500"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex flex-col justify-between">
                <div class="flex justify-between items-center mb-2">
                    <div class="w-7 h-7 rounded-full bg-[#F8F8FA] flex justify-center items-center">
                        <svg class="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                    </div>
                    <p class="text-lg font-extrabold text-gray-900"><span class="text-coral-500 text-xs font-semibold mr-1">KG</span>22,480.50</p>
                </div>

                <div class="h-12 w-full my-1">
                    <svg viewBox="0 0 200 45" class="w-full h-full stroke-coral-500 fill-none" stroke-width="2" stroke-linecap="round">
                        <path d="M0 35 Q 15 20, 30 28 T 60 18 T 90 25 T 120 10 T 150 22 T 180 8 T 200 18"></path>
                    </svg>
                </div>

                <div class="flex justify-between items-end">
                    <div>
                        <p class="text-sm font-extrabold text-gray-900 leading-tight">Cargo Volume</p>
                        <p class="text-[10px] font-medium text-gray-400">Daily Avg: 749 kg • Monthly: 22.4T</p>
                    </div>
                    <span class="text-[11px] font-bold text-coral-500 bg-coral-50 px-2.5 py-1 rounded-full">+ 14.3%</span>
                </div>
            </div>
        </div>
    `
});
