// File: admin/widgets/latest-bookings.js

// Sample Live Bookings Data (Ready to be replaced with a Supabase fetch call)
window.latestBookingsData = [
    {
        awb: 'AFC-849201',
        branch: 'Salalah HQ',
        branchCode: 'SLH',
        time: '12 mins ago',
        consignee: 'Abdul Rahman K.P.',
        deliveryMode: 'Door Delivery',
        destinationCountry: 'India',
        destinationCity: 'Kozhikode, Kerala',
        weight: '32.5 kg',
        status: 'Booked',
        statusStyle: 'bg-gray-100 text-gray-800 border-gray-200',
        dotColor: 'bg-gray-700'
    },
    {
        awb: 'AFC-849198',
        branch: 'Muscat',
        branchCode: 'MCT',
        time: '28 mins ago',
        consignee: 'Fathima Suhara',
        deliveryMode: 'Door Delivery',
        destinationCountry: 'India',
        destinationCity: 'Kochi, Kerala',
        weight: '18.0 kg',
        status: 'Consolidated',
        statusStyle: 'bg-coral-50 text-coral-600 border-coral-200/60',
        dotColor: 'bg-coral-500'
    },
    {
        awb: 'AFC-849194',
        branch: 'Salalah HQ',
        branchCode: 'SLH',
        time: '45 mins ago',
        consignee: 'Mohammed Riyas',
        deliveryMode: 'Office Collection',
        destinationCountry: 'United Arab Emirates',
        destinationCity: 'Dubai (Deira)',
        weight: '14.2 kg',
        status: 'In Transit',
        statusStyle: 'bg-amber-50 text-amber-700 border-amber-200/60',
        dotColor: 'bg-amber-500'
    },
    {
        awb: 'AFC-849189',
        branch: 'Sohar',
        branchCode: 'SHR',
        time: '1 hr ago',
        consignee: 'Joseph Mathew',
        deliveryMode: 'Door Delivery',
        destinationCountry: 'India',
        destinationCity: 'Thrissur, Kerala',
        weight: '45.0 kg',
        status: 'Cleared • Break-Bulk',
        statusStyle: 'bg-purple-50 text-purple-700 border-purple-200/60',
        dotColor: 'bg-purple-600'
    },
    {
        awb: 'AFC-849182',
        branch: 'Muscat',
        branchCode: 'MCT',
        time: '2 hrs ago',
        consignee: 'Salim Al-Harthy',
        deliveryMode: 'Office Collection',
        destinationCountry: 'Saudi Arabia',
        destinationCity: 'Riyadh',
        weight: '9.5 kg',
        status: 'Out for Delivery',
        statusStyle: 'bg-blue-50 text-blue-700 border-blue-200/60',
        dotColor: 'bg-blue-500'
    },
    {
        awb: 'AFC-849175',
        branch: 'Salalah HQ',
        branchCode: 'SLH',
        time: '3 hrs ago',
        consignee: 'Nazarudeen V.',
        deliveryMode: 'Door Delivery',
        destinationCountry: 'India',
        destinationCity: 'Mangaluru, KA',
        weight: '27.8 kg',
        status: 'Delivered',
        statusStyle: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
        dotColor: 'bg-emerald-500'
    }
];

window.currentBookingBranchFilter = 'ALL';
window.currentBookingSearchQuery = '';

// Filter Handler for Branch Pills
window.filterLatestBookingsByBranch = function(branchCode) {
    window.currentBookingBranchFilter = branchCode;
    window.updateLatestBookingsTable();
};

// Search Handler for AWB / Consignee / Country
window.searchLatestBookings = function(query) {
    window.currentBookingSearchQuery = query.toLowerCase().trim();
    window.updateLatestBookingsTable();
};

