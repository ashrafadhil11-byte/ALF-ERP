// File: admin/widgets/branch-efficiency.js — branch-by-branch output table (admins).
window.registerCargoWidget({
    id: 'branch-efficiency',
    title: 'Branch Performance',
    category: 'Branches',
    description: 'Per-branch bookings today and this month, tonnage, active AWBs and status updates.',
    defaultSize: '2x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2', '4x2'],
    roles: ['super_admin', 'head_office'],
    render: withDash((d, size, ui) => {
        const rows = d.branches || [];
        if (!rows.length) return ui.card('Branches', ui.empty('No branches yet. Add them in Branch Network.'));

        if (size === '1x1') {
            const busiest = rows.reduce((a, b) => (b.today > a.today ? b : a), rows[0]);
            return ui.card('Busiest Today', `
                <div class="mt-auto">
                    <p class="text-lg font-extrabold truncate">${ui.esc(busiest.branch_name || busiest.branch_code)}</p>
                    <p class="text-[10px] font-bold text-gray-500 mt-1">${ui.num(busiest.today)} AWBs • ${ui.num(busiest.events_today)} updates</p>
                </div>`, { pad: 'p-5' });
        }
        if (size === '1x2' || size === '2x1') {
            return ui.card('Branch Performance', `
                <div class="space-y-2 overflow-y-auto custom-scrollbar flex-1">
                    ${rows.map(b => `
                        <div class="bg-[#F8F8FA] rounded-2xl px-4 py-2.5 border border-gray-100 flex justify-between items-center">
                            <div class="min-w-0"><p class="text-xs font-extrabold truncate">${ui.esc(b.branch_name || b.branch_code)}</p><p class="text-[10px] text-gray-400 font-bold">${ui.esc(b.branch_code)}</p></div>
                            <div class="text-right"><p class="text-sm font-extrabold">${ui.num(b.today)}</p><p class="text-[9px] text-gray-400 uppercase font-bold">today</p></div>
                        </div>`).join('')}
                </div>`, { badge: `${rows.length} branches` });
        }
        return ui.card('Branch Performance', `
            <div class="overflow-auto custom-scrollbar flex-1">
                <table class="w-full text-xs">
                    <thead><tr class="text-[10px] text-gray-400 uppercase text-left">
                        <th class="pb-2 font-extrabold">Branch</th><th class="pb-2 font-extrabold text-right">Today</th>
                        <th class="pb-2 font-extrabold text-right">Month</th><th class="pb-2 font-extrabold text-right">Weight</th>
                        <th class="pb-2 font-extrabold text-right">Active</th><th class="pb-2 font-extrabold text-right">Updates</th>
                    </tr></thead>
                    <tbody class="divide-y divide-gray-100">
                        ${rows.map(b => `
                            <tr>
                                <td class="py-2.5"><p class="font-extrabold">${ui.esc(b.branch_name || b.branch_code)}</p><p class="text-[10px] text-gray-400">${ui.esc(b.branch_code)} • ${ui.esc(b.branch_status || '')}</p></td>
                                <td class="py-2.5 text-right font-extrabold">${ui.num(b.today)}</td>
                                <td class="py-2.5 text-right font-bold">${ui.num(b.month)}</td>
                                <td class="py-2.5 text-right text-gray-500">${ui.kg(b.month_kg)}</td>
                                <td class="py-2.5 text-right font-bold">${ui.num(b.active)}</td>
                                <td class="py-2.5 text-right"><span class="bg-coral-50 text-coral-600 font-extrabold px-2 py-0.5 rounded-full">${ui.num(b.events_today)}</span></td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`, { badge: `${rows.length} branches` });
    })
});
