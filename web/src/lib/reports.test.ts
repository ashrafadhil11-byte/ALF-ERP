// Financial report figures: the screen, the printed report and the export all come from buildReports().
import { describe, it, expect } from 'vitest';
import { acc, buildReports, reportHtml, toCsv, type Ledger } from './reports';

const L = (currency: string, account_code: string, name: string, type: string, debit: number, credit: number) => ({ currency, account_code, name, type, debit, credit });
const ledger: Ledger = {
    from: '2026-11-01', to: '2026-11-19', branch: null,
    period: [L('OMR', '4000', 'Freight income', 'income', 0, 100), L('OMR', '5000', 'Carrier charges', 'expense', 30, 0), L('INR', '4000', 'Freight income', 'income', 0, 5000)],
    to_date: [L('OMR', '1000', 'Cash', 'asset', 90, 0), L('OMR', '1000', 'Cash', 'asset', 0, 20), L('OMR', '3000', 'Owner', 'equity', 0, 0), L('OMR', '4000', 'Freight income', 'income', 0, 100), L('OMR', '5000', 'Carrier charges', 'expense', 30, 0)]
};

describe('financial reports', () => {
    it('profit & loss: income minus expenses, one report per currency', () => {
        const r = buildReports('pl', ledger);
        expect(r.map(x => x.currency).sort()).toEqual(['INR', 'OMR']);
        const omr = r.find(x => x.currency === 'OMR')!;
        expect(omr.kind === 'pl' && omr.net).toBe(70);
    });

    it('the same account is shown once, with its amounts added up', () => {
        const tb = buildReports('tb', ledger)[0];
        expect(tb.kind === 'tb' && tb.lines.filter(l => l.code === '1000')).toEqual([{ code: '1000', name: 'Cash', debit: 70, credit: 0 }]);
    });

    it('trial balance and balance sheet balance', () => {
        const tb = buildReports('tb', ledger)[0], bs = buildReports('bs', ledger)[0];
        expect(tb.kind === 'tb' && [tb.debit, tb.credit, tb.balanced]).toEqual([100, 100, true]);
        expect(bs.kind === 'bs' && bs.balanced).toBe(true);
    });

    it('negative amounts are shown in brackets, with the currency decimals', () => {
        expect(acc('OMR', -23)).toBe('(23.000)');
        expect(acc('INR', 1234.5)).toBe('1,234.50');
    });

    it('export and print contain the figures', () => {
        const csv = toCsv('pl', ledger, 'All branches');
        expect(csv).toContain('Net profit,70.000');
        const html = reportHtml('pl', ledger, 'All branches', 'Tester');
        expect(html).toContain('<div class="title">Profit &amp; loss</div>');
        expect(html).toContain('Net profit for the period');
        expect(html).toContain('size: A4');
    });
});
