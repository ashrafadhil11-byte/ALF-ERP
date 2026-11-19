// Every signed-in page, where it lives today (old) and where its React version lives (new; null = not converted yet).
// Phase by phase, fill in `new` as pages are converted.
export const PAGES = [
    { name: 'super-dashboard', old: '/admin/super-dashboard.html', new: '/app/super-dashboard' },
    { name: 'shipments', old: '/admin/shipments.html', new: '/app/shipments' },
    { name: 'booking', old: '/admin/booking.html', new: '/app/booking' },
    { name: 'status-update', old: '/admin/status-update.html', new: '/app/status-update' },
    { name: 'delivery', old: '/admin/delivery.html', new: '/app/delivery' },
    { name: 'consolidation', old: '/admin/consolidation.html', new: '/app/consolidation' },
    { name: 'customers', old: '/admin/customers.html', new: '/app/customers' },
    { name: 'crm', old: '/admin/crm.html', new: '/app/crm' },
    { name: 'accounts', old: '/admin/accounts.html', new: '/app/accounts' },
    { name: 'warehouse', old: '/admin/warehouse.html', new: '/app/warehouse' },
    { name: 'attendance', old: '/admin/attendance.html', new: '/app/attendance' },
    { name: 'create-user', old: '/admin/create-user.html', new: '/app/create-user' },
    { name: 'branches', old: '/admin/branches.html', new: '/app/branches' },
    { name: 'integrations', old: '/admin/integrations.html', new: '/app/integrations' },
    { name: 'activity', old: '/admin/activity.html', new: '/app/activity' }
];

export const SIZES = [
    { name: 'desktop', width: 1366, height: 800 },
    { name: 'phone', width: 375, height: 812, isMobile: true, hasTouch: true }
];
