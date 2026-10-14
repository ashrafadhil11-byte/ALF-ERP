// File: admin/widgets/global-financials.js
window.registerCargoWidget({
    id: 'global-financials',
    title: 'Global Financial Summary',
    category: 'Finance',
    description: 'Stacked cards comparing Daily & Monthly Global Revenue and Operational Costs (OMR).',
    colSpan: 'col-span-12 md:col-span-6 xl:col-span-3',
    render: () => `
        <div class="h-full flex flex-col gap-5">
            <div class="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex-1 flex flex-col justify-between">
                <div class="flex justify-between items-center mb-3">
                    <div class="w-8 h-8 rounded-full border border-gray-100 flex justify-center items-center text-gray-900 font-bold text-xs">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 bg-[#F8F8FA] px-3 py-1 rounded-full border border-gray-100">
                        Daily vs Monthly
                    </span>
                </div>
                <div>
                    <p class="text-xs text-gray-400 font-medium mb-1">Total Global Revenue</p>
                    <div class="flex items-baseline justify-between">
                        <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 font-semibold text-sm mr-0.5">OMR</span>24,850.00</p>
                        <span class="text-[10px] font-semibold text-gray-400">Monthly</span>
                    </div>
                    <div class="mt-2 pt-2 border-t border-gray-50 flex justify-between items-center text-xs">
                        <span class="text-gray-400 font-medium">Today's Revenue:</span>
                        <span class="font-bold text-gray-900">OMR 1,140.50 <span class="text-emerald-600 text-[10px]">(+9.4%)</span></span>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex-1 flex flex-col justify-between">
                <div class="flex justify-between items-center mb-3">
                    <div class="w-8 h-8 rounded-full border border-gray-100 flex justify-center items-center text-gray-900">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"></path></svg>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 bg-[#F8F8FA] px-3 py-1 rounded-full border border-gray-100">
                        Freight & Clearance
                    </span>
                </div>
                <div class="flex justify-between items-end">
                    <div>
                        <p class="text-xs text-gray-400 font-medium mb-1">Monthly Operational Cost</p>
                        <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 font-semibold text-sm mr-0.5">OMR</span>8,145.20</p>
                        <p class="text-[11px] text-gray-400 mt-1">Today's Cost: <span class="font-bold text-gray-700">OMR 312.00</span></p>
                    </div>
                    <span class="flex items-center gap-1 text-[10px] font-bold text-coral-500 bg-coral-50 px-2.5 py-1.5 rounded-xl leading-tight">
                        67.2%<br>Margin
                    </span>
                </div>
            </div>
        </div>
    `
});
