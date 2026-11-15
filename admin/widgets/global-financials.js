// File: admin/widgets/global-financials.js — revenue from booking amounts, per currency (not for staff).
window.registerCargoWidget({
    id: 'global-financials',
    title: 'Revenue Summary',
    category: 'Finance',
    description: 'Today and month-to-date revenue per currency from booking amounts.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    roles: ['super_admin', 'head_office', 'branch_manager'],
    render: withDash((d, size, ui) => {
        const rev = d.revenue || [];
        if (!rev.length) {
            return ui.card('Revenue', ui.empty('No booking amounts yet. Revenue appears here once bookings carry a charge (Financials module).'), { badge: ui.scopeLabel() });
        }
        const main = rev[0];
        if (size === '1x1') {
            return ui.card('Revenue', `
                <div class="mt-auto">
                    <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 text-xs mr-0.5">${ui.esc(main.currency)}</span>${ui.num(main.month, 2)}</p>
                    <p class="text-[10px] font-bold text-emerald-600 mt-1">Today: ${ui.esc(main.currency)} ${ui.num(main.today, 2)}</p>
                </div>`, { pad: 'p-5' });
        }
        return ui.card('Revenue', `
            <div class="flex ${size === '2x1' ? 'flex-row' : 'flex-col'} gap-3 flex-1">
                ${rev.slice(0, size === '2x2' ? 4 : 2).map(r => `
                    <div class="bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100 flex-1 flex flex-col justify-between">
                        <div class="flex justify-between items-center">
                            <div class="w-7 h-7 rounded-full bg-white border border-gray-100 flex justify-center items-center font-bold text-[9px]">${ui.esc(r.currency)}</div>
                            <span class="text-[10px] font-bold text-gray-500">Month to date</span>
                        </div>
                        <div>
                            <p class="text-xl font-extrabold text-gray-900"><span class="text-coral-500 font-semibold text-xs mr-0.5">${ui.esc(r.currency)}</span>${ui.num(r.month, 2)}</p>
                            <p class="text-[10px] text-gray-500 font-bold mt-1">Today: ${ui.esc(r.currency)} ${ui.num(r.today, 2)}</p>
                        </div>
                    </div>`).join('')}
            </div>
            <p class="text-[10px] text-gray-400 mt-2">Costs, margin and collections arrive with the Financials module.</p>`, { badge: ui.scopeLabel() });
    })
});
