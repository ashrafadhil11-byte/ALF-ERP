// Helpers every dashboard widget uses so they look the same — same as window.dashUI in admin/widgets/dashboard-data.js.
import type { ReactNode } from 'react';

const STAGE_NAMES = ['', 'Booking', 'Pickup', 'Origin', 'Export', 'Transit', 'Destination', 'Last Mile', 'Delivered', 'Review'];

export type Dash = {
    scope: string;
    me?: { role?: string; is_driver?: boolean };
    kpis: { active: number; today_count: number; today_kg: number; yesterday_count: number; month_count: number; month_kg: number; last_month_count: number; exceptions: number; pending_inbound: number; active_consolidations: number };
    revenue?: { currency: string; today: number; month: number }[];
    pipeline?: { stage: number; count: number }[];
    exceptions?: { code: string; label: string; count: number }[];
    branches: { branch_code: string; branch_name?: string; branch_status?: string; today: number; month: number; month_kg: number; active: number; events_today: number }[];
    daily?: { day: string; count: number }[];
    latest?: { awb: string; branch_code?: string; consignee?: string; dest_city?: string; dest_country?: string; current_status?: string; current_status_code?: string; booked_at?: string }[];
    sla?: { avg_days_to_deliver?: number | null; delivered_month?: number; overdue_10d?: number };
    staff_today?: { name: string; updates: number }[];
    integrations?: { name: string; kind: string; active: boolean; last_status?: string; last_error?: string; last_sync_at?: string }[];
};

export const ui = {
    stageName: (s: number) => STAGE_NAMES[s] || `Stage ${s}`,
    num: (v: unknown, d = 0) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }),
    kg: (v: unknown) => {
        const n = Number(v || 0);
        return n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} Tons` : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} kg`;
    },
    pct: (now: number, before: number) => {
        if (!before) return now ? { text: 'New', cls: 'text-emerald-600' } : { text: '—', cls: 'text-gray-400' };
        const p = ((now - before) / before) * 100;
        return { text: `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`, cls: p >= 0 ? 'text-emerald-600' : 'text-coral-500' };
    },
    ago: (iso?: string) => {
        if (!iso) return '—';
        const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m} min ago`;
        if (m < 1440) return `${Math.round(m / 60)} hr ago`;
        return `${Math.round(m / 1440)} d ago`;
    },
    scopeLabel: (d: Dash | null) => !d ? '…' : d.scope === 'ALL' ? 'All Branches' : d.scope
};

/** Card shell used by every widget. */
export function Card({ title, badge = '', dark = false, pad = 'p-6', children }: { title: string; badge?: string; dark?: boolean; pad?: string; children: ReactNode }) {
    return (
        <div className={`h-full ${dark ? 'bg-[#111827] text-white' : 'bg-white'} rounded-[2rem] ${pad} border ${dark ? 'border-gray-800' : 'border-gray-100/80'} flex flex-col gap-3 overflow-hidden`}>
            <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1.5 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-extrabold ${dark ? 'text-white' : 'text-gray-900'} tracking-wider text-xs uppercase whitespace-nowrap`}>{title}</span>
                    <span className="w-2 h-2 rounded-full bg-coral-500 flex-shrink-0"></span>
                </div>
                {badge && <span className={`text-[10px] font-semibold ${dark ? 'text-gray-300 bg-gray-800 border-gray-700' : 'text-gray-600 bg-[#F8F8FA] border-gray-100'} px-2.5 py-1 rounded-full border flex-shrink-0`}>{badge}</span>}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </div>
    );
}
export const Loading = () => <div className="h-full bg-white rounded-[2rem] border border-gray-100/80 flex items-center justify-center"><span className="text-xs font-bold text-gray-300 animate-pulse">Loading live data…</span></div>;
export const Empty = ({ msg }: { msg: string }) => <div className="flex-1 flex items-center justify-center text-center px-4"><p className="text-xs text-gray-400 font-medium">{msg}</p></div>;
