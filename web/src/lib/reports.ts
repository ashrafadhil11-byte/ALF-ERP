// Financial reports from the ledger (GET /api/accounts?view=ledger): profit & loss, balance sheet, trial balance.
// One calculation feeds the screen, the printed report and the spreadsheet export, so they always agree.
// Each currency is a report of its own (no conversion).

export type Kind = 'pl' | 'bs' | 'tb';
export type LedgerRow = { currency: string; account_code: string; name: string; type: string; debit: number; credit: number };
export type Ledger = { from: string; to: string; branch: string | null; period: LedgerRow[]; to_date: LedgerRow[] };

export type Line = { code: string; name: string; amount: number };
export type Section = { title: string; lines: Line[]; total: number };
export type TbLine = { code: string; name: string; debit: number; credit: number };
export type Report =
    | { kind: 'pl'; currency: string; sections: Section[]; net: number }
    | { kind: 'bs'; currency: string; sections: Section[]; liabEquity: number; balanced: boolean }
    | { kind: 'tb'; currency: string; lines: TbLine[]; debit: number; credit: number; balanced: boolean };

export const KIND_TITLE: Record<Kind, string> = { pl: 'Profit & loss', bs: 'Balance sheet', tb: 'Trial balance' };
const THREE = ['OMR', 'BHD', 'KWD', 'JOD', 'TND', 'LYD', 'IQD'];
export const decimals = (cur: string) => THREE.includes(cur) ? 3 : 2;
export const fmt = (cur: string, v: number) => (Number(v) || 0).toLocaleString('en', { minimumFractionDigits: decimals(cur), maximumFractionDigits: decimals(cur) });
/** accounting style: negatives in brackets */
export const acc = (cur: string, v: number) => (v < 0 ? `(${fmt(cur, -v)})` : fmt(cur, v));
export const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** rows per currency, one row per account (amounts of the same account added up), in account-code order */
const byCur = (rows: LedgerRow[]) => {
    const m: Record<string, Map<string, LedgerRow>> = {};
    for (const r of rows) {
        const acc = (m[r.currency] ||= new Map()), hit = acc.get(r.account_code);
        if (hit) { hit.debit += +r.debit || 0; hit.credit += +r.credit || 0; }
        else acc.set(r.account_code, { ...r, debit: +r.debit || 0, credit: +r.credit || 0 });
    }
    return Object.fromEntries(Object.entries(m).map(([c, acc]) => [c, [...acc.values()].sort((a, b) => a.account_code.localeCompare(b.account_code))]));
};
const amt = (r: LedgerRow, natural: 'debit' | 'credit') => natural === 'debit' ? r.debit - r.credit : r.credit - r.debit;
const section = (title: string, rows: LedgerRow[], natural: 'debit' | 'credit'): Section => {
    const lines = rows.map(r => ({ code: r.account_code, name: r.name, amount: amt(r, natural) }));
    return { title, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
};

export function buildReports(kind: Kind, d: Ledger): Report[] {
    if (kind === 'pl') return Object.entries(byCur(d.period)).map(([currency, rows]) => {
        const inc = section('Income', rows.filter(r => r.type === 'income'), 'credit'), exp = section('Expenses', rows.filter(r => r.type === 'expense'), 'debit');
        return { kind, currency, sections: [inc, exp], net: inc.total - exp.total };
    });
    if (kind === 'bs') return Object.entries(byCur(d.to_date)).map(([currency, rows]) => {
        const a = section('Assets', rows.filter(r => r.type === 'asset'), 'debit'), l = section('Liabilities', rows.filter(r => r.type === 'liability'), 'credit');
        const earnings = rows.filter(r => ['income', 'expense'].includes(r.type)).reduce((s, r) => s + r.credit - r.debit, 0);
        const e = section('Equity', [...rows.filter(r => r.type === 'equity'), { currency, account_code: '—', name: 'Retained earnings (profit to date)', type: 'equity', debit: 0, credit: earnings }], 'credit');
        return { kind, currency, sections: [a, l, e], liabEquity: l.total + e.total, balanced: Math.abs(a.total - l.total - e.total) < 0.0005 };
    });
    return Object.entries(byCur(d.to_date)).map(([currency, rows]) => {
        const lines = rows.map(r => { const n = r.debit - r.credit; return { code: r.account_code, name: r.name, debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 }; });
        const debit = lines.reduce((s, l) => s + l.debit, 0), credit = lines.reduce((s, l) => s + l.credit, 0);
        return { kind: 'tb' as const, currency, lines, debit, credit, balanced: Math.abs(debit - credit) < 0.0005 };
    });
}

/** "For the period 01 Nov 2026 – 19 Nov 2026" (P&L) or "As at 19 Nov 2026" (balance sheet, trial balance) */
export const periodText = (kind: Kind, d: Ledger) => kind === 'pl' ? `For the period ${day(d.from)} – ${day(d.to)}` : `As at ${day(d.to)}`;

// ---------- spreadsheet export (CSV, opens in Excel) ----------
export function toCsv(kind: Kind, d: Ledger, branchName: string): string {
    const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const num = (cur: string, v: number) => (Number(v) || 0).toFixed(decimals(cur));
    const out: unknown[][] = [['Al-Farha Cargo'], [KIND_TITLE[kind]], [periodText(kind, d)], [`Branch: ${branchName}`], []];
    for (const r of buildReports(kind, d)) {
        out.push([`Currency: ${r.currency}`]);
        if (r.kind === 'tb') {
            out.push(['Code', 'Account', 'Debit', 'Credit']);
            r.lines.forEach(l => out.push([l.code, l.name, l.debit ? num(r.currency, l.debit) : '', l.credit ? num(r.currency, l.credit) : '']));
            out.push(['', 'Total', num(r.currency, r.debit), num(r.currency, r.credit)]);
        } else {
            out.push(['Code', 'Account', 'Amount']);
            r.sections.forEach(s => { out.push([s.title.toUpperCase()]); s.lines.forEach(l => out.push([l.code, l.name, num(r.currency, l.amount)])); out.push(['', `Total ${s.title.toLowerCase()}`, num(r.currency, s.total)]); });
            if (r.kind === 'pl') out.push(['', r.net >= 0 ? 'Net profit' : 'Net loss', num(r.currency, r.net)]);
            else out.push(['', 'Total liabilities & equity', num(r.currency, r.liabEquity)]);
        }
        out.push([]);
    }
    return '﻿' + out.map(r => r.map(q).join(',')).join('\r\n');
}

// ---------- printed report (its own document: only the report, A4) ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function reportHtml(kind: Kind, d: Ledger, branchName: string, printedBy: string): string {
    const reports = buildReports(kind, d);
    const title = KIND_TITLE[kind];
    const head = (cur: string) => `
        <header>
            <div><div class="co">Al-Farha Cargo</div><div class="muted">Courier &amp; Parcel Services</div></div>
            <div class="r"><div class="title">${esc(title)}</div><div class="muted">${esc(periodText(kind, d))}</div></div>
        </header>
        <div class="meta"><span><b>Branch</b> ${esc(branchName)}</span><span><b>Currency</b> ${esc(cur)}</span><span><b>Basis</b> Accrual</span></div>`;
    const foot = `<div class="sign"><div>Prepared by</div><div>Approved by</div></div><p class="printed">Printed ${esc(new Date().toLocaleString('en-GB'))}${printedBy ? ' by ' + esc(printedBy) : ''} · figures from the ERP ledger</p>`;
    const money = (cur: string, v: number, cls = '') => `<td class="num ${cls}">${esc(acc(cur, v))}</td>`;
    const body = reports.map(r => {
        const c = r.currency;
        if (r.kind === 'tb') return `<section>${head(c)}
            <table><thead><tr><th class="code">Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>
            ${r.lines.map(l => `<tr><td class="code">${esc(l.code)}</td><td>${esc(l.name)}</td><td class="num">${l.debit ? esc(fmt(c, l.debit)) : ''}</td><td class="num">${l.credit ? esc(fmt(c, l.credit)) : ''}</td></tr>`).join('')}
            </tbody><tfoot><tr class="grand"><td></td><td>Total</td>${money(c, r.debit, 'dbl')}${money(c, r.credit, 'dbl')}</tr></tfoot></table>
            <p class="check ${r.balanced ? 'ok' : 'bad'}">${r.balanced ? 'Debits equal credits — the books balance.' : 'Out of balance by ' + esc(fmt(c, Math.abs(r.debit - r.credit))) + '.'}</p>${foot}</section>`;
        const rows = r.sections.map(s => `
            <tr class="sec"><td colspan="3">${esc(s.title)}</td></tr>
            ${s.lines.length ? s.lines.map(l => `<tr><td class="code">${esc(l.code)}</td><td class="ind">${esc(l.name)}</td>${money(c, l.amount)}</tr>`).join('') : '<tr><td></td><td class="ind muted">No entries</td><td class="num muted">—</td></tr>'}
            <tr class="sub"><td></td><td>Total ${esc(s.title.toLowerCase())}</td>${money(c, s.total, 'line')}</tr>`).join('');
        const end = r.kind === 'pl'
            ? `<tr class="grand"><td></td><td>${r.net >= 0 ? 'Net profit' : 'Net loss'} for the period</td>${money(c, r.net, 'dbl')}</tr>`
            : `<tr class="grand"><td></td><td>Total liabilities &amp; equity</td>${money(c, r.liabEquity, 'dbl')}</tr>`;
        const note = r.kind === 'bs' ? `<p class="check ${r.balanced ? 'ok' : 'bad'}">${r.balanced ? 'Assets equal liabilities plus equity — the balance sheet balances.' : 'The balance sheet does not balance — check the journal.'}</p>` : '';
        return `<section>${head(c)}<table><thead><tr><th class="code">Code</th><th>Account</th><th class="num">${esc(c)}</th></tr></thead><tbody>${rows}</tbody><tfoot>${end}</tfoot></table>${note}${foot}</section>`;
    }).join('') || `<section>${head('—')}<p class="muted">No postings for this period.</p></section>`;

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — Al-Farha Cargo</title><style>
        @page { size: A4; margin: 16mm 14mm 18mm; @bottom-left { content: "Al-Farha Cargo · ${esc(title)}"; font: 8pt Arial, sans-serif; color: #888; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #888; } }
        * { box-sizing: border-box; }
        body { font: 10pt/1.45 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
        section { page-break-after: always; }
        section:last-child { page-break-after: auto; }
        header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; }
        .co { font-size: 16pt; font-weight: bold; letter-spacing: -.01em; }
        .title { font-size: 14pt; font-weight: bold; text-transform: uppercase; letter-spacing: .04em; }
        .r { text-align: right; }
        .muted { color: #666; }
        .meta { display: flex; gap: 22px; margin: 8px 0 14px; font-size: 9pt; color: #333; }
        .meta b { color: #888; font-weight: normal; text-transform: uppercase; font-size: 7.5pt; letter-spacing: .06em; margin-right: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #666; font-weight: bold; text-align: left; border-bottom: 1px solid #111; padding: 5px 6px; }
        td { padding: 4px 6px; vertical-align: top; }
        .code { width: 62px; color: #555; font-variant-numeric: tabular-nums; }
        .num { text-align: right; width: 130px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ind { padding-left: 18px; }
        tr.sec td { font-weight: bold; text-transform: uppercase; font-size: 8.5pt; letter-spacing: .05em; padding-top: 14px; }
        tr.sub td { font-weight: bold; }
        td.line { border-top: 1px solid #111; }
        tr.grand td { font-weight: bold; font-size: 10.5pt; padding-top: 10px; }
        td.dbl { border-top: 1px solid #111; border-bottom: 3px double #111; }
        tbody tr:not(.sec):not(.sub) { break-inside: avoid; }
        .check { font-size: 8.5pt; margin-top: 12px; }
        .check.ok { color: #047857; } .check.bad { color: #B42318; font-weight: bold; }
        .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; font-size: 9pt; color: #444; }
        .sign div { border-top: 1px solid #999; padding-top: 6px; }
        .printed { margin-top: 18px; font-size: 8pt; color: #888; }
        @media screen { body { background: #ECECEF; padding: 24px; } section { background: #fff; max-width: 210mm; margin: 0 auto 24px; padding: 16mm 14mm; box-shadow: 0 10px 30px -12px rgba(0,0,0,.2); } }
    </style></head><body>${body}</body></html>`;
}
