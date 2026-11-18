// Every page of the ERP and where it lives. While the migration runs, a page links to its React route
// once it is converted and approved (`react: true`), and to the old /admin/*.html page until then.
export type PageFile =
    | 'super-dashboard.html' | 'shipments.html' | 'booking.html' | 'status-update.html' | 'delivery.html'
    | 'consolidation.html' | 'customers.html' | 'crm.html' | 'accounts.html' | 'warehouse.html'
    | 'attendance.html' | 'create-user.html' | 'branches.html' | 'integrations.html' | 'activity.html';

type Page = { file: PageFile; path: string; react: boolean };

export const PAGES: Page[] = ([
    'super-dashboard', 'shipments', 'booking', 'status-update', 'delivery', 'consolidation', 'customers', 'crm',
    'accounts', 'warehouse', 'attendance', 'create-user', 'branches', 'integrations', 'activity'
] as const).map(name => ({ file: `${name}.html` as PageFile, path: `/${name}`, react: false }));

/** Converted pages (flip `react` to true here when a page is approved). */
// Keep in step with REACT_PAGES in admin/components/sidebar.js (the old pages' menu).
export const CONVERTED = new Set<PageFile>(['activity.html', 'crm.html', 'status-update.html', 'customers.html', 'integrations.html', 'super-dashboard.html', 'attendance.html', 'warehouse.html', 'create-user.html', 'delivery.html']);
PAGES.forEach(p => { p.react = CONVERTED.has(p.file); });

export const pageByFile = (file: string) => PAGES.find(p => p.file === file);
export const pageByPath = (path: string) => PAGES.find(p => p.path === path);
/** Where a link to this page goes right now. */
export const hrefFor = (file: PageFile): { to: string } | { href: string } => {
    const p = pageByFile(file)!;
    return p.react ? { to: p.path } : { href: `/admin/${p.file}` };
};
