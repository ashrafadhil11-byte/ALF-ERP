// File: admin/widgets/integrations-health.js — status of 3rd-party APIs (admins).
window.registerCargoWidget({
    id: 'integrations-health',
    title: '3rd-Party API Health',
    category: 'System',
    description: 'Order source and carrier APIs: active, last check and errors.',
    defaultSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x2'],
    roles: ['super_admin', 'head_office'],
    render: withDash((d, size, ui) => {
        const list = d.integrations || [];
        const live = list.filter(i => i.active).length;
        const errors = list.filter(i => i.active && i.last_status === 'error').length;
        if (size === '1x1') {
            return ui.card('APIs', `
                <div class="mt-auto">
                    <p class="text-2xl font-extrabold">${live}<span class="text-xs text-gray-400 font-semibold">/${list.length} live</span></p>
                    <p class="text-[10px] font-bold ${errors ? 'text-coral-500' : 'text-emerald-600'} mt-1">${errors ? `${errors} with errors` : 'All healthy'}</p>
                </div>`, { pad: 'p-5' });
        }
        const dot = (i) => !i.active ? 'bg-gray-300' : i.last_status === 'error' ? 'bg-coral-500' : i.last_status === 'ok' ? 'bg-emerald-500' : 'bg-amber-400';
        return ui.card('3rd-Party APIs', `
            <div class="space-y-2 overflow-y-auto custom-scrollbar flex-1">
                ${list.length ? list.map(i => `
                    <div class="bg-[#F8F8FA] rounded-2xl px-4 py-2.5 border border-gray-100" title="${ui.esc(i.last_error || '')}">
                        <span class="flex items-center gap-2 text-xs font-extrabold truncate"><span class="w-2 h-2 rounded-full flex-shrink-0 ${dot(i)}"></span>${ui.esc(i.name)}</span>
                        <p class="text-[10px] text-gray-400 mt-0.5 truncate"><span class="font-bold uppercase">${ui.esc(i.kind.replace('_', ' '))}</span> • ${i.active ? (i.last_sync_at ? `Checked ${ui.ago(i.last_sync_at)}${i.last_error ? ' • ' + ui.esc(i.last_error) : ''}` : 'Never checked') : 'Inactive'}</p>
                    </div>`).join('') : ui.empty('No integrations configured.')}
            </div>
            <a href="integrations.html" class="mt-3 text-center text-[11px] font-bold text-coral-500 hover:text-coral-600">Manage integrations →</a>`, { badge: `${live} live` });
    })
});
