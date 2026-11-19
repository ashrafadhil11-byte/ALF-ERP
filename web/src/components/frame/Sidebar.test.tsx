// Menu groups fold and open like admin/components/sidebar.js: a click toggles the group, the fold is remembered,
// and the group of the current page starts open but can still be folded.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';

const group = (c: HTMLElement, id: string) => c.querySelector(`.nav-group[data-group="${id}"]`)!;
const isOpen = (c: HTMLElement, id: string) => !group(c, id).querySelector('.nav-items')!.classList.contains('hidden');
const click = (c: HTMLElement, id: string) => fireEvent.click(group(c, id).querySelector('.nav-head')!);
const show = () => render(<MemoryRouter><Sidebar current="shipments.html" /></MemoryRouter>).container;

describe('Sidebar groups', () => {
    beforeEach(() => { localStorage.clear(); localStorage.setItem('cargo_user_role', 'super_admin'); Element.prototype.scrollIntoView = () => {}; });   // jsdom has no scrollIntoView
    afterEach(cleanup);

    it('a click folds an open group and opens it again, and remembers it', () => {
        const c = show();
        expect(isOpen(c, 'crm')).toBe(true);
        click(c, 'crm');
        expect(isOpen(c, 'crm')).toBe(false);
        expect(group(c, 'crm').querySelector('.nav-head')!.getAttribute('aria-expanded')).toBe('false');
        expect(JSON.parse(localStorage.getItem('alf_nav_folded')!).crm).toBe(true);
        click(c, 'crm');
        expect(isOpen(c, 'crm')).toBe(true);
        expect(JSON.parse(localStorage.getItem('alf_nav_folded')!).crm).toBe(false);
    });

    it('a remembered fold stays folded on the next page', () => {
        localStorage.setItem('alf_nav_folded', JSON.stringify({ crm: true }));
        expect(isOpen(show(), 'crm')).toBe(false);
    });

    it("the current page's group starts open even when folded before, and can still be folded", () => {
        localStorage.setItem('alf_nav_folded', JSON.stringify({ ops: true }));
        const c = show();
        expect(isOpen(c, 'ops')).toBe(true);
        click(c, 'ops');
        expect(isOpen(c, 'ops')).toBe(false);
    });
});
