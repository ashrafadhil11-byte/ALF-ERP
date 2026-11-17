// Behaviour carried over from admin/components/*.js — each test names the old behaviour it protects.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Modal, useDismiss } from './Modal';
import { DialogHost } from '../lib/dialogs';
import { _setTrustCheckForTests, installGuard, tracked } from '../lib/guard';
import { fullPhone, phoneValid, splitPhone } from '../lib/geo';
import { rankItems } from './fields/Combobox';
import { hrs, stageOf } from './frame/CheckIn';
import { ago } from './frame/Notifications';
import { formatBranchTitle, formatRoleTitle } from './frame/ProfileDrawer';

beforeAll(() => {
    window.ALF_COUNTRIES = [
        { c: 'OM', n: 'Oman', d: '+968' }, { c: 'IN', n: 'India', d: '+91' }, { c: 'US', n: 'United States', d: '+1' },
        { c: 'CA', n: 'Canada', d: '+1' }, { c: 'IT', n: 'Italy', d: '+39' }, { c: 'AE', n: 'United Arab Emirates', d: '+971' }
    ];
    installGuard();
    _setTrustCheckForTests((e) => (e as Event & { real?: boolean }).real === true);
});
afterEach(cleanup);

const tick = () => act(() => new Promise(r => setTimeout(r, 0)));

function Harness({ onClosed }: { onClosed: () => void }) {
    const [open, setOpen] = useState(true);
    const Cancel = () => <button onClick={useDismiss()}>Cancel</button>;
    return (
        <>
            <Modal id="m1" open={open} onClose={() => { setOpen(false); onClosed(); }}>
                <input aria-label="Name" />
                <input aria-label="Search" placeholder="Search customers" />
                <Cancel />
                <button onClick={() => { setOpen(false); onClosed(); }}>Save</button>
            </Modal>
            <DialogHost />
        </>
    );
}

// fireEvent creates untrusted events; the guard (like the old one) only counts real typing
const typeInto = (el: HTMLElement, value: string) => {
    const ev = Object.assign(new Event('input', { bubbles: true }), { real: true });
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(ev);
};

describe('popup guard (ui.js "unsaved changes")', () => {
    it('closes at once when nothing was typed', async () => {
        let closed = 0;
        render(<Harness onClosed={() => closed++} />);
        fireEvent.click(screen.getByText('Cancel'));
        await tick();
        expect(closed).toBe(1);
        expect(document.querySelector('[data-confirm]')).toBeNull();
    });

    it('typing then Cancel / outside click / Esc asks first; "Discard" closes, "Cancel" keeps it', async () => {
        let closed = 0;
        render(<Harness onClosed={() => closed++} />);
        typeInto(screen.getByLabelText('Name'), 'Ali');
        expect(document.getElementById('m1')!.dataset.dirty).toBe('1');

        fireEvent.click(screen.getByText('Cancel'));
        await tick();
        expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
        fireEvent.click(document.querySelector('[data-confirm] [data-v="0"]')!);      // keep editing
        await tick();
        expect(closed).toBe(0);

        fireEvent.click(document.getElementById('m1')!);                              // backdrop
        await tick();
        expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });                              // Esc on the question = keep editing
        await tick();
        expect(closed).toBe(0);

        fireEvent.keyDown(document, { key: 'Escape' });                              // Esc on the popup asks
        await tick();
        fireEvent.click(document.querySelector('[data-confirm] [data-v="1"]')!);      // Discard
        await tick();
        expect(closed).toBe(1);
    });

    it('closing after a save never asks; search boxes never count as unsaved', async () => {
        let closed = 0;
        render(<Harness onClosed={() => closed++} />);
        typeInto(screen.getByLabelText('Search'), 'x');
        expect(document.getElementById('m1')!.dataset.dirty).toBeUndefined();
        typeInto(screen.getByLabelText('Name'), 'Ali');
        fireEvent.click(screen.getByText('Save'));
        await tick();
        expect(closed).toBe(1);
        expect(document.querySelector('[data-confirm]')).toBeNull();
    });

    it('tracked() ignores buttons, hidden, search/filter/scan fields and [data-nodirty]', () => {
        const mk = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d.firstElementChild!; };
        expect(tracked(mk('<input id="name">'))).toBe(true);
        expect(tracked(mk('<input type="hidden">'))).toBe(false);
        expect(tracked(mk('<input id="awbScan">'))).toBe(false);
        expect(tracked(mk('<input placeholder="Filter rows">'))).toBe(false);
        expect(tracked(mk('<div data-nodirty><textarea></textarea></div>').querySelector('textarea'))).toBe(false);
    });
});