// Render Rows inside the Widget Table
window.getLatestBookingsRowsHTML = function() {
    const filtered = window.latestBookingsData.filter(item => {
        const matchesBranch = window.currentBookingBranchFilter === 'ALL' || item.branchCode === window.currentBookingBranchFilter;
        const matchesSearch = !window.currentBookingSearchQuery || 
            item.awb.toLowerCase().includes(window.currentBookingSearchQuery) ||
            item.consignee.toLowerCase().includes(window.currentBookingSearchQuery) ||
            item.destinationCountry.toLowerCase().includes(window.currentBookingSearchQuery) ||
            item.destinationCity.toLowerCase().includes(window.currentBookingSearchQuery);
        return matchesBranch && matchesSearch;
    });

    if (filtered.length === 0) {
        return `
            <tr>
                <td colspan="5" class="py-10 text-center text-xs text-gray-400 font-medium">
                    No matching bookings found for this filter.
                </td>
            </tr>
        `;
    }

    return filtered.map(item => `
        <tr class="group/row hover:bg-[#F8F8FA] transition-colors border-b border-gray-50 last:border-none">
            <!-- 1. AWB & Originating Branch -->
            <td class="py-3.5 pl-4 pr-3 whitespace-nowrap rounded-l-2xl">
                <div class="flex items-center gap-3">
                    <span class="w-9 h-9 rounded-xl bg-[#F8F8FA] group-hover/row:bg-white border border-gray-100 flex items-center justify-center text-[10px] font-extrabold text-gray-800 shadow-sm">
                        ${item.branchCode}
                    </span>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-extrabold text-gray-900 tracking-tight">${item.awb}</span>
                            <span class="text-[10px] font-semibold text-gray-400">${item.weight}</span>
                        </div>
                        <p class="text-[10px] text-gray-400 font-medium mt-0.5">${item.branch} • ${item.time}</p>
                    </div>
                </div>
            </td>

            <!-- 2. Consignee Name -->
            <td class="py-3.5 px-3 whitespace-nowrap">
                <p class="text-xs font-bold text-gray-900">${item.consignee}</p>
                <p class="text-[10px] font-medium text-gray-400 mt-0.5">${item.deliveryMode}</p>
            </td>

            <!-- 3. Destination Country -->
            <td class="py-3.5 px-3 whitespace-nowrap">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-coral-400"></span>
                    <div>
                        <p class="text-xs font-bold text-gray-900">${item.destinationCountry}</p>
                        <p class="text-[10px] font-medium text-gray-400 mt-0.5">${item.destinationCity}</p>
                    </div>
                </div>
            </td>

            <!-- 4. Current Status -->
            <td class="py-3.5 px-3 whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${item.statusStyle}">
                    <span class="w-1.5 h-1.5 rounded-full ${item.dotColor}"></span>
                    ${item.status}
                </span>
            </td>

            <!-- 5. Quick Action -->
            <td class="py-3.5 pl-3 pr-4 text-right whitespace-nowrap rounded-r-2xl">
                <button class="w-8 h-8 rounded-full bg-[#F8F8FA] group-hover/row:bg-white border border-gray-100 inline-flex items-center justify-center text-gray-500 hover:text-gray-900 hover:border-gray-300 transition-all" title="View Waybill Details">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                </button>
            </td>
        </tr>
    `).join('');
};

window.updateLatestBookingsTable = function() {
    const tbody = document.getElementById('latest-bookings-tbody');
    if (tbody) {
        tbody.innerHTML = window.getLatestBookingsRowsHTML();
    }

    // Update active state on branch filter pills
    ['ALL', 'SLH', 'MCT', 'SHR'].forEach(code => {
        const btn = document.getElementById(`branch-pill-${code}`);
        if (btn) {
            if (window.currentBookingBranchFilter === code) {
                btn.className = 'text-[11px] font-bold text-white bg-[#111827] px-3.5 py-1.5 rounded-full shadow-sm transition-all';
            } else {
                btn.className = 'text-[11px] font-semibold text-gray-600 bg-[#F8F8FA] hover:bg-gray-100 px-3.5 py-1.5 rounded-full border border-gray-100 transition-all';
            }
        }
    });
};

