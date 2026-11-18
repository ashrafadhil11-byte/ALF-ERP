// The dashboard widgets — same content, sizes and roles as admin/widgets/*.js. Order = the old script order.
// Texts that mix values and words are built as one string so they render exactly like the old pages.
import type { ReactNode } from 'react';
import { PageLink } from '../../components/PageLink';
import { Card, Empty, ui, type Dash } from './ui';

export type WidgetDef = {
    id: string; title: string; category: string; description: string; defaultSize: string; allowedSizes: string[]; roles?: string[];
    render: (d: Dash, size: string, ctx: { query: string; setQuery: (q: string) => void }) => ReactNode;
};

const Shipments: WidgetDef['render'] = (d, size) => {
    const k = d.kpis;
    const mom = ui.pct(k.month_count, k.last_month_count);
    const dod = ui.pct(k.today_count, k.yesterday_count);
    const days = new Date().getDate();
    if (size === '1x1') return (
        <Card title="Shipments" pad="p-5">
            <div className="mt-auto">
                <p className="text-2xl font-extrabold text-gray-900">{ui.num(k.month_count)}</p>
                <p className={`text-[10px] font-bold ${dod.cls} mt-0.5`}>{`Today: ${ui.num(k.today_count)} AWBs (${dod.text})`}</p>
            </div>
        </Card>
    );
    if (size === '2x1') return (
        <Card title={`Shipments • ${ui.scopeLabel(d)}`} pad="p-5">
            <div className="flex items-center justify-between gap-4 my-auto">
                <div>
                    <p className="text-2xl font-extrabold text-gray-900">{ui.num(k.month_count) + ' '}<span className="text-xs font-semibold text-gray-400">AWBs this month</span></p>
                    <span className={`text-[10px] font-bold ${mom.cls}`}>{`${mom.text} vs last month`}</span>
                </div>
                <div className="flex gap-2.5">
                    <div className="bg-[#111827] text-white rounded-2xl px-4 py-2.5"><span className="text-[9px] text-gray-400 uppercase block">Today</span><span className="text-base font-extrabold">{ui.num(k.today_count)}</span></div>
                    <div className="bg-[#F8F8FA] rounded-2xl px-4 py-2.5 border border-gray-100"><span className="text-[9px] text-gray-400 uppercase block">Active</span><span className="text-base font-extrabold">{ui.num(k.active)}</span></div>
                </div>
            </div>
        </Card>
    );
    const todayTrend = dod.cls === 'text-coral-500' ? 'text-coral-400' : 'text-emerald-400';
    return (
        <Card title="Shipments Overview" badge={ui.scopeLabel(d)}>
            <div className="my-1">
                <p className="text-xs text-gray-400 font-medium mb-1">Active AWBs (not yet delivered)</p>
                <div className="flex items-baseline gap-3 flex-wrap">
                    <p className="text-3xl font-extrabold text-gray-900 tracking-tight">{ui.num(k.active) + ' '}<span className="text-sm font-semibold text-gray-400">AWBs</span></p>
                    <span className={`text-xs font-bold ${mom.cls} bg-[#F8F8FA] px-2 py-0.5 rounded-full`}>{`${mom.text} vs last mo`}</span>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3 my-2">
                <div className="bg-[#111827] text-white rounded-2xl p-3.5">
                    <div className="flex justify-between items-center mb-1.5"><span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Today</span><span className={`text-[10px] font-bold ${todayTrend}`}>{dod.text}</span></div>
                    <p className="text-xl font-extrabold leading-none">{ui.num(k.today_count) + ' '}<span className="text-[11px] font-normal text-gray-300">Bookings</span></p>
                    <p className="text-[10px] text-gray-400 mt-1.5">{ui.kg(k.today_kg)}</p>
                </div>
                <div className="bg-[#F8F8FA] rounded-2xl p-3.5 border border-gray-100">
                    <div className="flex justify-between items-center mb-1.5"><span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">This Month</span><span className={`text-[10px] font-bold ${mom.cls}`}>{mom.text}</span></div>
                    <p className="text-xl font-extrabold leading-none">{ui.num(k.month_count) + ' '}<span className="text-[11px] font-normal text-gray-500">Bookings</span></p>
                    <p className="text-[10px] text-gray-400 mt-1.5">{ui.kg(k.month_kg)}</p>
                </div>
            </div>
            {size === '2x3' && d.branches.length > 1 && (
                <div className="bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100 space-y-2">
                    <p className="text-[10px] font-extrabold text-gray-400 uppercase">Branch split today</p>
                    {d.branches.slice(0, 5).map(b => <div key={b.branch_code} className="flex justify-between text-xs font-bold"><span>{b.branch_name || b.branch_code}</span><span>{`${ui.num(b.today)} AWBs`}</span></div>)}
                </div>
            )}
            <div className="flex justify-between items-end border-t border-gray-100 pt-3 mt-auto">
                <div>
                    <p className="text-[11px] text-gray-400 font-medium">Daily average (this month)</p>
                    <p className="text-base font-extrabold text-gray-900">{ui.num(k.month_count / days, 1) + ' '}<span className="text-xs font-semibold text-gray-400">/ day</span></p>
                </div>
                <span className="text-coral-500 text-[11px] font-bold">{`${ui.num(k.exceptions)} exceptions`}</span>
            </div>
        </Card>
    );
};