describe('phone numbers (UI.splitPhone / phoneField)', () => {
    it('splits +code, 00code and plain numbers; shared codes prefer the main country', () => {
        expect(splitPhone('+91 98765 43210')).toEqual({ cc: 'IN', dial: '+91', national: '9876543210' });
        expect(splitPhone('00968 9123 4567')).toEqual({ cc: 'OM', dial: '+968', national: '91234567' });
        expect(splitPhone('91234567')).toEqual({ cc: null, dial: null, national: '91234567' });
        expect(splitPhone('+1 416 555 0100').cc).toBe('US');
        expect(splitPhone('+1 416 555 0100', 'CA').cc).toBe('CA');
    });
    it('stores "+code number", drops the trunk 0 (not for Italy), checks the length', () => {
        expect(fullPhone('07911 123456', 'IN')).toBe('+91 7911123456');
        expect(fullPhone('06 1234 5678', 'IT')).toBe('+39 0612345678');
        expect(fullPhone('', 'OM')).toBe('');
        expect(phoneValid('123', 'OM')).toBe(false);
        expect(phoneValid('91234567', 'OM')).toBe(true);
    });
});

describe('searchable lists (UI.combobox ranking)', () => {
    const items = [{ value: 'AE', label: 'United Arab Emirates' }, { value: 'OM', label: 'Oman' }, { value: 'US', label: 'United States' }, { value: 'X', label: 'Rome', sub: 'Lazio' }];
    it('exact, then starts with, then word starts with, then contains; accents ignored', () => {
        expect(rankItems(items, 'oman', null).map(i => i.value)).toEqual(['OM']);
        expect(rankItems(items, 'uni', null).map(i => i.value)).toEqual(['AE', 'US']);
        expect(rankItems(items, 'arab', null).map(i => i.value)).toEqual(['AE']);
        expect(rankItems(items, 'lazió', null).map(i => i.value)).toEqual(['X']);
        expect(rankItems(items, 'Oman', items[1]).length).toBe(4);   // showing the chosen one lists everything
    });
});

describe('check-in and notifications', () => {
    it('stages: in → work → on break → work → done', () => {
        expect(stageOf(null)).toBe('in');
        expect(stageOf({ check_in: 'x' })).toBe('work');
        expect(stageOf({ check_in: 'x', break_started_at: 'y' })).toBe('onbreak');
        expect(stageOf({ check_in: 'x', break_started_at: 'y', break_ended_at: 'z' })).toBe('work');
        expect(stageOf({ check_in: 'x', check_out: 'z' })).toBe('done');
        expect([hrs(0), hrs(65), hrs(480)]).toEqual(['0h', '1h 05m', '8h 00m']);
    });
    it('time ago', () => {
        const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
        expect([ago(at(5)), ago(at(120)), ago(at(7200)), ago(at(3 * 86400))]).toEqual(['just now', '2 min ago', '2 h ago', '3 d ago']);
    });
    it('profile titles', () => {
        expect(formatRoleTitle('branch_manager')).toBe('Branch Manager');
        expect(formatBranchTitle('MCT', 'staff')).toBe('MCT Branch');
        expect(formatBranchTitle('MCT', 'super_admin')).toBe('Global (All Branches)');
    });
});
