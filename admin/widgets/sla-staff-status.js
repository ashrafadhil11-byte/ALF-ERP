// File: admin/widgets/sla-staff-status.js — delivery SLA + who updated what today (all roles).
window.registerCargoWidget({
    id: 'sla-staff-status',
    title: 'SLA & Staff Activity',
    category: 'HR & SLA',
    description: 'Average days to deliver, overdue shipments and staff status updates today.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    render: withDash((d, size, ui) => {
        const s = d.sla || {};
        const staff = d.staff_today || [];
        const max = Math.max(1, ...staff.map(x => x.updates));
        const avg = s.avg_days_to_deliver == null ? '—' : ui.num(s.avg_days_to_deliver, 1);

        if (size === '1x1') {
            return ui.card('SLA', `
                <div class="mt-auto">
                    <p class="text-2xl font-extrabold">${avg}<span class="text-xs text-gray-400 font-semibold"> days avg</span></p>
                    <p class="text-[10px] font-bold text-coral-500 mt-1">${ui.num(s.overdue_10d)} overdue &gt;10 days</p>
                </div>`, { pad: 'p-5' });
        }
        const gauge = `
            <div class="grid grid-cols-3 gap-2">
                <div class="bg-[#111827] text-white rounded-2xl p-3"><p class="text-[9px] text-gray-400 uppercase">Avg days</p><p class="text-lg font-extrabold">${avg}</p></div>
                <div class="bg-[#F8F8FA] rounded-2xl p-3 border border-gray-100"><p class="text-[9px] text-gray-400 uppercase">Delivered</p><p class="text-lg font-extrabold">${ui.num(s.delivered_month)}</p></div>
                <div class="bg-coral-50 rounded-2xl p-3 border border-coral-100"><p class="text-[9px] text-coral-600 uppercase">Overdue</p><p class="text-lg font-extrabold text-coral-600">${ui.num(s.overdue_10d)}</p></div>
            </div>`;
        const list = staff.length
            ? staff.slice(0, size === '2x2' ? 8 : 4).map(x => `
                <div class="flex items-center gap-2 text-xs">
                    <span class="w-24 truncate font-bold text-gray-700">${ui.esc(x.name)}</span>
                    <div class="flex-1 h-2 bg-[#F8F8FA] rounded-full overflow-hidden"><div class="h-full bg-coral-500 rounded-full" style="width:${(x.updates / max) * 100}%"></div></div>
                    <span class="w-8 text-right font-extrabold">${x.updates}</span>
                </div>`).join('')
            : ui.empty('No status updates yet today.');
        return ui.card('SLA & Staff', `
            ${gauge}
            <p class="text-[10px] font-extrabold text-gray-400 uppercase mt-3 mb-2">Status updates today</p>
            <div class="space-y-2 flex-1 overflow-y-auto custom-scrollbar">${list}</div>`, { badge: 'This month' });
    })
});
