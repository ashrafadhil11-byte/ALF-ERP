// File: admin/widgets/global-financials.js
window.registerCargoWidget({
    id: 'global-financials',
    title: 'Global Financial Summary',
    category: 'Finance',
    description: 'Daily & Monthly Global Revenue and Operational Costs (OMR).',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    render: (size = '1x2') => {
        if (size === '1x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex flex-col justify-between">
                    <span class="text-[10px] font-extrabold text-gray-400 uppercase">Global Revenue</span>
                    <div>
                        <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 text-xs mr-0.5">OMR</span>24,850</p>
                        <p class="text-[10px] font-bold text-emerald-600 mt-1">Today: OMR 1,140</p>
                    </div>
                </div>
            `;
        }

        const isHorizontal = size === '2x1';
        return `
            <div class="h-full flex ${isHorizontal ? 'flex-row' : 'flex-col'} gap-4">
                <div class="bg-white rounded-[2rem] p-5 border border-gray-100/80 flex-1 flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <div class="w-7 h-7 rounded-full border border-gray-100 flex justify-center items-center text-gray-900 font-bold text-xs">$</div>
                        <span class="text-[10px] font-bold text-gray-600 bg-[#F8F8FA] px-2.5 py-0.5 rounded-full border border-gray-100">Revenue</span>
                    </div>
                    <div>
                        <p class="text-[11px] text-gray-400 font-medium">Monthly Revenue</p>
                        <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 font-semibold text-xs mr-0.5">OMR</span>24,850.00</p>
                        <p class="text-[10px] text-gray-500 font-bold mt-1">Today: OMR 1,140.50 <span class="text-emerald-600">(+9.4%)</span></p>
                    </div>
                </div>

                <div class="bg-white rounded-[2rem] p-5 border border-gray-100/80 flex-1 flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <div class="w-7 h-7 rounded-full border border-gray-100 flex justify-center items-center text-gray-900 text-xs">↓</div>
                        <span class="text-[10px] font-bold text-coral-500 bg-coral-50 px-2.5 py-0.5 rounded-full">67.2% Margin</span>
                    </div>
                    <div>
                        <p class="text-[11px] text-gray-400 font-medium">Monthly Operational Cost</p>
                        <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 font-semibold text-xs mr-0.5">OMR</span>8,145.20</p>
                        <p class="text-[10px] text-gray-400 font-bold mt-1">Today's Cost: OMR 312.00</p>
                    </div>
                </div>
            </div>
        `;
    }
});
