// File: admin/widgets/branch-efficiency.js
window.registerCargoWidget({
    id: 'branch-efficiency',
    title: 'Average Performance by Branch',
    category: 'Branches',
    description: 'Branch efficiency scores and daily shipment output across Salalah, Muscat, and Sohar.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    render: (size = '1x2') => {
        if (size === '1x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex flex-col justify-between">
                    <span class="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full w-max">93.4% Avg</span>
                    <div>
                        <p class="text-sm font-extrabold text-gray-900">Branch Performance</p>
                        <p class="text-[11px] text-gray-400 mt-1">SLH 96% • MCT 92% • SHR 89%</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="h-full bg-white rounded-[2rem] p-6 border border-gray-100/80 flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <div class="flex gap-1 items-center">
                        <span class="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                        <span class="w-3.5 h-1.5 rounded-full bg-gray-900"></span>
                    </div>
                    <span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">93.4% Global Avg</span>
                </div>

                <div class="my-2">
                    <p class="text-[11px] text-gray-400 font-medium mb-0.5">Branch Efficiency Score</p>
                    <h4 class="text-base font-extrabold text-gray-900 leading-snug">Average Performance by Branch</h4>
                </div>

                <div class="space-y-2.5 my-2">
                    <div>
                        <div class="flex justify-between text-xs font-bold mb-1">
                            <span class="text-gray-800">Salalah HQ</span>
                            <span class="text-gray-900">96% <span class="text-[10px] text-gray-400 font-medium">(34/day)</span></span>
                        </div>
                        <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div class="bg-coral-500 h-full rounded-full" style="width: 96%"></div>
                        </div>
                    </div>
                    <div>
                        <div class="flex justify-between text-xs font-bold mb-1">
                            <span class="text-gray-800">Muscat Branch</span>
                            <span class="text-gray-900">92% <span class="text-[10px] text-gray-400 font-medium">(26/day)</span></span>
                        </div>
                        <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div class="bg-gray-900 h-full rounded-full" style="width: 92%"></div>
                        </div>
                    </div>
                    <div>
                        <div class="flex justify-between text-xs font-bold mb-1">
                            <span class="text-gray-800">Sohar Branch</span>
                            <span class="text-gray-900">89% <span class="text-[10px] text-gray-400 font-medium">(14/day)</span></span>
                        </div>
                        <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div class="bg-coral-300 h-full rounded-full" style="width: 89%"></div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-between items-center pt-2 border-t border-gray-50">
                    <span class="text-[10px] font-semibold text-gray-400">Daily Health Check</span>
                    <div class="flex gap-1.5">
                        <span class="w-6 h-6 rounded-full bg-[#F8F8FA] border border-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-700">S</span>
                        <span class="w-6 h-6 rounded-full bg-[#F8F8FA] border border-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-700">M</span>
                        <span class="w-6 h-6 rounded-full bg-coral-500 text-white flex items-center justify-center text-[10px] font-bold">✓</span>
                    </div>
                </div>
            </div>
        `;
    }
});
