// File: admin/widgets/sla-staff-status.js
window.registerCargoWidget({
    id: 'sla-staff-status',
    title: 'Branch SLA & Employee Status',
    category: 'HR & SLA',
    description: 'Radial on-time delivery gauge and active branch staff & driver matrix.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    render: (size = '1x2') => {
        if (size === '1x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-4 border border-gray-100/80 flex flex-col items-center justify-center text-center">
                    <div class="w-20 h-20 flex items-center justify-center bg-[#111827] rounded-full shadow-md mb-2">
                        <span class="text-white text-lg font-extrabold">94%</span>
                    </div>
                    <p class="text-xs font-bold text-gray-900">Global SLA</p>
                    <p class="text-[10px] text-gray-400">42 Staff Active</p>
                </div>
            `;
        }

        const isHorizontal = size === '2x1';
        return `
            <div class="h-full flex ${isHorizontal ? 'flex-row' : 'flex-col'} gap-4">
                <div class="bg-white rounded-[2rem] p-4 border border-gray-100/80 flex-1 flex flex-col items-center justify-between">
                    <p class="text-[11px] font-bold text-gray-900">Avg. Branch SLA</p>
                    <div class="relative w-24 h-24 flex items-center justify-center bg-[#111827] rounded-full shadow-md">
                        <svg class="w-20 h-20 transform -rotate-90">
                            <circle cx="40" cy="40" r="33" stroke="#262F3F" stroke-width="6" fill="none" />
                            <circle cx="40" cy="40" r="33" stroke="#E86D58" stroke-width="6" fill="none" stroke-dasharray="207" stroke-dashoffset="30" stroke-linecap="round" />
                        </svg>
                        <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span class="text-white text-lg font-extrabold leading-none">94%</span>
                            <span class="text-gray-400 text-[8px] mt-0.5">On-Time</span>
                        </div>
                    </div>
                    <p class="text-[10px] text-gray-400 font-medium">Daily: 96% • Mo: 94%</p>
                </div>

                <div class="bg-white rounded-[2rem] p-4 border border-gray-100/80 flex-1 flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-extrabold text-gray-900">42 Active Staff</span>
                        <span class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Shift</span>
                    </div>
                    <p class="text-[10px] font-medium text-gray-400">28 Staff • 14 Drivers</p>
                    <div class="grid grid-cols-10 gap-1.5 pt-1">
                        ${'<span class="w-2 h-2 rounded-full bg-coral-500"></span>'.repeat(14)}
                        ${'<span class="w-2 h-2 rounded-full bg-gray-800"></span>'.repeat(10)}
                        ${'<span class="w-2 h-2 rounded-full bg-gray-200"></span>'.repeat(6)}
                    </div>
                </div>
            </div>
        `;
    }
});
