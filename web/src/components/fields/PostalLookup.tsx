// Postcode / ZIP / PIN / Saudi short-address lookup — the old UI.postalLookup(input, list, badge, { country, onPick }).
// Oman is answered from the built-in list; other countries call /api/postal-lookup (providers in connectors.js).
// Renders: <div class="relative"> input + "Lookup" badge </div> + the result list (place it inside a `relative` box).
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { api } from '../../lib/api';

export type Place = { postalCode?: string; postOffice?: string; city?: string; state?: string; wilayat?: string; street?: string; building?: string; shortAddress?: string; additionalNumber?: string };
type Props = {
    value: string;
    onChange: (v: string) => void;
    /** ISO code of the chosen country ('' when none) */
    country: () => string;
    onPick: (p: Place) => void;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
    badgeId?: string;
    listId?: string;
    /** hide the "Lookup" badge (the booking form shows it only once a destination is chosen) */
    badgeHidden?: boolean;
};

export function PostalLookup({ value, onChange, country, onPick, inputProps = {}, badgeId, listId, badgeHidden = false }: Props) {
    const [badge, setBadge] = useState('Lookup');
    const [open, setOpen] = useState(false);
    const [found, setFound] = useState<Place[]>([]);
    const [empty, setEmpty] = useState('');
    const seq = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>();
    const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const out = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && e.target !== input.current) setOpen(false); };
        document.addEventListener('click', out);
        return () => document.removeEventListener('click', out);
    }, []);

    const typed = (raw: string) => {
        clearTimeout(timer.current);
        const code = raw.trim(), cc = country();
        if (code.length < 3 || !cc) { setOpen(false); setBadge('Lookup'); onChange(raw); return; }
        onChange(cc === 'SA' && /^[a-z]/i.test(code) ? raw.toUpperCase() : raw);
        timer.current = setTimeout(async () => {
            const mine = ++seq.current;
            setBadge('Searching…');
            let j: { locations?: Place[]; errors?: string[] } = {};
            if (cc === 'OM' && window.ALF_OMAN_SEARCH) j = { locations: window.ALF_OMAN_SEARCH(code) };
            else try { j = await api(`/api/postal-lookup?code=${encodeURIComponent(code)}&countryCode=${encodeURIComponent(cc)}`); } catch (e) { j = { errors: [(e as Error).message] }; }
            if (mine !== seq.current) return;   // a newer search is running
            const f = j.locations || [];
            setFound(f); setBadge(f.length ? `${f.length} found` : 'No match');
            const keyHint = (j.errors || []).find(x => /Missing api_key|HTTP 401|HTTP 403/i.test(x));
            setEmpty(keyHint ? `No match. ${keyHint}` : `Nothing found for "${code}" — type the address manually.`);
            setOpen(true);
        }, 400);
    };

    const { className = '', ...rest } = inputProps;
    return <>
        <div className="relative">
            <input {...rest} ref={input} className={className} value={value} onChange={e => typed(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} />
            <span id={badgeId} className={`absolute right-3 top-1/2 -translate-y-1/2 pill-tag pill-gray${badgeHidden ? ' hidden' : ''}`}>{badge}</span>
        </div>
        <div id={listId} ref={list} className={`${open ? '' : 'hidden '}absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5 max-h-60 overflow-y-auto custom-scrollbar`}>
            {found.length ? found.map((l, i) => (
                <button key={i} type="button" data-i={i} onClick={() => { setOpen(false); onPick(l); }} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F8F8FA] text-left">
                    <span className="min-w-0"><span className="block text-xs font-extrabold truncate">{[l.building, l.street, l.postOffice].filter(Boolean).join(' · ') || l.city}</span>
                        <span className="block text-[10px] text-gray-400 truncate">{[l.wilayat || l.city, l.state].filter(Boolean).join(', ')}</span></span>
                    <span className="pill-tag pill-coral font-mono flex-shrink-0">{l.shortAddress || l.postalCode || ''}</span>
                </button>
            )) : <p className="p-3 text-xs text-gray-400 text-center">{empty}</p>}
        </div>
    </>;
}
