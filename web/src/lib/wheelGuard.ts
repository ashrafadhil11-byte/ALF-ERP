// Number boxes must not change when the mouse wheel scrolls over them (browsers step the value of a focused
// <input type="number"> on wheel). One guard for the whole app: the box loses focus, so the page scrolls instead and
// the value stays as it was. Keyboard ↑ / ↓ still step the value: that is deliberate.
export function installWheelGuard(doc: Document = document) {
    const onWheel = (e: WheelEvent) => {
        const t = e.target as HTMLElement | null;
        if (t instanceof HTMLInputElement && t.type === 'number' && doc.activeElement === t) t.blur();
    };
    doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => doc.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
}
