// File: admin/widgets/cargo-velocity.js
window.registerCargoWidget({
    id: 'cargo-velocity',
    title: 'Consolidation Lots & Cargo Tonnage',
    category: 'Logistics',
    description: 'Active consolidation lots, Month-over-Month comparison, and total KG volume.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    render: (size = '1x2') => {
        if (size === '1x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex flex-col justify-between">
                    <span class="text-[10px] font-extrabold text-gray-400 uppercase">Cargo Tonnage</span>
                    <div>
                        <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 text-xs mr-1">KG</span>22,480</p>
                        <p class="text-[10px] font-bold text-coral-500 mt-1">14 Active Lots (+14.3%)</p>
                    </div>
                </div>
            `;
        }

        const isHorizontal = size === '2x1';
        return `
            <div class="h-full flex ${isHorizontal ? 'flex-row' : 'flex-col'} gap-4">
                <div class="grid grid-cols-2 gap-3 flex-1">
                    <div class="bg-white rounded-[2rem] p-4 border border-gray-100/80 flex flex-col justify-between">
                        <span class="text-[10px] font-bold text-gray-400 uppercase">Consolidation</span>
                        <div>
                            <p class="text-base font-extrabold text-gray-900">14 Lots</p>
                            <p class="text-[10px] text-gray-400">3 Sent Today</p>
                        </div>
                        <span class="text-[10px] font-bold text-coral-500">4 Break-Bulk</span>
                    </div>

                    <div class="bg-white rounded-[2rem] p-4 border border-gray-100/80 flex items-end justify-around">
                        <div class="flex flex-col items-center">
                            <span class="text-[9px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full mb-1">Sep</span>
                            <div class="w-0.5 h-8 bg-gray-300"></div>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="text-[9px] font-bold text-white bg-coral-500 px-2 py-0.5 rounded-full mb-1">Oct</span>
                            <div class="w-0.5 h-12 bg-coral-500"></div>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-[2rem] p-4 border border-gray-100/80 flex-1 flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-gray-900">Cargo Volume</span>
                        <p class="text-base font-extrabold text-gray-900"><span class="text-coral-500 text-xs mr-0.5">KG</span>22,480</p>
                    </div>
                    <div class="h-10 w-full">
                        <svg viewBox="0 0 200 45" class="w-full h-full stroke-coral-500 fill-none" stroke-width="2.5" stroke-linecap="round">
                            <path d="M0 35 Q 15 20, 30 28 T 60 18 T 90 25 T 120 10 T 150 22 T 180 8 T 200 18"></path>
                        </svg>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] text-gray-400 font-medium">Daily Avg: 749 kg</span>
                        <span class="text-[10px] font-bold text-coral-500 bg-coral-50 px-2 py-0.5 rounded-full">+14.3%</span>
                    </div>
                </div>
            </div>
        `;
    }
});
