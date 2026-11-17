// Floating action menu next to a button (never clipped by scrolling tables) — same as UI.menu(btn, html).
//   openMenu(e.currentTarget, <><button>Edit</button><hr/><button className="danger">Delete</button></>)
// Closes on any click inside it on a button / link, a click outside, scrolling or resizing.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createStore, useStore } from '../lib/store';

const current = createStore<{ anchor: DOMRect; content: ReactNode } | null>(null);

export const openMenu = (btn: Element, content: ReactNode) => current.set({ anchor: btn.getBoundingClientRect(), content });
export const closeMenu = () => current.set(null);

export function RowMenuHost() {
    const m = useStore(current);
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!m || !el) return;
        const r = m.anchor, h = el.offsetHeight, w = el.offsetWidth;
        const below = r.bottom + 6 + h <= window.innerHeight;
        el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
        el.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    }, [m]);

    useEffect(() => {
        if (!m) return;
        const outside = (e: MouseEvent) => { if (!(e.target as Element).closest?.('[data-menu-root]')) closeMenu(); };
        // the click that opened the menu is still bubbling — listen from the next tick
        const t = setTimeout(() => document.addEventListener('click', outside), 0);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('resize', closeMenu);
        return () => { clearTimeout(t); document.removeEventListener('click', outside); window.removeEventListener('scroll', closeMenu, true); window.removeEventListener('resize', closeMenu); };
    }, [m]);

    if (!m) return null;
    return (
        <div ref={ref} className="row-menu" role="menu" data-menu-root="" onClick={(e) => { if ((e.target as Element).closest('button, a')) closeMenu(); }}>
            {m.content}
        </div>
    );
}
