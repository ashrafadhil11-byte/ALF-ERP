// File: admin/widgets/branch-financials.js
window.isMonthlyBranchView = true;

window.toggleBranchPeriod = function() {
    window.isMonthlyBranchView = !window.isMonthlyBranchView;
    const isMo = window.isMonthlyBranchView;
    document.getElementById('branchPeriodLabel').textContent = isMo ? 'Monthly' : 'Daily Today';
    document.getElementById('circleSlh').textContent = isMo ? 'OMR 11.4K' : 'OMR 540';
    document.getElementById('circleMct').textContent = isMo ? 'OMR 8.2K' : 'OMR 390';
    document.getElementById('circleShr').textContent = isMo ? 'OMR 3.6K' : 'OMR 210';
    document.getElementById('circleToday').textContent = isMo ? '1.1K' : 'Today';
};

window.registerCargoWidget({
    id: 'branch-financials',
    title: 'Branch Financials (Concentric View)',
    category: 'Finance',
    description: 'Concentric circle visualization comparing revenue across Salalah HQ, Muscat, and Sohar.',
    colSpan: 'col-span-12 lg:col-span-4 xl:col-span-3',
    render: () => `
        <div class="h-full bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80 flex flex-col justify-between">
            <div class="flex justify-between items-center mb-4">
                <span class="font-bold text-gray-900 text-sm">Branch Financials</span>
                <button onclick="toggleBranchPeriod()" class="flex items-center gap-1.5 text-[11px] font-bold text-gray-700 bg-[#F8F8FA] hover:bg-gray-100 px-3 py-1.5 rounded-full border border-gray-100 transition-colors">
                    <span id="branchPeriodLabel">Monthly</span>
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
            </div>
            
            <div class="relative w-full h-52 flex justify-center items-end mt-2">
                <div class="absolute bottom-0 w-48 h-48 bg-coral-50 rounded-full flex flex-col items-center justify-start pt-3 border border-coral-100/60">
                    <span class="text-[9px] font-bold text-gray-400 uppercase">Salalah HQ</span>
                    <span class="text-xs font-extrabold text-gray-900" id="circleSlh">OMR 11.4K</span>
                </div>
                <div class="absolute bottom-0 w-36 h-36 bg-coral-100/80 rounded-full flex flex-col items-center justify-start pt-2.5 border border-coral-200/50">
                    <span class="text-[8px] font-bold text-gray-500 uppercase">Muscat</span>
                    <span class="text-xs font-extrabold text-gray-900" id="circleMct">OMR 8.2K</span>
                </div>
                <div class="absolute bottom-0 w-24 h-24 bg-coral-300/70 rounded-full flex flex-col items-center justify-start pt-2">
                    <span class="text-[8px] font-bold text-gray-700 uppercase">Sohar</span>
                    <span class="text-[11px] font-extrabold text-gray-900" id="circleShr">OMR 3.6K</span>
                </div>
                <div class="absolute bottom-0 w-12 h-12 bg-coral-500 rounded-full flex flex-col items-center justify-center shadow-md">
                    <span class="text-[7px] font-semibold text-white/80 uppercase">Today</span>
                    <span class="text-[10px] font-extrabold text-white" id="circleToday">1.1K</span>
                </div>
            </div>
        </div>
    `
});
