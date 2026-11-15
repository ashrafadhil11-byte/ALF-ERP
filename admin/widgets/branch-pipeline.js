// File: admin/widgets/branch-pipeline.js — where active shipments are in the 9-stage lifecycle (all roles).
window.registerCargoWidget({
    id: 'branch-pipeline',
    title: 'Shipment Pipeline',
    category: 'Operations',
    description: 'Active shipments by stage (Booking → Review) plus exceptions on hold.',
    defaultSize: '2x2',
    allowedSizes: ['2x1', '2x2', '3x2', '4x2'],
    render: withDash((d, size, ui) => {
        const byStage = Object.fromEntries((d.pipeline || []).map(p => [p.stage, p.count]));
        const stages = [1, 2, 3, 4, 5, 6, 7];
        const max = Math.max(1, ...stages.map(s => byStage[s] || 0));
        const exc = d.exceptions || [];
        const excTotal = exc.reduce((s, e) => s + e.count, 0);

        if (size === '2x1') {
            return ui.card('Pipeline', `
                <div class="flex gap-1.5 flex-1 items-end">
                    ${stages.map(s => `
                        <div class="flex-1 text-center">
                            <p class="text-sm font-extrabold">${ui.num(byStage[s] || 0)}</p>
                            <p class="text-[8px] font-bold text-gray-400 uppercase truncate">${ui.stageName(s)}</p>
                        </div>`).join('')}
                    <div class="flex-1 text-center bg-coral-50 rounded-xl py-1"><p class="text-sm font-extrabold text-coral-600">${ui.num(excTotal)}</p><p class="text-[8px] font-bold text-coral-500 uppercase">Hold</p></div>
                </div>`, { pad: 'p-5' });
        }

        const bars = stages.map(s => {
            const n = byStage[s] || 0;
            return `
                <div class="flex-1 flex flex-col items-center justify-end gap-1.5 min-w-0">
                    <span class="text-xs font-extrabold">${ui.num(n)}</span>
                    <div class="w-full max-w-[42px] rounded-xl ${n ? 'bg-[#111827]' : 'bg-gray-100'}" style="height:${Math.max(6, (n / max) * 100)}%"></div>
                    <span class="text-[9px] font-bold text-gray-400 uppercase truncate w-full text-center">${ui.stageName(s)}</span>
                </div>`;
        }).join('');
        const excList = exc.length
            ? exc.map(e => `<div class="flex justify-between text-xs"><span class="font-bold text-gray-700 truncate">${ui.esc(e.label)}</span><span class="font-extrabold text-coral-600">${ui.num(e.count)}</span></div>`).join('')
            : '<p class="text-xs text-gray-400">No exceptions 🎉</p>';
        const wide = size === '3x2' || size === '4x2';

        return ui.card('Shipment Pipeline', `
            <div class="flex ${wide ? 'flex-row' : 'flex-col'} gap-4 flex-1 min-h-0">
                <div class="flex gap-2 flex-1 min-h-[120px] items-stretch">${bars}</div>
                <div class="${wide ? 'w-56' : ''} bg-coral-50/60 rounded-2xl p-4 border border-coral-100 space-y-1.5 overflow-y-auto custom-scrollbar">
                    <p class="text-[10px] font-extrabold text-coral-600 uppercase mb-1">Exceptions • ${ui.num(excTotal)}</p>
                    ${excList}
                </div>
            </div>`, { badge: `${ui.num(d.kpis.active)} active` });
    })
});
