// File: admin/widgets/branch-pipeline.js
window.registerCargoWidget({
    id: 'branch-pipeline',
    title: 'Branch Performance & Consolidation Pipeline',
    category: 'Operations',
    description: 'Tracks branch daily output, consolidation stages, break-bulk, and manifest approvals.',
    defaultSize: '2x2',
    allowedSizes: ['2x1', '2x2', '3x2', '4x2'],
    render: (size = '2x2') => {
        if (size === '2x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex items-center justify-between gap-4">
                    <div>
                        <span class="font-bold text-gray-900 text-xs">Consolidation & Break-Bulk Pipeline</span>
                        <p class="text-xs text-gray-400 mt-0.5">Salalah HQ • Muscat • Sohar</p>
                    </div>
                    <div class="flex gap-3">
                        <div class="bg-[#F8F8FA] px-3.5 py-2 rounded-xl text-center"><span class="text-[9px] text-gray-400 block">Consolidated</span><span class="text-sm font-extrabold">640</span></div>
                        <div class="bg-[#F8F8FA] px-3.5 py-2 rounded-xl text-center"><span class="text-[9px] text-gray-400 block">Cleared</span><span class="text-sm font-extrabold">412</span></div>
                        <div class="bg-coral-50 text-coral-600 px-3.5 py-2 rounded-xl text-center"><span class="text-[9px] block">Out for Delivery</span><span class="text-sm font-extrabold">790</span></div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="h-full bg-white rounded-[2rem] p-6 border border-gray-100/80 flex flex-col justify-between">
                <div>
                    <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                        <span class="font-bold text-gray-900 text-sm">Branch Performance & Consolidation Pipeline</span>
                        <span class="text-[10px] font-bold text-gray-600 bg-[#F8F8FA] px-3 py-1 rounded-full border border-gray-100">Daily vs Monthly KPI</span>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-gray-100">
                        <span class="text-xs text-gray-400">Active Branch Flow</span>
                        <div class="flex flex-wrap gap-1.5">
                            <span class="text-[10px] font-bold text-gray-900 bg-[#F8F8FA] px-2.5 py-1 rounded-full border border-gray-200/60 flex items-center gap-1">
                                Salalah HQ <span class="w-1.5 h-1.5 rounded-full bg-coral-500"></span>
                            </span>
                            <span class="text-[10px] font-semibold text-gray-600 bg-[#F8F8FA] px-2.5 py-1 rounded-full">Muscat (92%)</span>
                            <span class="text-[10px] font-semibold text-gray-600 bg-[#F8F8FA] px-2.5 py-1 rounded-full">Sohar (89%)</span>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 flex-1">
                    <div class="bg-[#F8F8FA] rounded-2xl p-4 flex flex-col justify-between">
                        <div>
                            <p class="text-[10px] font-semibold text-gray-400 uppercase">Avg Branch Output</p>
                            <p class="text-xl font-extrabold text-gray-900 mt-0.5"><span class="text-coral-500 text-sm">#</span>61.4 <span class="text-[10px] font-semibold text-gray-400">AWB/day</span></p>
                        </div>
                        <div class="flex items-end justify-between h-14 my-2 px-1">
                            <div class="w-1 bg-coral-300 rounded-full h-7"></div>
                            <div class="w-1 bg-coral-500 rounded-full h-12"></div>
                            <div class="w-1 bg-gray-300 rounded-full h-5"></div>
                            <div class="w-1 bg-coral-300 rounded-full h-9"></div>
                            <div class="w-1 bg-coral-500 rounded-full h-11"></div>
                            <div class="w-1 bg-gray-300 rounded-full h-6"></div>
                            <div class="w-1 bg-coral-300 rounded-full h-8"></div>
                            <div class="w-1 bg-gray-800 rounded-full h-10"></div>
                            <div class="w-1 bg-coral-500 rounded-full h-14"></div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] text-gray-500 font-semibold">
                            <span>Daily: 74</span>
                            <span class="text-coral-500 font-bold">Mo: 1,842</span>
                        </div>
                    </div>

                    <div class="bg-[#F8F8FA] rounded-2xl p-4 flex flex-col justify-between">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-gray-900 text-xs">Cargo Stages</span>
                            <span class="text-[10px] font-bold text-coral-500">Active</span>
                        </div>
                        <div class="relative pl-3 space-y-2.5 my-auto">
                            <div class="absolute left-[11px] top-2 bottom-2 w-[1.5px] bg-coral-200"></div>
                            <div class="flex items-center justify-between relative z-10">
                                <div class="flex items-center gap-2">
                                    <span class="w-4 h-4 rounded-full bg-coral-500 text-white flex items-center justify-center text-[8px] font-bold">1</span>
                                    <span class="text-[11px] font-bold text-gray-900">Consolidated</span>
                                </div>
                                <span class="text-[10px] font-extrabold text-gray-700">640</span>
                            </div>
                            <div class="flex items-center justify-between relative z-10">
                                <div class="flex items-center gap-2">
                                    <span class="w-4 h-4 rounded-full bg-coral-500 text-white flex items-center justify-center text-[8px] font-bold">2</span>
                                    <span class="text-[11px] font-semibold text-gray-600">Cleared & Bulk</span>
                                </div>
                                <span class="text-[10px] font-extrabold text-gray-700">412</span>
                            </div>
                            <div class="flex items-center justify-between relative z-10">
                                <div class="flex items-center gap-2">
                                    <span class="w-4 h-4 rounded-full bg-coral-500 text-white flex items-center justify-center text-[8px] font-bold">3</span>
                                    <span class="text-[11px] font-semibold text-gray-600">Delivery</span>
                                </div>
                                <span class="text-[10px] font-extrabold text-emerald-600">790</span>
                            </div>
                        </div>
                    </div>

                    <div class="bg-[#F8F8FA] rounded-2xl p-4 flex flex-col justify-between items-start">
                        <div class="text-coral-500">
                            <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                        </div>
                        <div>
                            <h4 class="text-xs font-bold text-gray-900 leading-tight mb-1">Manifest Release</h4>
                            <p class="text-[10px] text-gray-400 leading-snug">3 Consolidated lots awaiting destination break-bulk approval.</p>
                        </div>
                        <button class="bg-coral-500 hover:bg-coral-600 text-white text-[11px] font-bold py-2 px-4 rounded-full w-full transition-colors">
                            Approve Lots (3)
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
});
