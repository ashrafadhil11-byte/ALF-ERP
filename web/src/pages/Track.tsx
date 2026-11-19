// Customer tracking — same page as track.html: look up an AWB, see progress and history, and rate the delivery
// when the link has a review token (?r=…). Public: no sign-in. Data: GET/POST /api/track
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePublicPage } from '../lib/publicPage';
import './track.css';

const STEPS: [string, number][] = [['Booked', 1], ['Received', 2], ['In transit', 3], ['Customs', 6], ['Out for delivery', 7], ['Delivered', 8]];
type Data = { awb: string; status: string; stage: number; origin?: string; destination?: string; pieces?: number; events: { status: string; at: string; location?: string }[]; review: { can_review: boolean; done: boolean; rating?: number } };

export function Track() {
    usePublicPage('track', 'bg-[#ECECEF] min-h-screen antialiased text-gray-900 font-sans p-3 sm:p-6', 'Track Shipment - Al-Farha Cargo', { noManifest: true });
    useLayoutEffect(() => {
        const m = document.createElement('meta');
        m.name = 'description'; m.content = 'Track your Al-Farha Cargo shipment and rate your delivery.';
        document.head.appendChild(m);
        return () => m.remove();
    }, []);
    const params = useRef(new URLSearchParams(location.search)).current;
    const token = params.get('r') || '';
    const [awb, setAwb] = useState(params.get('awb') || '');
    const [msg, setMsg] = useState<string | null>(null);
    const [d, setD] = useState<Data | null>(null);
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);

    async function track(a: string) {
        setD(null); setMsg('Looking up your shipment…');
        try {
            const r = await fetch(`/api/track?awb=${encodeURIComponent(a)}${token ? `&r=${encodeURIComponent(token)}` : ''}`);
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'Tracking is unavailable.');
            setMsg(null); setSent(false); setD(j);
        } catch (e) { setMsg((e as Error).message); }
    }
    useEffect(() => { if (params.get('awb')) track(params.get('awb')!); /* eslint-disable-next-line */ }, []);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const a = awb.trim().toUpperCase().replace(/\s+/g, '');
        if (!a) return;
        history.replaceState(null, '', `?awb=${encodeURIComponent(a)}${token ? `&r=${token}` : ''}`);
        track(a);
    };
    const sendReview = async () => {
        setSending(true);
        try {
            const r = await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, rating, comment }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error);
            setSent(true);
        } catch (e) { alert((e as Error).message || 'Could not send your review.'); }
        setSending(false);
    };

    const reached = d ? STEPS.filter(([, s]) => d.stage >= s).length : 0;
    const showReview = !!d && d.review.can_review && !sent;
    const showThanks = !!d && (sent || (d.review.done && !!token));
    const thanksStars = sent ? rating : d?.review.done ? d.review.rating || 0 : 0;

    return <>
        <main className="max-w-2xl mx-auto bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.08)] p-5 sm:p-8">
            <header className="flex items-center justify-between gap-3 pb-5 mb-6 border-b border-gray-100">
                <img src="/assets/LOGO%20BG%20W.svg" alt="Al-Farha Cargo" className="h-10 w-auto object-contain" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Shipment tracking</span>
            </header>

            <form id="f" className="flex gap-2 mb-6" onSubmit={submit}>
                <label htmlFor="awb" className="sr-only">Tracking number</label>
                <input id="awb" className="field font-mono uppercase" placeholder="Enter tracking / AWB number" autoComplete="off" required value={awb} onChange={e => setAwb(e.target.value)} />
                <button className="px-5 rounded-2xl bg-[#111827] text-white text-sm font-extrabold hover:bg-black">Track</button>
            </form>

            <p id="msg" className={`${msg === null ? 'hidden ' : ''}text-center text-sm text-gray-500 py-10`}>{msg ?? ''}</p>

            <section id="result" className={`${d ? '' : 'hidden '}space-y-6`}>
                <div className="bg-[#111827] text-white rounded-[2rem] p-6">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-white/50">Tracking no.</p>
                    <p id="rAwb" className="font-mono text-xl font-extrabold">{d?.awb}</p>
                    <p id="rStatus" className="mt-4 text-2xl font-extrabold text-[#F7A99A]">{d?.status}</p>
                    <p id="rRoute" className="text-xs text-white/60 mt-1">{d ? [d.origin, d.destination].filter(Boolean).join('  →  ') + (d.pieces ? `  ·  ${d.pieces} piece${d.pieces > 1 ? 's' : ''}` : '') : ''}</p>
                    <ol id="steps" className="grid grid-cols-6 gap-1.5 mt-5" aria-label="Progress">{d && STEPS.map((_, i) => <li key={i} className={`h-1.5 rounded-full ${i < reached ? 'bg-[#E86D58]' : 'bg-white/15'}`}></li>)}</ol>
                    <div id="stepLabels" className="grid grid-cols-6 gap-1.5 mt-2 text-[9px] sm:text-[10px] font-bold text-white/50">{d && STEPS.map(([l], i) => <span key={l} className={i < reached ? 'text-white' : ''}>{l}</span>)}</div>
                </div>

                <div id="review" className={`${showReview ? '' : 'hidden '}bg-[#FFF5F3] border border-[#FFE8E3] rounded-[2rem] p-6`}>
                    <h2 className="font-extrabold">How was your delivery?</h2>
                    <p className="text-xs text-gray-500 mt-1">Your rating helps us serve you better.</p>
                    <div id="stars" className="flex gap-1 my-4" role="radiogroup" aria-label="Rating">
                        {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={`star text-4xl leading-none${n <= rating ? ' on' : ''}`} data-n={n} role="radio" aria-checked={n === rating} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}>★</button>)}
                    </div>
                    <label htmlFor="comment" className="sr-only">Comment</label>
                    <textarea id="comment" rows={3} maxLength={1000} className="field" placeholder="Anything you'd like to tell us? (optional)" value={comment} onChange={e => setComment(e.target.value)}></textarea>
                    <button id="sendReview" className="mt-3 w-full py-3 rounded-2xl bg-[#E86D58] hover:bg-[#D55C48] text-white text-sm font-extrabold disabled:opacity-50" disabled={!rating || sending} onClick={sendReview}>{sending ? 'Sending…' : 'Send review'}</button>
                </div>
                <div id="thanks" className={`${showThanks ? '' : 'hidden '}bg-emerald-50 border border-emerald-100 rounded-[2rem] p-6 text-center`}>
                    <p className="font-extrabold text-emerald-700">Thank you for your review!</p>
                    <p id="thanksStars" className="text-amber-500 text-xl mt-1">{'★'.repeat(thanksStars)}</p>
                </div>

                <div>
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-3">History</h2>
                    <ol id="events" className="relative border-l-2 border-gray-100 ml-2 space-y-5">
                        {d && (d.events.length ? d.events.map((e, i) => (
                            <li key={i} className="pl-5 relative">
                                <span className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full ${i === 0 ? 'bg-[#E86D58] ring-4 ring-[#FFE8E3]' : 'bg-gray-300'}`}></span>
                                <p className="text-sm font-extrabold">{e.status}</p>
                                <p className="text-xs text-gray-400">{new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + (e.location ? ' · ' + e.location : '')}</p>
                            </li>
                        )) : <li className="pl-5 text-xs text-gray-400">No updates yet.</li>)}
                    </ol>
                </div>
            </section>
        </main>
        <p className="text-center text-[10px] text-gray-400 mt-4">© Al-Farha Cargo</p>
    </>;
}
