// File: admin/widgets/sla-staff-status.js
window.registerCargoWidget({
    id: 'sla-staff-status',
    title: 'Branch SLA & Employee Status',
    category: 'HR & SLA',
    description: 'Radial on-time delivery gauge and 30-dot active branch staff & driver matrix.',
    colSpan: 'col-span-12 md:col-span-6 xl:col-span-2',
    render: () => `
        <div class="h-full flex flex-col gap-5">
            <div class="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex-1 flex flex-col items-center justify-between">
                <div class="text-center">
                    <div class="w-8 h-8 rounded-full bg-[#F8F8FA] flex items-center justify-center mx-auto mb-1.5">
                        <svg class="w-4 h-4 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <p class="text-[11px] font-bold text-gray-900">Avg. Branch SLA</p>
                </div>

                <div class="relative w-28 h-28 my-1 flex items-center justify-center bg-[#111827] rounded-full shadow-md">
                    <svg class="w-24 h-24 transform -rotate-90">
                        <circle cx="48" cy="48" r="40" stroke="#262F3F" stroke-width="7" fill="none" />
                        <circle cx="48" cy="48" r="40" stroke="#E86D58" stroke-width="7" fill="none" stroke-dasharray="251" stroke-dashoffset="40" stroke-linecap="round" />
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span class="text-white text-xl font-extrabold leading-none">94%</span>
                        <span class="text-gray-400 text-[9px] mt-1 font-medium">On-Time Rate</span>
                    </div>
                </div>
                <p class="text-[10px] text-gray-400 font-medium">Daily: 96% • Monthly: 94%</p>
            </div>

            <div class="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80">
                <div class="flex justify-between items-center mb-2">
                    <div class="w-7 h-7 rounded-full border border-gray-100 flex justify-center items-center">
                        <svg class="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    </div>
                    <span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Active Shift</span>
                </div>
                <p class="text-lg font-extrabold text-gray-900 leading-none mb-1">42 Active Staff</p>
                <p class="text-[10px] font-medium text-gray-400 mb-3">28 Branch Staff • 14 Drivers</p>
                <div class="grid grid-cols-10 gap-1.5">
                    ${'<span class="w-2 h-2 rounded-full bg-coral-500" title="Branch Staff"></span>'.repeat(14)}
                    ${'<span class="w-2 h-2 rounded-full bg-gray-800" title="Driver on Route"></span>'.repeat(10)}
                    ${'<span class="w-2 h-2 rounded-full bg-gray-200" title="Off Shift"></span>'.repeat(6)}
                </div>
            </div>
        </div>
    `
});
