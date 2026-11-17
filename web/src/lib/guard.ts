// Unsaved-changes guard — same rules as admin/components/ui.js:
// typing or picking something inside a popup (.ui-modal) or a form marked data-guard marks it "dirty".
// Closing it by clicking outside, pressing Esc, or ✕ / Cancel then asks first; closing after a save (code) never asks.
// Leaving the page (reload, link, back) with a dirty popup or form open asks too.
import { confirm } from './dialogs';

const TRACK = /^(INPUT|SELECT|TEXTAREA)$/;
export const DIRTY_SELECTOR = '.ui-modal.open[data-dirty="1"], [data-guard][data-dirty="1"]';

export function tracked(el: EventTarget | null): el is HTMLInputElement {
    const e = el as HTMLInputElement | null;
    return !!e && TRACK.test(e.tagName) && !['search', 'button', 'submit', 'hidden', 'reset'].includes(e.type)
        && !e.closest('[data-nodirty]') && !/search|find|filter|scan/i.test(`${e.id || ''} ${e.name || ''} ${e.placeholder || ''}`);
}

export const isDirty = (el: Element | null | undefined) => (el as HTMLElement | null)?.dataset?.dirty === '1';
export const markClean = (el: Element | null | undefined) => { if (el) delete (el as HTMLElement).dataset.dirty; };
export const anyDirty = () => !!document.querySelector(DIRTY_SELECTOR);

let asking = false;
/** Ask before throwing away unsaved input. Resolves true when it is fine to close. */
export async function allowClose(el: Element | null | undefined): Promise<boolean> {
    if (!isDirty(el)) return true;
    if (asking) return false;
    asking = true;
    const ok = await confirmDiscard();
    asking = false;
    if (ok) markClean(el);
    return ok;
}

export const confirmDiscard = () => confirm({
    title: 'Discard unsaved changes?',
    message: 'You have entered or changed details here that are not saved yet. If you close now they will be lost.',
    confirmText: 'Discard', danger: true
});

/** Popups register how they close themselves, so Esc and backdrop clicks can reach them. */
export const dismissers = new WeakMap<Element, () => void>();

// Only real typing counts (code that sets values does not). Tests swap this, since jsdom cannot make trusted events.
let isReal = (e: Event) => e.isTrusted;
export const _setTrustCheckForTests = (fn: (e: Event) => boolean) => { isReal = fn; };

let installed = false;
export function installGuard() {
    if (installed) return;
    installed = true;
    const markDirty = (e: Event) => {
        if (!isReal(e) || !tracked(e.target)) return;
        const box = (e.target as Element).closest<HTMLElement>('.ui-modal, [data-guard]');
        if (box) box.dataset.dirty = '1';
    };
    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = [...document.querySelectorAll<HTMLElement>('.ui-modal.open')];
        const top = open[open.length - 1];
        if (!top) return;
        if (top.dataset.confirm) { top.querySelector<HTMLElement>('[data-v="0"]')?.click(); return; }
        dismissers.get(top)?.();
    });
    document.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.classList?.contains('ui-modal') && !t.dataset.confirm) dismissers.get(t)?.();
    });
    window.addEventListener('beforeunload', (e) => {
        if (anyDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
}
