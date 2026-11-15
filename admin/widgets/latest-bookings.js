// File: admin/widgets/latest-bookings.js — live feed of the newest bookings (all roles, scoped by branch).
window.latestBookingsQuery = '';

window.searchLatestBookings = function (q) {
    window.latestBookingsQuery = String(q || '').toLowerCase().trim();
    const tbody = document.getElementById('latest-bookings-tbody');
    if (tbody && window.DASH) tbody.innerHTML = window.latestBookingsRows(window.DASH.latest || []);
};

window.latestBookingsRows = function (list) {
    const ui = window.dashUI, q = window.latestBookingsQuery;
    const rows = list.filter(b => !q || [b.awb, b.consignee, b.dest_country, b.dest_city, b.branch_code].some(v => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) return `<tr><td colspan="6" class="py-8 text-center text-xs text-gray-400">${list.length ? 'No match.' : 'No bookings yet — they appear here as soon as orders are imported.'}</td></tr>`;
    return rows.map(b => `
        <tr class="hover:bg-[#F8F8FA]">
            <td class="py-2.5 pl-2 font-extrabold">${ui.esc(b.awb)}</td>
            <td class="py-2.5"><span class="text-[10px] font-bold bg-[#F8F8FA] border border-gray-100 px-2 py-0.5 rounded-full">${ui.esc(b.branch_code || '—')}</span></td>
            <td class="py-2.5 truncate max-w-[160px]">${ui.esc(b.consignee || '—')}</td>
            <td class="py-2.5 text-gray-500">${ui.esc([b.dest_city, b.dest_country].filter(Boolean).join(', ') || '—')}</td>
            <td class="py-2.5"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${b.current_status_code === 'DELIVERED' ? 'bg-emerald-50 text-emerald-700' : 'bg-coral-50 text-coral-600'}">${ui.esc(b.current_status || 'New')}</span></td>
            <td class="py-2.5 pr-2 text-right text-gray-400 whitespace-nowrap">${ui.ago(b.booked_at)}</td>
        </tr>`).join('');
};

window.registerCargoWidget({
    id: 'latest-bookings',
    title: 'Latest Bookings',
    category: 'Operations',
    description: 'Newest AWBs with consignee, destination, branch and current status.',
    defaultSize: '4x2',
    allowedSizes: ['2x2', '2x3', '3x2', '4x2'],
    render: withDash((d, size, ui) => ui.card('Latest Bookings', `
        <input type="search" placeholder="Search AWB, consignee, country…" value="${ui.esc(window.latestBookingsQuery)}"
               oninput="searchLatestBookings(this.value)"
               class="w-full mb-3 px-4 py-2.5 bg-[#F8F8FA] border border-gray-100 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-coral-500">
        <div class="overflow-auto custom-scrollbar flex-1">
            <table class="w-full text-xs">
                <thead><tr class="text-[10px] text-gray-400 uppercase text-left">
                    <th class="pb-2 pl-2 font-extrabold">AWB</th><th class="pb-2 font-extrabold">Branch</th><th class="pb-2 font-extrabold">Consignee</th>
                    <th class="pb-2 font-extrabold">Destination</th><th class="pb-2 font-extrabold">Status</th><th class="pb-2 pr-2 font-extrabold text-right">Booked</th>
                </tr></thead>
                <tbody id="latest-bookings-tbody" class="divide-y divide-gray-100">${window.latestBookingsRows(d.latest || [])}</tbody>
            </table>
        </div>`, { badge: ui.scopeLabel() }))
});
