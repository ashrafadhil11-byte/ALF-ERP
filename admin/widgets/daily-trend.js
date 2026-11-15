// File: admin/widgets/daily-trend.js — bookings per day, last 14 days (all roles).
window.registerCargoWidget({
    id: 'daily-trend',
    title: 'Booking Trend (14 days)',
    category: 'Operations',
    description: 'Bookings per day over the last two weeks.',
    defaultSize: '2x1',
    allowedSizes: ['2x1', '2x2', '4x2'],
    render: withDash((d, size, ui) => {
        const days = d.daily || [];
        const max = Math.max(1, ...days.map(x => x.count));
        const total = days.reduce((s, x) => s + x.count, 0);
        return ui.card('Booking Trend', `
            <div class="flex items-end gap-1.5 flex-1 min-h-[60px]">
                ${days.map((x, i) => {
                    const dt = new Date(x.day + 'T00:00:00');
                    const isToday = i === days.length - 1;
                    return `<div class="flex-1 flex flex-col items-center justify-end h-full gap-1" title="${dt.toDateString()}: ${x.count}">
                        ${size !== '2x1' ? `<span class="text-[9px] font-bold text-gray-500">${x.count || ''}</span>` : ''}
                        <div class="w-full rounded-lg ${isToday ? 'bg-coral-500' : x.count ? 'bg-[#111827]' : 'bg-gray-100'}" style="height:${Math.max(4, (x.count / max) * 100)}%"></div>
                        <span class="text-[8px] font-bold ${isToday ? 'text-coral-500' : 'text-gray-400'}">${dt.getDate()}</span>
                    </div>`;
                }).join('')}
            </div>`, { badge: `${ui.num(total)} AWBs`, pad: size === '2x1' ? 'p-5' : 'p-6' });
    })
});
