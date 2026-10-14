// File: admin/widgets/latest-bookings.js
window.latestBookingsData = [
    { awb: 'AFC-849201', branch: 'Salalah HQ', branchCode: 'SLH', time: '12 mins ago', consignee: 'Abdul Rahman K.P.', deliveryMode: 'Door Delivery', destinationCountry: 'India', destinationCity: 'Kozhikode, Kerala', weight: '32.5 kg', status: 'Booked', statusStyle: 'bg-gray-100 text-gray-800 border-gray-200', dotColor: 'bg-gray-700' },
    { awb: 'AFC-849198', branch: 'Muscat', branchCode: 'MCT', time: '28 mins ago', consignee: 'Fathima Suhara', deliveryMode: 'Door Delivery', destinationCountry: 'India', destinationCity: 'Kochi, Kerala', weight: '18.0 kg', status: 'Consolidated', statusStyle: 'bg-coral-50 text-coral-600 border-coral-200/60', dotColor: 'bg-coral-500' },
    { awb: 'AFC-849194', branch: 'Salalah HQ', branchCode: 'SLH', time: '45 mins ago', consignee: 'Mohammed Riyas', deliveryMode: 'Office Collection', destinationCountry: 'United Arab Emirates', destinationCity: 'Dubai (Deira)', weight: '14.2 kg', status: 'In Transit', statusStyle: 'bg-amber-50 text-amber-700 border-amber-200/60', dotColor: 'bg-amber-500' },
    { awb: 'AFC-849189', branch: 'Sohar', branchCode: 'SHR', time: '1 hr ago', consignee: 'Joseph Mathew', deliveryMode: 'Door Delivery', destinationCountry: 'India', destinationCity: 'Thrissur, Kerala', weight: '45.0 kg', status: 'Cleared • Break-Bulk', statusStyle: 'bg-purple-50 text-purple-700 border-purple-200/60', dotColor: 'bg-purple-600' },
    { awb: 'AFC-849182', branch: 'Muscat', branchCode: 'MCT', time: '2 hrs ago', consignee: 'Salim Al-Harthy', deliveryMode: 'Office Collection', destinationCountry: 'Saudi Arabia', destinationCity: 'Riyadh', weight: '9.5 kg', status: 'Out for Delivery', statusStyle: 'bg-blue-50 text-blue-700 border-blue-200/60', dotColor: 'bg-blue-500' }
];

window.currentBookingBranchFilter = 'ALL';
window.currentBookingSearchQuery = '';

window.filterLatestBookingsByBranch = function(branchCode) {
    window.currentBookingBranchFilter = branchCode;
    window.renderDashboardWidgets();
};

window.searchLatestBookings = function(query) {
    window.currentBookingSearchQuery = query.toLowerCase().trim();
    const tbody = document.getElementById('latest-bookings-tbody');
    if (tbody) tbody.innerHTML = window.getLatestBookingsRowsHTML();
};

window.getLatestBookingsRowsHTML = function(limit = 5) {
    const filtered = window.latestBookingsData.filter(item => {
        const matchesBranch = window.currentBookingBranchFilter === 'ALL' || item.branchCode === window.currentBookingBranchFilter;
        const matchesSearch = !window.currentBookingSearchQuery || 
            item.awb.toLowerCase().includes(window.currentBookingSearchQuery) ||
            item.consignee.toLowerCase().includes(window.currentBookingSearchQuery) ||
            item.destinationCountry.toLowerCase().includes(window.currentBookingSearchQuery);
        return matchesBranch && matchesSearch;
    }).slice(0, limit);

    return filtered.map(item => `
        <tr class="hover:bg-[#F8F8FA] transition-colors border-b border-gray-50 last:border-none">
            <td class="py-3 pl-3 pr-2 whitespace-nowrap">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-[#F8F8FA] border border-gray-100 flex items-center justify-center text-[10px] font-extrabold text-gray-800">${item.branchCode}</span>
                    <div>
                        <span class="text-xs font-extrabold text-gray-900">${item.awb}</span>
                        <p class="text-[10px] text-gray-400">${item.branch} • ${item.time}</p>
                    </div>
                </div>
            </td>
            <td class="py-3 px-2 whitespace-nowrap">
                <p class="text-xs font-bold text-gray-900">${item.consignee}</p>
                <p class="text-[10px] text-gray-400">${item.deliveryMode}</p>
            </td>
            <td class="py-3 px-2 whitespace-nowrap">
                <p class="text-xs font-bold text-gray-900">${item.destinationCountry}</p>
                <p class="text-[10px] text-gray-400">${item.destinationCity}</p>
            </td>
            <td class="py-3 px-2 whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${item.statusStyle}">
                    <span class="w-1.5 h-1.5 rounded-full ${item.dotColor}"></span>
                    ${item.status}
                </span>
            </td>
        </tr>
    `).join('');
};

window.registerCargoWidget({
    id: 'latest-bookings',
    title: 'Latest Bookings (All Branches)',
    category: 'Operations',
    description: 'Live feed of recent Air Waybills (AWB), consignees, destination countries, and statuses.',
    defaultSize: '4x2',
    allowedSizes: ['2x2', '2x3', '3x2', '4x2'],
    render: (size = '4x2') => {
        const rowLimit = size === '2x3' ? 6 : 4;
        return `
            <div class="h-full bg-white rounded-[2rem] p-6 border border-gray-100/80 flex flex-col justify-between overflow-hidden">
                <div class="flex flex-wrap items-center justify-between gap-3 pb-3 mb-2 border-b border-gray-100">
                    <div class="flex items-center gap-2">
                        <h3 class="text-xs font-extrabold text-gray-900 uppercase tracking-wider">Latest Branch Bookings</h3>
                        <span class="text-[10px] font-bold text-coral-600 bg-coral-50 px-2.5 py-0.5 rounded-full">Live Feed</span>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                        ${['ALL', 'SLH', 'MCT', 'SHR'].map(code => `
                            <button onclick="filterLatestBookingsByBranch('${code}')" 
                                class="text-[10px] font-bold px-3 py-1 rounded-full transition-all ${window.currentBookingBranchFilter === code ? 'bg-[#111827] text-white' : 'bg-[#F8F8FA] text-gray-600 hover:bg-gray-100'}">
                                ${code === 'ALL' ? 'All' : code}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="overflow-y-auto flex-1 custom-scrollbar">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="border-b border-gray-100 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                                <th class="pb-2 pl-3 pr-2">AWB & Branch</th>
                                <th class="pb-2 px-2">Consignee</th>
                                <th class="pb-2 px-2">Destination</th>
                                <th class="pb-2 px-2">Current Status</th>
                            </tr>
                        </thead>
                        <tbody id="latest-bookings-tbody">
                            ${window.getLatestBookingsRowsHTML(rowLimit)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
});
