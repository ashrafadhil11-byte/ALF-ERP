// File: admin/widgets/global-shipments.js — live booking volume (all roles).
window.registerCargoWidget({
    id: 'global-shipments',
    title: 'Shipments Overview',
    category: 'Operations',
    description: 'Bookings today and this month, weight, active AWBs and change vs last month.',
    defaultSize: '2x2',
    allowedSizes: ['1x1', '2x1', '2x2', '2x3'],
    render: withDash((d, size, ui) => {
        const k = d.kpis;
        const mom = ui.pct(k.month_count, k.last_month_count);
        const dod = ui.pct(k.today_count, k.yesterday_count);
        const days = new Date().getDate();

        if (size === '1x1') {
            return ui.card('Shipments', `
                <div class="mt-auto">
                    <p class="text-2xl font-extrabold text-gray-900">${ui.num(k.month_count)}</p>
                    <p class="text-[10px] font-bold ${dod.cls} mt-0.5">Today: ${ui.num(k.today_count)} AWBs (${dod.text})</p>
                </div>`, { pad: 'p-5' });
        }
        if (size === '2x1') {
            return ui.card(`Shipments • ${ui.scopeLabel()}`, `
                <div class="flex items-center justify-between gap-4 my-auto">
                    <div>
                        <p class="text-2xl font-extrabold text-gray-900">${ui.num(k.month_count)} <span class="text-xs font-semibold text-gray-400">AWBs this month</span></p>
                        <span class="text-[10px] font-bold ${mom.cls}">${mom.text} vs last month</span>
                    </div>
                    <div class="flex gap-2.5">
                        <div class="bg-[#111827] text-white rounded-2xl px-4 py-2.5"><span class="text-[9px] text-gray-400 uppercase block">Today</span><span class="text-base font-extrabold">${ui.num(k.today_count)}</span></div>
                        <div class="bg-[#F8F8FA] rounded-2xl px-4 py-2.5 border border-gray-100"><span class="text-[9px] text-gray-400 uppercase block">Active</span><span class="text-base font-extrabold">${ui.num(k.active)}</span></div>
                    </div>
                </div>`, { pad: 'p-5' });
        }

        const split = size === '2x3' && d.branches.length > 1 ? `
            <div class="bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100 space-y-2">
                <p class="text-[10px] font-extrabold text-gray-400 uppercase">Branch split today</p>
                ${d.branches.slice(0, 5).map(b => `<div class="flex justify-between text-xs font-bold"><span>${ui.esc(b.branch_name || b.branch_code)}</span><span>${ui.num(b.today)} AWBs</span></div>`).join('')}
            </div>` : '';
        const todayTrend = dod.cls === 'text-coral-500' ? 'text-coral-400' : 'text-emerald-400';

        return ui.card('Shipments Overview', `
            <div class="my-1">
                <p class="text-xs text-gray-400 font-medium mb-1">Active AWBs (not yet delivered)</p>
                <div class="flex items-baseline gap-3 flex-wrap">
                    <p class="text-3xl font-extrabold text-gray-900 tracking-tight">${ui.num(k.active)} <span class="text-sm font-semibold text-gray-400">AWBs</span></p>
                    <span class="text-xs font-bold ${mom.cls} bg-[#F8F8FA] px-2 py-0.5 rounded-full">${mom.text} vs last mo</span>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3 my-2">
                <div class="bg-[#111827] text-white rounded-2xl p-3.5">
                    <div class="flex justify-between items-center mb-1.5"><span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Today</span><span class="text-[10px] font-bold ${todayTrend}">${dod.text}</span></div>
                    <p class="text-xl font-extrabold leading-none">${ui.num(k.today_count)} <span class="text-[11px] font-normal text-gray-300">Bookings</span></p>
                    <p class="text-[10px] text-gray-400 mt-1.5">${ui.kg(k.today_kg)}</p>
                </div>
                <div class="bg-[#F8F8FA] rounded-2xl p-3.5 border border-gray-100">
                    <div class="flex justify-between items-center mb-1.5"><span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">This Month</span><span class="text-[10px] font-bold ${mom.cls}">${mom.text}</span></div>
                    <p class="text-xl font-extrabold leading-none">${ui.num(k.month_count)} <span class="text-[11px] font-normal text-gray-500">Bookings</span></p>
                    <p class="text-[10px] text-gray-400 mt-1.5">${ui.kg(k.month_kg)}</p>
                </div>
            </div>
            ${split}
            <div class="flex justify-between items-end border-t border-gray-100 pt-3 mt-auto">
                <div>
                    <p class="text-[11px] text-gray-400 font-medium">Daily average (this month)</p>
                    <p class="text-base font-extrabold text-gray-900">${ui.num(k.month_count / days, 1)} <span class="text-xs font-semibold text-gray-400">/ day</span></p>
                </div>
                <span class="text-coral-500 text-[11px] font-bold">${ui.num(k.exceptions)} exceptions</span>
            </div>`, { badge: ui.scopeLabel() });
    })
});
