// File: admin/widgets/branch-financials.js
window.isMonthlyBranchView = true;

window.toggleBranchPeriod = function() {
    window.isMonthlyBranchView = !window.isMonthlyBranchView;
    window.renderDashboardWidgets();
};

window.registerCargoWidget({
    id: 'branch-financials',
    title: 'Branch Financials (Concentric View)',
    category: 'Finance',
    description: 'Concentric circle visualization comparing revenue across Salalah HQ, Muscat, and Sohar.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x2'],
    render: (size = '1x2') => {
        const isMo = window.isMonthlyBranchView;
        if (size === '1x1') {
            return `
                <div class="h-full bg-white rounded-[2rem] p-5 border border-gray-100/80 flex flex-col justify-between">
                    <span class="font-bold text-gray-900 text-xs">Branch Revenue</span>
                    <div class="space-y-1 text-xs">
                        <div class="flex justify-between"><span class="text-gray-400">Salalah:</span><span class="font-extrabold">OMR 11.4K</span></div>
                        <div class="flex justify-between"><span class="text-gray-400">Muscat:</span><span class="font-extrabold">OMR 8.2K</span></div>
                        <div class="flex justify-between"><span class="text-gray-400">Sohar:</span><span class="font-extrabold">OMR 3.6K</span></div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="h-full bg-white rounded-[2rem] p-6 border border-gray-100/80 flex flex-col justify-between">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-gray-900 text-sm">Branch Financials</span>
                    <button onclick="toggleBranchPeriod()" class="flex items-center gap-1 text-[10px] font-bold text-gray-700 bg-[#F8F8FA] hover:bg-gray-100 px-3 py-1 rounded-full border border-gray-100">
                        <span>${isMo ? 'Monthly' : 'Daily'}</span>
                    </button>
                </div>
                
                <div class="relative w-full h-52 flex justify-center items-end mt-auto">
                    <div class="absolute bottom-0 w-48 h-48 bg-coral-50 rounded-full flex flex-col items-center justify-start pt-3 border border-coral-100/60">
                        <span class="text-[9px] font-bold text-gray-400 uppercase">Salalah HQ</span>
                        <span class="text-xs font-extrabold text-gray-900">${isMo ? 'OMR 11.4K' : 'OMR 540'}</span>
                    </div>
                    <div class="absolute bottom-0 w-36 h-36 bg-coral-100/80 rounded-full flex flex-col items-center justify-start pt-2.5 border border-coral-200/50">
                        <span class="text-[8px] font-bold text-gray-500 uppercase">Muscat</span>
                        <span class="text-xs font-extrabold text-gray-900">${isMo ? 'OMR 8.2K' : 'OMR 390'}</span>
                    </div>
                    <div class="absolute bottom-0 w-24 h-24 bg-coral-300/70 rounded-full flex flex-col items-center justify-start pt-2">
                        <span class="text-[8px] font-bold text-gray-700 uppercase">Sohar</span>
                        <span class="text-[11px] font-extrabold text-gray-900">${isMo ? 'OMR 3.6K' : 'OMR 210'}</span>
                    </div>
                    <div class="absolute bottom-0 w-11 h-11 bg-coral-500 rounded-full flex flex-col items-center justify-center shadow-md">
                        <span class="text-[9px] font-extrabold text-white">${isMo ? '23.2K' : '1.1K'}</span>
                    </div>
                </div>
            </div>
        `;
    }
});
