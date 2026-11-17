// Phone number with its own country code — the old <input data-phone="OM"> (UI.phoneField): [flag +code ▾][number].
// The phone's country is independent of the address (an Oman shipper can have an Indian mobile).
//
//   const ph = useRef<PhoneHandle>(null);
//   <PhoneField ref={ph} country="OM" defaultValue="+91 9876543210" inputProps={{ id: 'sPhone', className: 'field' }} />
//   ph.current.value → '+91 9876543210' ('' when empty) · .valid · .setValue('+968 9123…') · .setCountry('IN', { soft: true })
// soft = only if the user hasn't picked a code themselves (used to follow the branch / destination country).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from 'react';
import { countries, DIAL_PREF, dialOf, flagUrl, fullPhone, phoneValid, splitPhone } from '../../lib/geo';

export type PhoneHandle = {
    readonly value: string;
    readonly valid: boolean;
    readonly country: string;
    setCountry(cc: string, opts?: { soft?: boolean }): void;
    setValue(full: string, fallbackCc?: string): void;
    reset(cc?: string): void;
};

type Props = {
    country?: string;
    defaultValue?: string;
    onChange?: (h: PhoneHandle) => void;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

export const PhoneField = forwardRef<PhoneHandle, Props>(function PhoneField({ country = 'OM', defaultValue, onChange, inputProps = {} }, ref) {
    const C = countries();
    const [cc, setCc] = useState(country);
    const [raw, setRaw] = useState('');
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [bad, setBad] = useState(false);
    const touched = useRef(false);
    const wrap = useRef<HTMLDivElement>(null);
    const btn = useRef<HTMLButtonElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const st = useRef({ cc, raw }); st.current = { cc, raw };

    const handle: PhoneHandle = {
        get value() { return fullPhone(st.current.raw, st.current.cc); },
        get valid() { return phoneValid(st.current.raw, st.current.cc); },
        get country() { return st.current.cc; },
        setCountry(newCc, { soft = false } = {}) { if (soft && touched.current) return; set(newCc, false); },
        setValue(full, fallbackCc) {
            const p = splitPhone(full, fallbackCc || st.current.cc);
            touched.current = Boolean(p.cc);
            const next = p.cc || fallbackCc || st.current.cc;
            st.current = { cc: next, raw: p.national };
            setCc(next); setRaw(p.national);
        },
        reset(newCc) { touched.current = false; st.current = { cc: newCc || st.current.cc, raw: '' }; setRaw(''); if (newCc) setCc(newCc); }
    };
    useImperativeHandle(ref, () => handle);

    function set(newCc: string, byUser: boolean) {
        if (!newCc) return;
        if (byUser) touched.current = true;
        if (newCc !== st.current.cc) { st.current = { ...st.current, cc: newCc }; setCc(newCc); onChange?.(handle); }
    }

    useEffect(() => { if (defaultValue) handle.setValue(defaultValue, country); /* eslint-disable-next-line */ }, []);
    useEffect(() => {
        const out = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('click', out);
        return () => document.removeEventListener('click', out);
    }, []);
    useEffect(() => {
        if (!open) return;
        search.current?.focus();
        listRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'center' });
    }, [open]);

    // exact code first, the main country for shared codes (+1 US, +44 UK) on top
    const query = q.trim().toLowerCase().replace(/^00/, '+');
    const dq = '+' + query.replace(/\D/g, '');
    const matches = C.filter(c => !query || c.n.toLowerCase().includes(query) || c.c.toLowerCase() === query || (dq.length > 1 && c.d.startsWith(dq)))
        .map(c => [c.d === dq ? (DIAL_PREF[c.d] === c.c ? 0 : 1) : c.n.toLowerCase().startsWith(query) ? 1 : 2, c] as const)
        .sort((a, b) => a[0] - b[0]).map(([, c]) => c).slice(0, 250);

    const cur = C.find(x => x.c === cc);
    const { className = '', ...rest } = inputProps;
    return (
        <div ref={wrap} className="relative flex gap-2">
            <button type="button" ref={btn} aria-haspopup="listbox" aria-expanded={open} title={cur ? `${cur.n} ${cur.d}` : 'Choose country code'}
                className="field soft !w-auto flex items-center gap-1.5 !px-3 flex-shrink-0"
                onClick={() => { if (open) return setOpen(false); setQ(''); setOpen(true); }}>
                <img alt="" src={cur ? flagUrl(cc) : ''} className={`w-[22px] h-4 object-cover rounded-[3px] border border-gray-200${cur ? '' : ' hidden'}`} />
                <span className="text-xs font-extrabold tabular-nums">{dialOf(cc)}</span>
                <svg className="w-3 h-3 text-[#E86D58]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 9l-7 7-7-7" /></svg>
            </button>
            <input {...rest} ref={input} type="tel" inputMode="tel" autoComplete="off" value={raw}
                className={`${className}${bad ? ' !border-[#E86D58]' : ''}`}
                onChange={(e) => {
                    let v = e.target.value;
                    // typing / pasting a number with +code or 00code switches the country and keeps only the local part
                    const t = v.trim();
                    if (/^(\+|00)\d{1,4}/.test(t)) {
                        const p = splitPhone(t, st.current.cc);
                        if (p.cc && (p.national.length >= 4 || t.includes(' '))) { set(p.cc, true); v = p.national; }
                    }
                    st.current = { ...st.current, raw: v };
                    setRaw(v); setBad(false);
                    inputProps.onChange?.(e);
                }}
                onBlur={(e) => { setBad(Boolean(raw.trim()) && !phoneValid(raw, cc)); inputProps.onBlur?.(e); }} />
            <div className={`${open ? '' : 'hidden '}absolute z-40 left-0 top-full mt-1.5 w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5`}>
                <input ref={search} className="field !py-2 text-xs mb-1" placeholder="Search country or code" aria-label="Search country code" value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); }
                        if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) { set(matches[0].c, true); setOpen(false); input.current?.focus(); } }
                    }} />
                <div role="listbox" ref={listRef} className="max-h-60 overflow-y-auto custom-scrollbar">
                    {open && (matches.length ? matches.map(c => (
                        <button key={c.c} type="button" role="option" data-cc={c.c} aria-selected={c.c === cc}
                            onClick={() => { set(c.c, true); setOpen(false); input.current?.focus(); }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-[#F8F8FA] ${c.c === cc ? 'bg-[#FFF5F3]' : ''}`}>
                            <img src={flagUrl(c.c)} alt="" loading="lazy" className="w-[22px] h-4 object-cover rounded-[3px] border border-gray-200 flex-shrink-0" />
                            <span className="flex-1 min-w-0 text-xs font-bold truncate">{c.n}</span><span className="text-[11px] font-extrabold text-gray-500 tabular-nums">{c.d}</span>
                        </button>
                    )) : <p className="p-3 text-xs text-gray-400 text-center">No match</p>)}
                </div>
            </div>
        </div>
    );
});
