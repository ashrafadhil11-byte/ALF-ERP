// Searchable dropdown — same look, ranking and keys as UI.combobox in the old pages.
// Typing filters (exact, starts with, word starts with, contains); ↑ ↓ Enter Esc work; flags via item.img.
//
//   const box = useRef<ComboboxHandle>(null);
//   <Combobox ref={box} load={async () => items} allowCustom onSelect={(it) => …} inputProps={{ id: 'city', className: 'field' }} />
//   box.current.setValue('Muscat') · box.current.reload() · box.current.value
import { forwardRef, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from 'react';
import type { Item } from '../../lib/geo';

export type ComboboxHandle = {
    reload(): void;
    preload(): Promise<void>;
    setValue(value: string | null | undefined): Promise<void>;
    clear(): void;
    /** put text in the box without choosing an item (no flag), like setting input.value directly */
    setText(t: string): void;
    readonly value: Item | null;
    readonly text: string;
};

type Props = {
    load: () => Promise<Item[]> | Item[];
    allowCustom?: boolean;
    onSelect?: (it: Item | null) => void;
    emptyText?: string;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

const fold = (v: unknown) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Items matching what was typed, best first (max 300). */
export function rankItems(items: Item[], typedRaw: string, selected: Item | null): Item[] {
    const q = fold(typedRaw.trim());
    const typed = selected && typedRaw === selected.label ? '' : q;
    if (!typed) return items.slice(0, 300);
    const rank = (it: Item) => {
        const l = fold(it.label);
        if (l === typed || fold(it.value) === typed) return 0;
        if (l.startsWith(typed)) return 1;
        if (l.split(/[\s,()-]+/).some(w => w.startsWith(typed))) return 2;
        if (l.includes(typed) || fold(it.sub).includes(typed)) return 3;
        return 9;
    };
    return items.map(it => [rank(it), it] as const).filter(([r]) => r < 9).sort((x, y) => x[0] - y[0]).map(([, it]) => it).slice(0, 300);
}

export const Combobox = forwardRef<ComboboxHandle, Props>(function Combobox({ load, allowCustom = false, onSelect, emptyText = 'No matches', inputProps = {} }, ref) {
    const [, force] = useState(0);
    const rerender = () => force(n => n + 1);
    const s = useRef({ items: [] as Item[], open: false, active: -1, loaded: false, loading: null as Promise<void> | null, selected: null as Item | null, text: String(inputProps.defaultValue ?? '') }).current;
    const input = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const loadRef = useRef(load); loadRef.current = load;
    const selectRef = useRef(onSelect); selectRef.current = onSelect;

    async function ensure() {
        if (s.loaded) return;
        if (!s.loading) s.loading = Promise.resolve(loadRef.current()).then(r => { s.items = r || []; s.loaded = true; }).catch(() => { s.items = []; s.loaded = true; });
        await s.loading;
    }
    const matches = () => rankItems(s.items, s.text, s.selected);
    async function show() { s.open = true; rerender(); await ensure(); if (s.open) rerender(); }
    function hide() { s.open = false; s.active = -1; rerender(); }
    function choose(it: Item | null) {
        s.selected = it;
        if (it) s.text = it.label;
        hide();
        selectRef.current?.(it);
    }
    const custom = (): Item => ({ value: s.text.trim(), label: s.text.trim(), custom: true });

    useImperativeHandle(ref, () => ({
        reload() { s.loaded = false; s.loading = null; s.items = []; },
        preload: ensure,
        async setValue(value) {
            if (!value) { s.selected = null; s.text = ''; rerender(); return; }
            await ensure();
            const v = String(value).toLowerCase();
            const it = s.items.find(x => String(x.value).toLowerCase() === v || x.label.toLowerCase() === v);
            s.selected = it || (allowCustom ? { value, label: value, custom: true } : null);
            s.text = s.selected ? s.selected.label : '';
            rerender();
        },
        clear() { s.selected = null; s.text = ''; rerender(); },
        setText(t) { s.selected = null; s.text = t; rerender(); },
        get value() { return s.selected; },
        get text() { return s.text; }
    }));

    const m = s.open ? matches() : [];
    const active = Math.min(s.active, m.length - 1);
    const showCustom = allowCustom && s.text.trim() && !m.some(it => it.label.toLowerCase() === s.text.trim().toLowerCase());
    const img = s.selected?.img;

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (!s.open) show(); s.active = Math.min(matches().length - 1, s.active + 1); rerender(); requestAnimationFrame(() => list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); s.active = Math.max(0, s.active - 1); rerender(); requestAnimationFrame(() => list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })); }
        else if (e.key === 'Enter' && s.open) {
            e.preventDefault();
            // list still downloading: wait for it, then take the best match instead of the half-typed text
            ensure().then(() => {
                const mm = matches();
                const pick = mm[Math.max(0, s.active)];
                if (pick) choose(pick);
                else if (allowCustom && s.text.trim()) choose(custom());
            });
        }
        else if (e.key === 'Escape') hide();
        inputProps.onKeyDown?.(e);
    };
    const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        inputProps.onBlur?.(e);
        setTimeout(async () => {
            if (!s.open) return;
            if (!s.loaded) await ensure();
            hide();
            const exact = s.items.find(it => it.label.toLowerCase() === s.text.trim().toLowerCase());
            if (exact) choose(exact);
            else if (allowCustom && s.text.trim()) { if (!s.selected || s.selected.label !== s.text) choose(custom()); }
            else if (!s.selected) { s.text = ''; rerender(); selectRef.current?.(null); }
            else { s.text = s.selected.label; rerender(); }
        }, 120);
    };

    const { className = '', defaultValue: _d, ...rest } = inputProps;
    return (
        <div className="relative">
            <input {...rest} ref={input} value={s.text} role="combobox" aria-autocomplete="list" aria-expanded={s.open} autoComplete="off"
                className={`${className} !pr-10${img ? ' !pl-11' : ''}`}
                onFocus={(e) => { show(); inputProps.onFocus?.(e); }}
                onClick={(e) => { show(); inputProps.onClick?.(e); }}
                onChange={(e) => {
                    s.text = e.target.value;
                    if (s.selected && s.text !== s.selected.label) s.selected = null;
                    s.active = 0;
                    if (!s.open) show(); else rerender();
                    inputProps.onChange?.(e);
                }}
                onKeyDown={onKeyDown} onBlur={onBlur} />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#E86D58]">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 9l-7 7-7-7" /></svg>
            </span>
            <img className={`${img ? '' : 'hidden '}absolute left-3.5 top-1/2 -translate-y-1/2 w-[22px] h-4 object-cover rounded-[3px] border border-gray-200`} alt="" src={img || undefined} />
            <div ref={list} role="listbox" onMouseDown={(e) => e.preventDefault()}
                className={`${s.open ? '' : 'hidden '}absolute z-40 left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5 max-h-64 overflow-y-auto custom-scrollbar`}>
                {s.open && <>
                    {s.loading && !s.loaded && <p className="p-3 text-xs text-gray-400 text-center">Loading…</p>}
                    {m.map((it, i) => (
                        <button key={`${it.value}|${i}`} type="button" role="option" aria-selected={i === active} onClick={() => choose(it)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left ${i === active ? 'bg-[#F8F8FA]' : 'hover:bg-[#F8F8FA]'}`}>
                            {it.img && <img src={it.img} alt="" className="w-[22px] h-4 object-cover rounded-[3px] border border-gray-200 flex-shrink-0" loading="lazy" />}
                            <span className="flex-1 min-w-0 text-xs font-bold truncate">{it.label}</span>
                            {it.sub && <span className="text-[10px] font-bold text-gray-400 flex-shrink-0">{it.sub}</span>}
                        </button>
                    ))}
                    {showCustom && <button type="button" data-custom onClick={() => choose(custom())} className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold text-[#D55C48] hover:bg-[#FFF5F3]">Use “{s.text.trim()}”</button>}
                    {s.loaded && !m.length && !showCustom && <p className="p-3 text-xs text-gray-400 text-center">{emptyText}</p>}
                </>}
            </div>
        </div>
    );
});
