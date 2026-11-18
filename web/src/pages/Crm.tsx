// CRM · WhatsApp — same page as admin/crm.html. Pick a customer, choose a quick message, open the chat in the
// one docked WhatsApp window. Data: GET /api/customers?q=
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { whatsapp, whatsappOpen } from '../lib/whatsapp';
import './crm.css';

type Customer = { id: number; name?: string; whatsapp?: string; phone?: string; customer_no?: string; civil_id?: string; stats?: { shipments?: number } };

const track = (a?: string) => `${location.origin}/track.html?awb=${encodeURIComponent(a || '')}`;
export const TPL: Record<string, [label: string, make: (c: string, a?: string) => string, needsAwb?: boolean]> = {
    hello: ['Hello', (c) => `Hello ${c},\n\nThis is Al-Farha Cargo. How can we help you today?`],
    booked: ['Booking confirmed', (c, a) => `Hello ${c},\n\nYour booking with *Al-Farha Cargo* is confirmed.\n📦 *Tracking ID:* ${a || '—'}\n\nTrack anytime: ${track(a)}\n\nThank you for choosing Al-Farha Cargo.`, true],
    transit: ['In transit', (c, a) => `Hello ${c},\n\nGood news — your shipment *${a || ''}* is on its way.\nTrack it here: ${track(a)}`, true],
    delivery: ['Out for delivery', (c, a) => `Hello ${c},\n\nYour shipment *${a || ''}* is out for delivery today. Please keep your phone reachable.`, true],
    payment: ['Payment reminder', (c) => `Hello ${c},\n\nA friendly reminder that a payment is due on your account with Al-Farha Cargo. Please contact us or visit the branch. Thank you.`],
    review: ['Thank you / review', (c) => `Hello ${c},\n\nThank you for shipping with *Al-Farha Cargo*. We would love your feedback — it helps us serve you better.`]
};
const initials = (n?: string) => (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export function Crm() {
    const [waOn, setWaOn] = useState(whatsappOpen());
    const [q, setQ] = useState('');
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [picked, setPicked] = useState<Customer | null>(null);
    const [tpl, setTpl] = useState('hello');
    const [awb, setAwb] = useState('');
    const [text, setText] = useState(() => TPL.hello[1]('Customer'));
    const phone = useRef<PhoneHandle>(null);

    // ---------- WhatsApp window state ----------
    useEffect(() => { const t = setInterval(() => setWaOn(whatsappOpen()), 2000); return () => clearInterval(t); }, []);
    const paintSoon = () => setTimeout(() => setWaOn(whatsappOpen()), 400);

    // ---------- templates: the text is rebuilt when the template, customer or AWB changes ----------
    const fill = (k = tpl, c = picked, a = awb) => setText(TPL[k][1](c?.name || 'Customer', a.trim()));

    // ---------- customers ----------
    useEffect(() => {
        const t = setTimeout(async () => {
            try { setCustomers((await api<{ customers?: Customer[] }>(`/api/customers?q=${encodeURIComponent(q.trim())}`)).customers || []); }
            catch (e) { toast(false, (e as Error).message); setCustomers([]); }
            setLoaded(true);
        }, loaded ? 300 : 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    const pick = (c: Customer) => {
        setPicked(c);
        const num = c.whatsapp || c.phone || '';
        if (num) phone.current?.setValue(num); else phone.current?.reset();
        fill(tpl, c);
    };
    const send = () => {
        const num = phone.current?.value || '';
        if (!num.replace(/\D/g, '')) return toast(false, 'Enter the WhatsApp number.');
        whatsapp(num, text);
        paintSoon();
    };

    return (
        <AppFrame>
            <section className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-5 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm">
                    <div className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center"><Icon name="message" /></div>
                    <div>
                        <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">CRM · WhatsApp</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Chat with customers from one WhatsApp window</p>
                    </div>
                </div>
                <div className="flex items-center gap-2.5">
                    <span className="flex items-center gap-2 text-[11px] font-bold text-gray-500 bg-[#F8F8FA] border border-gray-100 rounded-full px-3.5 h-11"><span id="waDot" className={`wa-dot${waOn ? ' on' : ''}`}></span><span id="waState">{waOn ? 'WhatsApp window open' : 'WhatsApp window closed'}</span></span>
                    <button type="button" id="waOpen" className="fab fab-open fab-wa !bg-[#25D366] !border-[#25D366] !text-white" onClick={() => { whatsapp(); paintSoon(); }}><Icon name="message" /><span className="fab-label">{waOn ? 'Show WhatsApp' : 'Open WhatsApp'}</span></button>
                </div>
            </section>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 overflow-y-auto lg:overflow-visible">
                <section className="min-h-0 flex flex-col bg-[#F8F8FA] border border-gray-100 rounded-[2rem] p-4">
                    <input id="q" className="field mb-3" placeholder="Search customer by name, phone or civil ID" autoComplete="off" aria-label="Search customers" value={q} onChange={e => setQ(e.target.value)} />
                    <div id="list" className="flex-1 min-h-0 overflow-y-auto pretty-scroll space-y-2 pr-1">
                        {customers.map(c => (
                            <button key={c.id} type="button" className="cust w-full flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3 text-left hover:border-gray-200 hover:shadow-sm transition-all" data-id={c.id} aria-selected={picked?.id === c.id} onClick={() => pick(c)}>
                                <span className="w-10 h-10 rounded-2xl bg-[#111827] text-white flex items-center justify-center text-xs font-extrabold flex-shrink-0">{initials(c.name)}</span>
                                <span className="min-w-0 flex-1"><span className="block text-[13px] font-extrabold truncate">{c.name}</span><span className="block text-[11px] text-gray-400 truncate">{`${c.whatsapp || c.phone || 'No number'} · ${c.stats?.shipments ?? 0} shipments`}</span></span>
                                <span className="w-9 h-9 rounded-full bg-[#25D366]/10 text-[#128C7E] flex items-center justify-center flex-shrink-0"><Icon name="message" cls="w-4 h-4" /></span>
                            </button>
                        ))}
                        {loaded && !customers.length && <p className="text-center text-xs text-gray-400 py-10">{q ? 'No customer matches.' : 'Customers appear here as bookings are made.'}</p>}
                    </div>
                </section>

                <section className="min-h-0 flex flex-col overflow-y-auto pretty-scroll bg-white border border-gray-100 rounded-[2rem] p-5 shadow-[0_18px_40px_-24px_rgba(17,24,39,.25)]">
                    <p className="sd-label">Message</p>
                    <div id="who" className="mt-2 mb-4 flex items-center gap-3 min-w-0">
                        {picked ? <>
                            <span className="w-11 h-11 rounded-2xl bg-coral-500 text-white flex items-center justify-center text-sm font-extrabold flex-shrink-0">{initials(picked.name)}</span>
                            <div className="min-w-0"><p className="text-sm font-extrabold truncate">{picked.name}</p><p className="text-[11px] text-gray-400 truncate">{(picked.customer_no || '') + (picked.civil_id ? ' · ' + picked.civil_id : '')}</p></div>
                        </> : <>
                            <span className="w-11 h-11 rounded-2xl bg-[#F8F8FA] border border-gray-100 flex items-center justify-center text-gray-400 flex-shrink-0"><Icon name="user" /></span>
                            <div className="min-w-0"><p className="text-sm font-extrabold truncate">Pick a customer</p><p className="text-[11px] text-gray-400">or type any number below</p></div>
                        </>}
                    </div>
                    <label className="ui-label" htmlFor="phone">WhatsApp number</label>
                    <PhoneField ref={phone} country="OM" inputProps={{ id: 'phone', className: 'field', placeholder: 'Mobile number' }} />
                    <p className="ui-label mt-4">Quick message</p>
                    <div id="tpls" className="flex flex-wrap gap-1.5">
                        {Object.entries(TPL).map(([k, [label]]) => (
                            <button key={k} type="button" className="tpl px-3 py-1.5 rounded-full border border-gray-200 bg-white text-[11px] font-extrabold text-gray-600 hover:border-gray-300 transition-colors" data-tpl={k} aria-pressed={k === tpl}
                                onClick={() => { setTpl(k); fill(k); }}>{label}</button>
                        ))}
                    </div>
                    <div id="awbWrap" className={`${TPL[tpl][2] ? '' : 'hidden '}mt-3`}><label className="ui-label" htmlFor="awb">AWB</label>
                        <input id="awb" className="field font-mono" placeholder="Tracking number" value={awb} onChange={e => { setAwb(e.target.value); fill(tpl, picked, e.target.value); }} /></div>
                    <label className="ui-label mt-4" htmlFor="text">Text <span className="normal-case font-medium text-gray-400">(edit before sending)</span></label>
                    <textarea id="text" rows={6} className="field resize-none" data-nodirty="" value={text} onChange={e => setText(e.target.value)}></textarea>
                    <button type="button" id="send" className="btn btn-coral !py-3.5 mt-4 justify-center" onClick={send}><Icon name="message" />Open chat in WhatsApp</button>
                    <p className="text-[10px] text-gray-400 leading-relaxed mt-3">Chats open in one WhatsApp window that stays signed in (scan the QR code the first time). The message is filled in — press send in WhatsApp.</p>
                </section>
            </div>
        </AppFrame>
    );
}