const Financials: WidgetDef['render'] = (d, size) => {
    const rev = d.revenue || [];
    if (!rev.length) return <Card title="Revenue" badge={ui.scopeLabel(d)}><Empty msg="No booking amounts yet. Revenue appears here once bookings carry a charge (Financials module)." /></Card>;
    const main = rev[0];
    if (size === '1x1') return (
        <Card title="Revenue" pad="p-5">
            <div className="mt-auto">
                <p className="text-xl font-extrabold text-gray-900"><span className="text-coral-500 text-xs mr-0.5">{main.currency}</span>{ui.num(main.month, 2)}</p>
                <p className="text-[10px] font-bold text-emerald-600 mt-1">{`Today: ${main.currency} ${ui.num(main.today, 2)}`}</p>
            </div>
        </Card>
    );
    return (
        <Card title="Revenue" badge={ui.scopeLabel(d)}>
            <div className={`flex ${size === '2x1' ? 'flex-row' : 'flex-col'} gap-3 flex-1`}>
                {rev.slice(0, size === '2x2' ? 4 : 2).map(r => (
                    <div key={r.currency} className="bg-[#F8F8FA] rounded-2xl p-4 border border-gray-100 flex-1 flex flex-col justify-between">
                        <div className="flex justify-between items-center">
                            <div className="w-7 h-7 rounded-full bg-white border border-gray-100 flex justify-center items-center font-bold text-[9px]">{r.currency}</div>
                            <span className="text-[10px] font-bold text-gray-500">Month to date</span>
                        </div>
                        <div>
                            <p className="text-xl font-extrabold text-gray-900"><span className="text-coral-500 font-semibold text-xs mr-0.5">{r.currency}</span>{ui.num(r.month, 2)}</p>
                            <p className="text-[10px] text-gray-500 font-bold mt-1">{`Today: ${r.currency} ${ui.num(r.today, 2)}`}</p>
                        </div>
                    </div>
                ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Costs, margin and collections arrive with the Financials module.</p>
        </Card>
    );
};

const Sla: WidgetDef['render'] = (d, size) => {
    const s = d.sla || {};
    const staff = d.staff_today || [];
    const max = Math.max(1, ...staff.map(x => x.updates));
    const avg = s.avg_days_to_deliver == null ? '—' : ui.num(s.avg_days_to_deliver, 1);
    if (size === '1x1') return (
        <Card title="SLA" pad="p-5">
            <div className="mt-auto">
                <p className="text-2xl font-extrabold">{avg}<span className="text-xs text-gray-400 font-semibold"> days avg</span></p>
                <p className="text-[10px] font-bold text-coral-500 mt-1">{`${ui.num(s.overdue_10d)} overdue >10 days`}</p>
            </div>
        </Card>
    );
    return (
        <Card title="SLA & Staff" badge="This month">
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#111827] text-white rounded-2xl p-3"><p className="text-[9px] text-gray-400 uppercase">Avg days</p><p className="text-lg font-extrabold">{avg}</p></div>
                <div className="bg-[#F8F8FA] rounded-2xl p-3 border border-gray-100"><p className="text-[9px] text-gray-400 uppercase">Delivered</p><p className="text-lg font-extrabold">{ui.num(s.delivered_month)}</p></div>
                <div className="bg-coral-50 rounded-2xl p-3 border border-coral-100"><p className="text-[9px] text-coral-600 uppercase">Overdue</p><p className="text-lg font-extrabold text-coral-600">{ui.num(s.overdue_10d)}</p></div>
            </div>
            <p className="text-[10px] font-extrabold text-gray-400 uppercase mt-3 mb-2">Status updates today</p>
            <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                {staff.length ? staff.slice(0, size === '2x2' ? 8 : 4).map(x => (
                    <div key={x.name} className="flex items-center gap-2 text-xs">
                        <span className="w-24 truncate font-bold text-gray-700">{x.name}</span>
                        <div className="flex-1 h-2 bg-[#F8F8FA] rounded-full overflow-hidden"><div className="h-full bg-coral-500 rounded-full" style={{ width: `${(x.updates / max) * 100}%` }}></div></div>
                        <span className="w-8 text-right font-extrabold">{x.updates}</span>
                    </div>
                )) : <Empty msg="No status updates yet today." />}
            </div>
        </Card>
    );
};

const Velocity: WidgetDef['render'] = (d, size) => {
    const k = d.kpis;
    if (size === '1x1') return (
        <Card title="MAWB Lots" pad="p-5">
            <div className="mt-auto">
                <p className="text-2xl font-extrabold">{ui.num(k.active_consolidations)}</p>
                <p className="text-[10px] font-bold text-gray-500 mt-1">{`${ui.kg(k.month_kg)} this month`}</p>
            </div>
        </Card>
    );
    const tile = (label: string, value: string, sub: string, dark = false) => (
        <div key={label} className={`${dark ? 'bg-[#111827] text-white' : 'bg-[#F8F8FA] border border-gray-100'} rounded-2xl p-4 flex-1 flex flex-col justify-between`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-extrabold leading-tight">{value}</p>
            <p className={`text-[10px] ${dark ? 'text-gray-400' : 'text-gray-500'} font-bold`}>{sub}</p>
        </div>
    );
    return (
        <Card title="Cargo Flow" badge={ui.scopeLabel(d)}>
            <div className={`flex ${size === '2x1' ? 'flex-row' : 'flex-col'} gap-3 flex-1`}>
                {tile('Open MAWB lots', ui.num(k.active_consolidations), 'Not yet delivered', true)}
                {tile('Tonnage this month', ui.kg(k.month_kg), `Today: ${ui.kg(k.today_kg)}`)}
                {size !== '1x2' && tile('Inbound pending', ui.num(k.pending_inbound), 'Transfers to receive')}
            </div>
        </Card>
    );
};

const Share: WidgetDef['render'] = (d, size) => {
    const rows = (d.branches || []).filter(b => b.month > 0).slice(0, 4);
    const total = rows.reduce((s, b) => s + b.month, 0);
    if (!total) return <Card title="Branch Share" badge="This month"><Empty msg="No bookings this month yet." /></Card>;
    const colors = ['#E86D58', '#111827', '#F7A99A', '#9CA3AF'];
    if (size === '1x1') {
        const top = rows[0];
        return (
            <Card title="Top Branch" pad="p-5">
                <div className="mt-auto">
                    <p className="text-lg font-extrabold truncate">{top.branch_name || top.branch_code}</p>
                    <p className="text-[10px] font-bold text-coral-500 mt-1">{`${Math.round((top.month / total) * 100)}% of ${ui.num(total)} AWBs`}</p>
                </div>
            </Card>
        );
    }
    return (
        <Card title="Share" badge="This month">
            <div className={`flex ${size === '2x2' ? 'flex-row items-center' : 'flex-col'} gap-4 flex-1 justify-center`}>
                <svg viewBox="0 0 160 160" className="w-32 h-32 mx-auto flex-shrink-0" role="img" aria-label="Branch share of bookings">
                    {rows.map((b, i) => {
                        const r = 70 - i * 15, c = 2 * Math.PI * r, frac = b.month / total;
                        return <g key={b.branch_code}><circle cx="80" cy="80" r={r} fill="none" stroke="#F3F4F6" strokeWidth="10" />
                            <circle cx="80" cy="80" r={r} fill="none" stroke={colors[i]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 80 80)" /></g>;
                    })}
                    <text x="80" y="78" textAnchor="middle" className="font-extrabold" fontSize="18" fill="#111827">{ui.num(total)}</text>
                    <text x="80" y="94" textAnchor="middle" fontSize="8" fill="#9CA3AF">AWBs</text>
                </svg>
                <div className="space-y-1.5 flex-1">
                    {rows.map((b, i) => (
                        <div key={b.branch_code} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 font-bold text-gray-700 truncate"><span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors[i] }}></span>{b.branch_name || b.branch_code}</span>
                            <span className="font-extrabold">{`${Math.round((b.month / total) * 100)}%`}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
};

const Pipeline: WidgetDef['render'] = (d, size) => {
    const byStage: Record<number, number> = Object.fromEntries((d.pipeline || []).map(p => [p.stage, p.count]));
    const stages = [1, 2, 3, 4, 5, 6, 7];
    const max = Math.max(1, ...stages.map(s => byStage[s] || 0));
    const exc = d.exceptions || [];
    const excTotal = exc.reduce((s, e) => s + e.count, 0);
    if (size === '2x1') return (
        <Card title="Pipeline" pad="p-5">
            <div className="flex gap-1.5 flex-1 items-end">
                {stages.map(s => (
                    <div key={s} className="flex-1 text-center">
                        <p className="text-sm font-extrabold">{ui.num(byStage[s] || 0)}</p>
                        <p className="text-[8px] font-bold text-gray-400 uppercase truncate">{ui.stageName(s)}</p>
                    </div>
                ))}
                <div className="flex-1 text-center bg-coral-50 rounded-xl py-1"><p className="text-sm font-extrabold text-coral-600">{ui.num(excTotal)}</p><p className="text-[8px] font-bold text-coral-500 uppercase">Hold</p></div>
            </div>
        </Card>
    );
    const wide = size === '3x2' || size === '4x2';
    return (
        <Card title="Shipment Pipeline" badge={`${ui.num(d.kpis.active)} active`}>
            <div className={`flex ${wide ? 'flex-row' : 'flex-col'} gap-4 flex-1 min-h-0`}>
                <div className="flex gap-2 flex-1 min-h-[120px] items-stretch">
                    {stages.map(s => {
                        const n = byStage[s] || 0;
                        return (
                            <div key={s} className="flex-1 flex flex-col items-center justify-end gap-1.5 min-w-0">
                                <span className="text-xs font-extrabold">{ui.num(n)}</span>
                                <div className={`w-full max-w-[42px] rounded-xl ${n ? 'bg-[#111827]' : 'bg-gray-100'}`} style={{ height: `${Math.max(6, (n / max) * 100)}%` }}></div>
                                <span className="text-[9px] font-bold text-gray-400 uppercase truncate w-full text-center">{ui.stageName(s)}</span>
                            </div>
                        );
                    })}
                </div>
                <div className={`${wide ? 'w-56' : ''} bg-coral-50/60 rounded-2xl p-4 border border-coral-100 space-y-1.5 overflow-y-auto custom-scrollbar`}>
                    <p className="text-[10px] font-extrabold text-coral-600 uppercase mb-1">{`Exceptions • ${ui.num(excTotal)}`}</p>
                    {exc.length ? exc.map(e => <div key={e.code} className="flex justify-between text-xs"><span className="font-bold text-gray-700 truncate">{e.label}</span><span className="font-extrabold text-coral-600">{ui.num(e.count)}</span></div>)
                        : <p className="text-xs text-gray-400">No exceptions — all on track.</p>}
                </div>
            </div>
        </Card>
    );
};

const Efficiency: WidgetDef['render'] = (d, size) => {
    const rows = d.branches || [];
    if (!rows.length) return <Card title="Branches"><Empty msg="No branches yet. Add them in Branch Network." /></Card>;
    if (size === '1x1') {
        const busiest = rows.reduce((a, b) => (b.today > a.today ? b : a), rows[0]);
        return (
            <Card title="Busiest Today" pad="p-5">
                <div className="mt-auto">
                    <p className="text-lg font-extrabold truncate">{busiest.branch_name || busiest.branch_code}</p>
                    <p className="text-[10px] font-bold text-gray-500 mt-1">{`${ui.num(busiest.today)} AWBs • ${ui.num(busiest.events_today)} updates`}</p>
                </div>
            </Card>
        );
    }
    if (size === '1x2' || size === '2x1') return (
        <Card title="Branch Performance" badge={`${rows.length} branches`}>
            <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1">
                {rows.map(b => (
                    <div key={b.branch_code} className="bg-[#F8F8FA] rounded-2xl px-4 py-2.5 border border-gray-100 flex justify-between items-center">
                        <div className="min-w-0"><p className="text-xs font-extrabold truncate">{b.branch_name || b.branch_code}</p><p className="text-[10px] text-gray-400 font-bold">{b.branch_code}</p></div>
                        <div className="text-right"><p className="text-sm font-extrabold">{ui.num(b.today)}</p><p className="text-[9px] text-gray-400 uppercase font-bold">today</p></div>
                    </div>
                ))}
            </div>
        </Card>
    );
    return (
        <Card title="Branch Performance" badge={`${rows.length} branches`}>
            <div className="overflow-auto custom-scrollbar flex-1">
                <table className="w-full text-xs">
                    <thead><tr className="text-[10px] text-gray-400 uppercase text-left">
                        <th className="pb-2 font-extrabold">Branch</th><th className="pb-2 font-extrabold text-right">Today</th>
                        <th className="pb-2 font-extrabold text-right">Month</th><th className="pb-2 font-extrabold text-right">Weight</th>
                        <th className="pb-2 font-extrabold text-right">Active</th><th className="pb-2 font-extrabold text-right">Updates</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                        {rows.map(b => (
                            <tr key={b.branch_code}>
                                <td className="py-2.5"><p className="font-extrabold">{b.branch_name || b.branch_code}</p><p className="text-[10px] text-gray-400">{`${b.branch_code} • ${b.branch_status || ''}`}</p></td>
                                <td className="py-2.5 text-right font-extrabold">{ui.num(b.today)}</td>
                                <td className="py-2.5 text-right font-bold">{ui.num(b.month)}</td>
                                <td className="py-2.5 text-right text-gray-500">{ui.kg(b.month_kg)}</td>
                                <td className="py-2.5 text-right font-bold">{ui.num(b.active)}</td>
                                <td className="py-2.5 text-right"><span className="bg-coral-50 text-coral-600 font-extrabold px-2 py-0.5 rounded-full">{ui.num(b.events_today)}</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};

const Latest: WidgetDef['render'] = (d, _size, { query, setQuery }) => {
    const list = d.latest || [];
    const q = query.toLowerCase().trim();
    const rows = list.filter(b => !q || [b.awb, b.consignee, b.dest_country, b.dest_city, b.branch_code].some(v => String(v || '').toLowerCase().includes(q)));
    return (
        <Card title="Latest Bookings" badge={ui.scopeLabel(d)}>
            <input type="search" placeholder="Search AWB, consignee, country…" value={query} onChange={e => setQuery(e.target.value)}
                className="w-full mb-3 px-4 py-2.5 bg-[#F8F8FA] border border-gray-100 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-coral-500" />
            <div className="overflow-auto custom-scrollbar flex-1">
                <table className="w-full text-xs">
                    <thead><tr className="text-[10px] text-gray-400 uppercase text-left">
                        <th className="pb-2 pl-2 font-extrabold">AWB</th><th className="pb-2 font-extrabold">Branch</th><th className="pb-2 font-extrabold">Consignee</th>
                        <th className="pb-2 font-extrabold">Destination</th><th className="pb-2 font-extrabold">Status</th><th className="pb-2 pr-2 font-extrabold text-right">Booked</th>
                    </tr></thead>
                    <tbody id="latest-bookings-tbody" className="divide-y divide-gray-100">
                        {rows.length ? rows.map(b => (
                            <tr key={b.awb} className="hover:bg-[#F8F8FA]">
                                <td className="py-2.5 pl-2 font-extrabold">{b.awb}</td>
                                <td className="py-2.5"><span className="text-[10px] font-bold bg-[#F8F8FA] border border-gray-100 px-2 py-0.5 rounded-full">{b.branch_code || '—'}</span></td>
                                <td className="py-2.5 truncate max-w-[160px]">{b.consignee || '—'}</td>
                                <td className="py-2.5 text-gray-500">{[b.dest_city, b.dest_country].filter(Boolean).join(', ') || '—'}</td>
                                <td className="py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${b.current_status_code === 'DELIVERED' ? 'bg-emerald-50 text-emerald-700' : 'bg-coral-50 text-coral-600'}`}>{b.current_status || 'New'}</span></td>
                                <td className="py-2.5 pr-2 text-right text-gray-400 whitespace-nowrap">{ui.ago(b.booked_at)}</td>
                            </tr>
                        )) : <tr><td colSpan={6} className="py-8 text-center text-xs text-gray-400">{list.length ? 'No match.' : 'No bookings yet — they appear here as soon as orders are imported.'}</td></tr>}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};

const Trend: WidgetDef['render'] = (d, size) => {
    const days = d.daily || [];
    const max = Math.max(1, ...days.map(x => x.count));
    const total = days.reduce((s, x) => s + x.count, 0);
    return (
        <Card title="Booking Trend" badge={`${ui.num(total)} AWBs`} pad={size === '2x1' ? 'p-5' : 'p-6'}>
            <div className="flex items-end gap-1.5 flex-1 min-h-[60px]">
                {days.map((x, i) => {
                    const dt = new Date(x.day + 'T00:00:00');
                    const isToday = i === days.length - 1;
                    return (
                        <div key={x.day} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${dt.toDateString()}: ${x.count}`}>
                            {size !== '2x1' && <span className="text-[9px] font-bold text-gray-500">{x.count || ''}</span>}
                            <div className={`w-full rounded-lg ${isToday ? 'bg-coral-500' : x.count ? 'bg-[#111827]' : 'bg-gray-100'}`} style={{ height: `${Math.max(4, (x.count / max) * 100)}%` }}></div>
                            <span className={`text-[8px] font-bold ${isToday ? 'text-coral-500' : 'text-gray-400'}`}>{dt.getDate()}</span>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
};

const Apis: WidgetDef['render'] = (d, size) => {
    const list = d.integrations || [];
    const live = list.filter(i => i.active).length;
    const errors = list.filter(i => i.active && i.last_status === 'error').length;
    if (size === '1x1') return (
        <Card title="APIs" pad="p-5">
            <div className="mt-auto">
                <p className="text-2xl font-extrabold">{live}<span className="text-xs text-gray-400 font-semibold">{`/${list.length} live`}</span></p>
                <p className={`text-[10px] font-bold ${errors ? 'text-coral-500' : 'text-emerald-600'} mt-1`}>{errors ? `${errors} with errors` : 'All healthy'}</p>
            </div>
        </Card>
    );
    const dot = (i: (typeof list)[number]) => !i.active ? 'bg-gray-300' : i.last_status === 'error' ? 'bg-coral-500' : i.last_status === 'ok' ? 'bg-emerald-500' : 'bg-amber-400';
    return (
        <Card title="3rd-Party APIs" badge={`${live} live`}>
            <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1">
                {list.length ? list.map(i => (
                    <div key={i.name} className="bg-[#F8F8FA] rounded-2xl px-4 py-2.5 border border-gray-100" title={i.last_error || ''}>
                        <span className="flex items-center gap-2 text-xs font-extrabold truncate"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot(i)}`}></span>{i.name}</span>
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate"><span className="font-bold uppercase">{i.kind.replace('_', ' ')}</span>{` • ${i.active ? (i.last_sync_at ? `Checked ${ui.ago(i.last_sync_at)}${i.last_error ? ' • ' + i.last_error : ''}` : 'Never checked') : 'Inactive'}`}</p>
                    </div>
                )) : <Empty msg="No integrations configured." />}
            </div>
            <PageLink page="integrations.html" className="mt-3 text-center text-[11px] font-bold text-coral-500 hover:text-coral-600">Manage integrations →</PageLink>
        </Card>
    );
};

export const WIDGETS: WidgetDef[] = [
    { id: 'global-shipments', title: 'Shipments Overview', category: 'Operations', description: 'Bookings today and this month, weight, active AWBs and change vs last month.', defaultSize: '2x2', allowedSizes: ['1x1', '2x1', '2x2', '2x3'], render: Shipments },
    { id: 'global-financials', title: 'Revenue Summary', category: 'Finance', description: 'Today and month-to-date revenue per currency from booking amounts.', defaultSize: '1x2', allowedSizes: ['1x1', '1x2', '2x1', '2x2'], roles: ['super_admin', 'head_office', 'branch_manager'], render: Financials },
    { id: 'sla-staff-status', title: 'SLA & Staff Activity', category: 'HR & SLA', description: 'Average days to deliver, overdue shipments and staff status updates today.', defaultSize: '1x2', allowedSizes: ['1x1', '1x2', '2x1', '2x2'], render: Sla },
    { id: 'cargo-velocity', title: 'Consolidation & Tonnage', category: 'Logistics', description: 'Open consolidation lots (MAWB), tonnage this month and pending inbound transfers.', defaultSize: '1x2', allowedSizes: ['1x1', '1x2', '2x1', '2x2'], render: Velocity },
    { id: 'branch-financials', title: 'Branch Share (Concentric View)', category: 'Branches', description: "Concentric rings comparing each branch's share of this month's bookings.", defaultSize: '1x2', allowedSizes: ['1x1', '1x2', '2x2'], roles: ['super_admin', 'head_office'], render: Share },
    { id: 'branch-pipeline', title: 'Shipment Pipeline', category: 'Operations', description: 'Active shipments by stage (Booking → Review) plus exceptions on hold.', defaultSize: '2x2', allowedSizes: ['2x1', '2x2', '3x2', '4x2'], render: Pipeline },
    { id: 'branch-efficiency', title: 'Branch Performance', category: 'Branches', description: 'Per-branch bookings today and this month, tonnage, active AWBs and status updates.', defaultSize: '2x2', allowedSizes: ['1x1', '1x2', '2x1', '2x2', '4x2'], roles: ['super_admin', 'head_office'], render: Efficiency },
    { id: 'latest-bookings', title: 'Latest Bookings', category: 'Operations', description: 'Newest AWBs with consignee, destination, branch and current status.', defaultSize: '4x2', allowedSizes: ['2x2', '2x3', '3x2', '4x2'], render: Latest },
    { id: 'daily-trend', title: 'Booking Trend (14 days)', category: 'Operations', description: 'Bookings per day over the last two weeks.', defaultSize: '2x1', allowedSizes: ['2x1', '2x2', '4x2'], render: Trend },
    { id: 'integrations-health', title: '3rd-Party API Health', category: 'System', description: 'Order source and carrier APIs: active, last check and errors.', defaultSize: '1x2', allowedSizes: ['1x1', '1x2', '2x2'], roles: ['super_admin', 'head_office'], render: Apis }
];
