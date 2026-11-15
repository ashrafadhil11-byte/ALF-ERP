// File: admin/widgets/cargo-velocity.js — consolidation lots, tonnage, inbound transfers (all roles).
window.registerCargoWidget({
    id: 'cargo-velocity',
    title: 'Consolidation & Tonnage',
    category: 'Logistics',
    description: 'Open consolidation lots (MAWB), tonnage this month and pending inbound transfers.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x1', '2x2'],
    render: withDash((d, size, ui) => {
        const k = d.kpis;
        if (size === '1x1') {
            return ui.card('MAWB Lots', `
                <div class="mt-auto">
                    <p class="text-2xl font-extrabold">${ui.num(k.active_consolidations)}</p>
                    <p class="text-[10px] font-bold text-gray-500 mt-1">${ui.kg(k.month_kg)} this month</p>
                </div>`, { pad: 'p-5' });
        }
        const tile = (label, value, sub, dark) => `
            <div class="${dark ? 'bg-[#111827] text-white' : 'bg-[#F8F8FA] border border-gray-100'} rounded-2xl p-4 flex-1 flex flex-col justify-between">
                <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">${label}</p>
                <p class="text-2xl font-extrabold leading-tight">${value}</p>
                <p class="text-[10px] ${dark ? 'text-gray-400' : 'text-gray-500'} font-bold">${sub}</p>
            </div>`;
        return ui.card('Cargo Flow', `
            <div class="flex ${size === '2x1' ? 'flex-row' : 'flex-col'} gap-3 flex-1">
                ${tile('Open MAWB lots', ui.num(k.active_consolidations), 'Not yet delivered', true)}
                ${tile('Tonnage this month', ui.kg(k.month_kg), `Today: ${ui.kg(k.today_kg)}`)}
                ${size !== '1x2' ? tile('Inbound pending', ui.num(k.pending_inbound), 'Transfers to receive') : ''}
            </div>`, { badge: ui.scopeLabel() });
    })
});
