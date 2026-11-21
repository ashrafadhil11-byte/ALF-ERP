import { describe, expect, it } from 'vitest';
import { cell, toCsv } from './manifestColumns';
import { parseEntry } from '../components/PackingList';
import { installWheelGuard } from './wheelGuard';

const ROWS = [
    { awb: '311000045', shipper: 'Ravi, K', shipper_phone: '+96891234567', consignee: 'Anu "Mol"', dest_city: 'Kochi', dest_country: 'India', receiver_parts: { state: 'Kerala', pin: '682001' }, pieces: 2, weight: 18.5 },
    { awb: '311000046', shipper: '=HYPERLINK("x")', consignee: 'Sam', dest_country: 'India', pieces: 1, weight: 7 }
];

describe('manifest export', () => {
    it('writes the chosen columns in the chosen order, safe for Excel, with totals', () => {
        const csv = toCsv(ROWS, ['country', 'state', 'awb', 'shipper', 'shipper_phone', 'consignee', 'weight']);
        const lines = csv.replace('﻿', '').trim().split('\r\n');
        expect(csv.startsWith('﻿')).toBe(true);                       // Excel reads Arabic / Malayalam names
        expect(lines[0]).toBe('#,Country,State,AWB,Shipper name,Shipper phone,Receiver name,Weight (kg)');
        expect(lines[1]).toBe('1,India,Kerala,311000045,"Ravi, K", +96891234567,"Anu ""Mol""",18.5');
        expect(lines[2]).toContain(' =HYPERLINK');                          // a formula stays text
        expect(lines[3]).toBe('Total,,,,,,,25.5');
    });
    it('reads state and PIN from the receiver address', () => {
        expect(cell(ROWS[0], 'pin')).toBe('682001');
        expect(cell(ROWS[1], 'state')).toBe('');
    });
});

describe('packing quick entry', () => {
    it('understands "3 shirts", "shirts x3" and plain names', () => {
        expect(parseEntry('3 shirts')).toEqual({ qty: 3, item: 'shirts' });
        expect(parseEntry('shirts x 3')).toEqual({ qty: 3, item: 'shirts' });
        expect(parseEntry('Rice 5kg bag ×2')).toEqual({ qty: 2, item: 'Rice 5kg bag' });
        expect(parseEntry('T-shirt')).toEqual({ qty: 1, item: 'T-shirt' });
        expect(parseEntry('2 pcs bed sheets')).toEqual({ qty: 2, item: 'bed sheets' });
        expect(parseEntry('   ')).toBeNull();
    });
});

describe('wheel guard', () => {
    it('a focused number box loses focus on the mouse wheel (so its value cannot change)', () => {
        const off = installWheelGuard();
        const box = Object.assign(document.createElement('input'), { type: 'number', value: '5' });
        const text = Object.assign(document.createElement('input'), { type: 'text' });
        document.body.append(box, text);
        box.focus(); box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
        expect(document.activeElement).not.toBe(box);
        text.focus(); text.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
        expect(document.activeElement).toBe(text);
        off(); box.remove(); text.remove();
    });
});
