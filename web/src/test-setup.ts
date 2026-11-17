// Node 22+ ships its own (disabled) localStorage, which hides jsdom's. Give tests a working one.
if (typeof globalThis.localStorage?.setItem !== 'function') {
    const data = new Map<string, string>();
    const storage: Storage = {
        get length() { return data.size; },
        clear: () => data.clear(),
        getItem: (k) => (data.has(k) ? data.get(k)! : null),
        key: (i) => [...data.keys()][i] ?? null,
        removeItem: (k) => { data.delete(k); },
        setItem: (k, v) => { data.set(k, String(v)); }
    };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}
