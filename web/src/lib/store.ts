import { useSyncExternalStore } from 'react';

/** Tiny observable value for app-wide UI state (toasts, dialogs, menus) that code outside React can change. */
export function createStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<() => void>();
    return {
        get: () => value,
        set(next: T | ((v: T) => T)) {
            value = typeof next === 'function' ? (next as (v: T) => T)(value) : next;
            subs.forEach(f => f());
        },
        subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
    };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
    return useSyncExternalStore(store.subscribe, store.get, store.get);
}