// Register the Widget into the Global Dashboard Engine
window.registerCargoWidget({
    id: 'latest-bookings',
    title: 'Latest Bookings (All Branches)',
    category: 'Operations',
    description: 'Live feed of recent Air Waybills (AWB), consignees, destination countries, and shipment statuses across all branches.',
    colSpan: 'col-span-12',
    render: () => `
        <div class="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)] border border-gray-100/80">
            
            <!-- Widget Header & Controls -->
            <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 mb-4 border-b border-gray-100">
                <div>
                    <div class="flex items-center gap-2.5">
                        <h3 class="text-sm font-extrabold text-gray-900 uppercase tracking-wider">Latest Branch Bookings</h3>
                        <span class="text-[10px] font-bold text-coral-600 bg-coral-50 px-2.5 py-0.5 rounded-full border border-coral-100">Live Feed</span>
                    </div>
                    <p class="text-xs text-gray-400 font-medium mt-0.5">Recent packages booked across Salalah HQ, Muscat, and Sohar</p>
                </div>

                <!-- Right Controls: Search + Branch Filter Pills -->
                <div class="flex flex-wrap items-center gap-2">
                    <!-- Search Input -->
                    <div class="relative flex items-center bg-[#F8F8FA] rounded-full px-3.5 py-1.5 border border-gray-100 focus-within:border-gray-300 focus-within:bg-white transition-all">
                        <svg class="w-3.5 h-3.5 text-gray-400 mr-2" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        <input type="text" 
                            oninput="searchLatestBookings(this.value)" 
                            placeholder="Filter AWB, Consignee, Country..." 
                            class="bg-transparent border-none focus:outline-none text-xs text-gray-700 w-44 placeholder-gray-400">
                    </div>

                    <!-- Branch Filter Pills -->
                    <div class="flex items-center gap-1.5">
                        <button id="branch-pill-ALL" onclick="filterLatestBookingsByBranch('ALL')" class="text-[11px] font-bold text-white bg-[#111827] px-3.5 py-1.5 rounded-full shadow-sm transition-all">
                            All Branches
                        </button>
                        <button id="branch-pill-SLH" onclick="filterLatestBookingsByBranch('SLH')" class="text-[11px] font-semibold text-gray-600 bg-[#F8F8FA] hover:bg-gray-100 px-3.5 py-1.5 rounded-full border border-gray-100 transition-all">
                            Salalah HQ
                        </button>
                        <button id="branch-pill-MCT" onclick="filterLatestBookingsByBranch('MCT')" class="text-[11px] font-semibold text-gray-600 bg-[#F8F8FA] hover:bg-gray-100 px-3.5 py-1.5 rounded-full border border-gray-100 transition-all">
                            Muscat
                        </button>
                        <button id="branch-pill-SHR" onclick="filterLatestBookingsByBranch('SHR')" class="text-[11px] font-semibold text-gray-600 bg-[#F8F8FA] hover:bg-gray-100 px-3.5 py-1.5 rounded-full border border-gray-100 transition-all">
                            Sohar
                        </button>
                    </div>
                </div>
            </div>

            <!-- Neatly Arranged Bookings Table -->
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-gray-100 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                            <th class="pb-3 pl-4 pr-3">AWB & Branch</th>
                            <th class="pb-3 px-3">Consignee Name</th>
                            <th class="pb-3 px-3">Destination Country</th>
                            <th class="pb-3 px-3">Current Status</th>
                            <th class="pb-3 pl-3 pr-4 text-right">Details</th>
                        </tr>
                    </thead>
                    <tbody id="latest-bookings-tbody" class="divide-y divide-gray-50">
                        ${window.getLatestBookingsRowsHTML()}
                    </tbody>
                </table>
            </div>

        </div>
    `
});

// Auto-enable this new widget if the user already has a saved layout in localStorage
(function autoEnableNewBookingsWidget() {
    const STORAGE_KEY = 'alfarha_super_dashboard_widgets_v1';
    const SEEN_KEY = 'alfarha_seen_latest_bookings_v1';
    if (!localStorage.getItem(SEEN_KEY)) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const ids = JSON.parse(saved);
                if (!ids.includes('latest-bookings')) {
                    ids.push('latest-bookings');
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
                }
            } catch (e) {}
        }
        localStorage.setItem(SEEN_KEY, 'true');
    }
})();
