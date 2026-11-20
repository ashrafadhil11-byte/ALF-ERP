// File: api/_lib/summary-total.js — adds up branch day summaries into one company summary.
// Used by the summary page (api/_routes/summary.js) and the AI reports (api/_lib/ai-tasks.js).
const NUM = ['bookings', 'kg', 'delivered', 'delivery_failed', 'pickups', 'pickups_done', 'pickups_open', 'exceptions', 'unpaid_count'];
const MAPS = ['invoiced', 'received', 'expenses', 'unpaid'];

/** add up branch summaries into one company summary */
export function totalOf(list, day) {
    const t = { day, branch: null, branches: list.length, cash_not_closed: [], waiting: { cargo_in: 0, cash_in: 0, payment_requests: 0, materials_in: 0 } };
    for (const k of NUM) t[k] = Math.round(list.reduce((s, x) => s + (+x[k] || 0), 0) * 10) / 10;
    for (const k of MAPS) {
        t[k] = {};
        for (const x of list) for (const [c, v] of Object.entries(x[k] || {})) t[k][c] = Math.round(((t[k][c] || 0) + +v) * 1000) / 1000;
    }
    for (const x of list) {
        for (const w of Object.keys(t.waiting)) t.waiting[w] += +(x.waiting?.[w] || 0);
        if (!x.cash_closed && (+x.bookings || Object.keys(x.received || {}).length)) t.cash_not_closed.push(x.branch);
    }
    return t;
}
