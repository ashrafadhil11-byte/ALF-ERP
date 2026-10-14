// File: admin/widgets/global-shipments.js
window.registerCargoWidget({
    id: 'global-shipments',
    title: 'Global Shipments Overview',
    category: 'Operations',
    description: 'Total consolidated & active bookings comparing Daily vs Monthly performance.',
    defaultSize: '2x2',
    allowedSizes: ['1x1', '2x1', '2x2', '2x3'],
    render: (size = '2x2') => {
        // Compact 1x1 Tile
        if (size === '1x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <span class="font-extrabold text-gray-900 text-[11px] uppercase tracking-wider">Shipments</span>
                        <span class="w-2 h-2 rounded-full bg-coral-500"></span>
                    </div>
                    <div>
                        <p class="text-2xl font-extrabold text-gray-900">1,842</p>
                        <p class="text-[10px] font-bold text-emerald-600 mt-0.5">Today: 74 AWBs (+12%)</p>
                    </div>
                </div>
            `;
        }

        // Wide 2x1 Strip
        if (size === '2x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex items-center justify-between gap-4">
                    <div>
                        <span class="font-extrabold text-gray-900 text-[10px] uppercase tracking-wider">Global Shipments</span>
                        <p class="text-2xl font-extrabold text-gray-900 mt-1">1,842 <span class="text-xs font-semibold text-gray-400">AWBs</span></p>
                        <span class="text-[10px] font-bold text-emerald-600">+16.4% vs last mo</span>
                    </div>
                    <div class="flex gap-2.5">
                        <div class="bg-[#111827] text-white rounded-2xl px-4 py-2.5">
                            <span class="text-[9px] text-gray-400 uppercase block">Daily</span>
                            <span class="text-base font-extrabold">74</span>
                        </div>
                        <div class="bg-[#F8F8FA] text-gray-900 rounded-2xl px-4 py-2.5 border border-gray-100">
                            <span class="text-[9px] text-gray-400 uppercase block">Monthly</span>
                            <span class="text-base font-extrabold">1,842</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // Standard 2x2 or Tall 2x3 Card
        const isTall = size === '2x3';
        return `
            <div class="h-full bg-white rounded-[2rem] p-6 border border-gray-100/80 flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <span class="font-extrabold text-gray-900 tracking-wider text-xs uppercase">Global Shipments</span>
                        <span class="w-2 h-2 rounded-full bg-coral-500"></span>
                    </div>
                    <span class="text-[11px] font-semibold text-gray-600 bg-[#F8F8FA] px-3 py-1 rounded-full border border-gray-100">
                        All Branches
                    </span>
                </div>

                <div class="my-2">
                    <p class="text-xs text-gray-400 font-medium mb-1">Total Consolidated & Active Bookings</p>
                    <div class="flex items-baseline gap-3">
                        <p class="text-3xl font-extrabold text-gray-900 tracking-tight">1,842 <span class="text-sm font-semibold text-gray-400">AWBs</span></p>
                        <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">+16.4% vs last mo</span>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3 my-2">
                    <div class="bg-[#111827] text-white rounded-2xl p-3.5 flex flex-col justify-between">
                        <div class="flex justify-between items-center mb-1.5">
                            <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Daily Overview</span>
                            <span class="text-[10px] font-bold text-emerald-400">+12%</span>
                        </div>
                        <p class="text-xl font-extrabold leading-none">74 <span class="text-[11px] font-normal text-gray-300">Bookings</span></p>
                        <p class="text-[10px] text-gray-400 mt-1.5">Today • 920 kg</p>
                    </div>

                    <div class="bg-[#F8F8FA] text-gray-900 rounded-2xl p-3.5 border border-gray-100 flex flex-col justify-between">
                        <div class="flex justify-between items-center mb-1.5">
                            <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Monthly Overview</span>
                            <span class="text-[10px] font-bold text-coral-500">+16.4%</span>
                        </div>
                        <p class="text-xl font-extrabold leading-none">1,842 <span class="text-[11px] font-normal text-gray-500">Bookings</span></p>
                        <p class="text-[10px] text-gray-400 mt-1.5">Oct • 22.4 Tons</p>
                    </div>
                </div>

                ${isTall ? `
                    <div class="bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100 space-y-2 my-2">
                        <p class="text-[10px] font-extrabold text-gray-400 uppercase">Branch Daily Split</p>
                        <div class="flex justify-between text-xs font-bold"><span>Salalah HQ</span><span>34 AWBs (420 kg)</span></div>
                        <div class="flex justify-between text-xs font-bold"><span>Muscat Branch</span><span>26 AWBs (310 kg)</span></div>
                        <div class="flex justify-between text-xs font-bold"><span>Sohar Branch</span><span>14 AWBs (190 kg)</span></div>
                    </div>
                ` : ''}

                <div class="flex justify-between items-end border-t border-gray-100 pt-3">
                    <div>
                        <p class="text-[11px] text-gray-400 font-medium">Daily Average (This Month)</p>
                        <p class="text-base font-extrabold text-gray-900">61.4 <span class="text-xs font-semibold text-gray-400">Shipments / day</span></p>
                    </div>
                    <span class="text-coral-500 text-[11px] font-bold">98.5% Cleared</span>
                </div>
            </div>
        `;
    }
});
