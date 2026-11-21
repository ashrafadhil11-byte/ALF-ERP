import { describe, expect, it } from 'vitest';
import { listForFarah } from './Messages';

describe('sharing a list with Farah', () => {
    it('keeps the rows with AWB / docket numbers, in a tidy form', () => {
        const csv = 'AWB,Pcs,Wt,Vol,City,State,Carrier,Docket,Date\r\n3131908,1,26.1,25.9,MAU,UTTAR PRADESH,DELHIVERY,322976564,16.11.2026\r\n3136227,1,10,10.3,MUMBAI,MAHARASHTRA,DELHIVERY,322976562,16.11.2026\r\n,,,,,,,,\r\nTotal,2,36.1,,,,,,';
        const m = listForFarah('delhivery.csv', csv)!;
        expect(m.startsWith('📄 delhivery.csv — 2 rows:')).toBe(true);
        expect(m).toContain('3131908  1  26.1  25.9  MAU  UTTAR PRADESH  DELHIVERY  322976564  16.11.2026');
        expect(m).not.toContain('Total');
        expect(listForFarah('x.txt', 'hello\nno numbers here')).toBeNull();
    });
    it('a pasted Excel selection (tabs) works the same', () => {
        const m = listForFarah('pasted', '3141017\t1\t13.2\t13.3\tHAZARIBAGH\tJHARKHAND\tDELHIVERY\t322976561\t16.11.2026')!;
        expect(m).toContain('3141017  1  13.2  13.3  HAZARIBAGH  JHARKHAND  DELHIVERY  322976561');
    });
    it('a very long list is cut so it fits in one message', () => {
        const rows = Array.from({ length: 400 }, (_, i) => `${3100000 + i}  1  9.8  VAISHALI  BIHAR  DELHIVERY  ${322900000 + i}  14.11.2026`).join('\n');
        const m = listForFarah('big.txt', rows)!;
        expect(m.length).toBeLessThanOrEqual(8000);
        expect(m).toContain('more rows not sent');
    });
});
