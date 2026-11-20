// Keeps screens current after a change.
// api() calls changed(path) after every successful save (POST / PATCH / PUT / DELETE). Then:
//   * cached lists (React Query) are marked out of date and the ones on screen reload — see lib/query.ts;
//   * pages that load their own data reload through useLive(reload): after any save on this page, by Farah, or in
//     another tab of the ERP, and when the user comes back to the tab after a while.
// Chat and "seen" saves are quiet: they change nothing on other screens.
import { useEffect, useRef } from 'react';

type Change = { path: string; elsewhere: boolean };
const listeners = new Set<(c: Change) => void>();
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('alf-changes') : null;
channel?.addEventListener('message', (e) => emit({ path: String(e.data?.path || ''), elsewhere: true }));

function emit(c: Change) { listeners.forEach(fn => { try { fn(c); } catch { /* a listener must not break the others */ } }); }

/** saves that change nothing outside their own screen */
export function quiet(path: string, body: unknown): boolean {
    const action = body && typeof body === 'object' ? (body as { action?: string }).action : undefined;
    return /^\/api\/(chat|notifications|login|dashboard-layout)\b/.test(path) || (path.startsWith('/api/assistant') && action === 'reply');
}

/** called by api() after a successful save */
export function changed(path: string) {
    emit({ path, elsewhere: false });
    channel?.postMessage({ path });            // the other open tabs of the ERP
}

export function onChange(fn: (c: Change) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** re-runs `reload` (without a loading screen) when data changed, or when the user comes back to the tab after 15 s */
export function useLive(reload: () => unknown) {
    const ref = useRef(reload);
    ref.current = reload;
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let hiddenAt = 0;
        const soon = () => { clearTimeout(timer); timer = setTimeout(() => { try { Promise.resolve(ref.current()).catch(() => {}); } catch { /* the page shows its own errors */ } }, 350); };
        const off = onChange(soon);
        const vis = () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 15_000) soon(); };
        document.addEventListener('visibilitychange', vis);
        return () => { off(); clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
    }, []);
}
