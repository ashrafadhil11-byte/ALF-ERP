// File: admin/widgets/branch-financials.js — each branch's share of this month's bookings (admins).
window.registerCargoWidget({
    id: 'branch-financials',
    title: 'Branch Share (Concentric View)',
    category: 'Branches',
    description: "Concentric rings comparing each branch's share of this month's bookings.",
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x2'],
    roles: ['super_admin', 'head_office'],
    render: withDash((d, size, ui) => {
        const rows = (d.branches || []).filter(b => b.month > 0).slice(0, 4);
        const total = rows.reduce((s, b) => s + b.month, 0);
        if (!total) return ui.card('Branch Share', ui.empty('No bookings this month yet.'), { badge: 'This month' });

        const colors = ['#E86D58', '#111827', '#F7A99A', '#9CA3AF'];
        if (size === '1x1') {
            const top = rows[0];
            return ui.card('Top Branch', `
                <div class="mt-auto">
                    <p class="text-lg font-extrabold truncate">${ui.esc(top.branch_name || top.branch_code)}</p>
                    <p class="text-[10px] font-bold text-coral-500 mt-1">${Math.round((top.month / total) * 100)}% of ${ui.num(total)} AWBs</p>
                </div>`, { pad: 'p-5' });
        }
        const rings = rows.map((b, i) => {
            const r = 70 - i * 15, c = 2 * Math.PI * r, frac = b.month / total;
            return `<circle cx="80" cy="80" r="${r}" fill="none" stroke="#F3F4F6" stroke-width="10"/>
                    <circle cx="80" cy="80" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="10" stroke-linecap="round"
                        stroke-dasharray="${c * frac} ${c}" transform="rotate(-90 80 80)"/>`;
        }).join('');
        return ui.card('Share', `
            <div class="flex ${size === '2x2' ? 'flex-row items-center' : 'flex-col'} gap-4 flex-1 justify-center">
                <svg viewBox="0 0 160 160" class="w-32 h-32 mx-auto flex-shrink-0" role="img" aria-label="Branch share of bookings">${rings}
                    <text x="80" y="78" text-anchor="middle" class="font-extrabold" font-size="18" fill="#111827">${ui.num(total)}</text>
                    <text x="80" y="94" text-anchor="middle" font-size="8" fill="#9CA3AF">AWBs</text>
                </svg>
                <div class="space-y-1.5 flex-1">
                    ${rows.map((b, i) => `
                        <div class="flex items-center justify-between text-xs">
                            <span class="flex items-center gap-2 font-bold text-gray-700 truncate"><span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${colors[i]}"></span>${ui.esc(b.branch_name || b.branch_code)}</span>
                            <span class="font-extrabold">${Math.round((b.month / total) * 100)}%</span>
                        </div>`).join('')}
                </div>
            </div>`, { badge: 'This month' });
    })
});
