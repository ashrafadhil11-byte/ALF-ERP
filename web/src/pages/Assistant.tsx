// AI Assistant — ask the ERP in plain words ("how many shipments are in customs?"). Data: /api/assistant.
// It reads live data within what this user may see. Jobs it prepares (status updates, pickups, messages, reports)
// come back as cards: nothing changes until the user taps Confirm. Until an AI provider with a key is added in
// Admin → Integrations, the page explains how to switch it on.
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { PageLink } from '../components/PageLink';
import { api } from '../lib/api';
import { session } from '../lib/session';

type Action = { id: string; kind: string; title: string; lines: string[]; payload: unknown };
type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; error?: boolean; actions?: Action[] };
type Run = { state: 'busy' | 'done' | 'cancelled' | 'error'; message?: string };
const IDEAS = ['How many shipments did we book today?', 'Profit this month', 'Packing-material stock', 'Which shipments are stuck in customs?', 'Send me the daily summary every morning'];
const TOOL: Record<string, string> = { find_shipments: 'shipments', count_shipments: 'counts', shipment_details: 'shipment history', daily_summary: 'daily summary', customer_lookup: 'customers', erp_read: 'ERP pages', profit_report: 'accounts', my_reports: 'your reports' };

// **bold** and line breaks only — answers are plain text
function Answer({ text }: { text: string }) {
    return <>{text.split('\n').map((line, i) => <p key={i} className={line.trim() ? '' : 'h-2'}>{line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => /^\*\*.+\*\*$/.test(p) ? <b key={j}>{p.slice(2, -2)}</b> : <span key={j}>{p}</span>)}</p>)}</>;
}

export function Assistant() {
    const [ready, setReady] = useState<boolean | null>(null);
    const [provider, setProvider] = useState<{ name: string; model?: string } | null>(null);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [q, setQ] = useState('');
    const [busy, setBusy] = useState(false);
    const [runs, setRuns] = useState<Record<string, Run>>({});
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { api<{ ready: boolean; provider: { name: string; model?: string } | null }>('/api/assistant').then(d => { setReady(d.ready); setProvider(d.provider); }).catch(() => setReady(false)); }, []);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy]);

    async function send(text = q) {
        const question = text.trim();
        if (!question || busy) return;
        const history = turns.filter(t => !t.error).map(({ role, content }) => ({ role, content }));
        setTurns(t => [...t, { role: 'user', content: question }]); setQ(''); setBusy(true);
        try {
            const r = await api<{ answer: string; tools: string[]; actions?: Action[] }>('/api/assistant', { method: 'POST', body: { question, history } });
            setTurns(t => [...t, { role: 'assistant', content: r.answer || (r.actions?.length ? 'Please check and confirm:' : 'No answer.'), tools: r.tools, actions: r.actions }]);
        } catch (e) { setTurns(t => [...t, { role: 'assistant', content: (e as Error).message, error: true }]); }
        finally { setBusy(false); }
    }

    // the user confirms a job the AI prepared: it is done through the normal API, with their permissions
    async function run(a: Action) {
        setRuns(r => ({ ...r, [a.id]: { state: 'busy' } }));
        try {
            const r = await api<{ message: string }>('/api/assistant', { method: 'POST', body: { action: 'run', proposal: { kind: a.kind, payload: a.payload } } });
            setRuns(x => ({ ...x, [a.id]: { state: 'done', message: r.message } }));
        } catch (e) { setRuns(x => ({ ...x, [a.id]: { state: 'error', message: (e as Error).message } })); }
    }

    return <AppFrame>
        <div className="flex-1 min-h-0 flex flex-col">
            <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 mb-4 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E86D58] to-[#111827] text-white flex items-center justify-center"><Icon name="sparkles" /></div>
                    <div><div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">AI Assistant</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{provider ? `Ask the ERP • ${provider.name}${provider.model ? ' · ' + provider.model : ''} • asks before any change` : 'Ask the ERP in plain words • asks before any change'}</p></div>
                </div>
                {turns.length > 0 && <button type="button" className="btn btn-light btn-sm self-start" onClick={() => { setTurns([]); setRuns({}); }}><Icon name="refresh" />New conversation</button>}
            </section>

            {ready === false ? <div id="aiOff" className="flex-1 flex items-center justify-center p-6"><div className="max-w-md text-center">
                <span className="mx-auto w-16 h-16 rounded-[1.5rem] bg-[#FFF5F3] text-[#E86D58] flex items-center justify-center mb-4"><Icon name="sparkles" cls="w-7 h-7" /></span>
                <h3 className="text-lg font-extrabold">The assistant is ready — it only needs a key</h3>
                <p className="text-sm text-gray-500 mt-2">Add an AI provider in <b>Integrations</b>: choose <b>Claude (Anthropic)</b> or <b>OpenAI-compatible</b>, paste its API key, save and switch it on. Then ask questions like "which shipments are stuck in customs?".</p>
                {session.role() === 'super_admin' && <PageLink page="integrations.html" className="btn btn-coral mt-5 inline-flex"><Icon name="link" />Open Integrations</PageLink>}
            </div></div> : <>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-4" id="aiTurns">
                    {!turns.length && <div className="py-10 text-center">
                        <p className="text-xl font-extrabold">What would you like to know?</p>
                        <p className="text-sm text-gray-400 mt-1">Answers come from live ERP data{session.isAdmin() ? '' : ' of your branch'}.</p>
                        <div className="flex flex-wrap justify-center gap-2 mt-5">{IDEAS.map(i => <button key={i} type="button" disabled={!ready} className="btn btn-light btn-sm" onClick={() => send(i)}>{i}</button>)}</div>
                    </div>}
                    {turns.map((t, i) => t.role === 'user'
                        ? <div key={i} className="flex justify-end"><div className="max-w-[80%] bg-[#111827] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm">{t.content}</div></div>
                        : <div key={i} className="flex gap-3"><span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#E86D58] to-[#111827] text-white flex items-center justify-center flex-shrink-0"><Icon name="sparkles" cls="w-4 h-4" /></span>
                            <div className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 text-sm space-y-1 ${t.error ? 'bg-[#FFF5F3] text-[#D55C48]' : 'bg-[#F8F8FA] text-gray-800'}`}>
                                <Answer text={t.content} />
                                {t.actions?.map(a => { const st = runs[a.id]; return <div key={a.id} className="ai-action mt-2 bg-white border border-gray-200 rounded-xl p-3 space-y-1">
                                    <p className="font-extrabold text-gray-900">{a.title}</p>
                                    {a.lines.map((l, j) => <p key={j} className="text-xs text-gray-500 break-words">{l}</p>)}
                                    {!st || st.state === 'error' ? <div className="flex gap-2 pt-1.5">
                                        <button type="button" className="btn btn-coral btn-sm" onClick={() => run(a)}><Icon name="check" />Confirm</button>
                                        <button type="button" className="btn btn-light btn-sm" onClick={() => setRuns(x => ({ ...x, [a.id]: { state: 'cancelled' } }))}>Cancel</button>
                                    </div> : null}
                                    {st?.state === 'busy' && <p className="text-xs text-gray-400 pt-1">Doing it…</p>}
                                    {st?.state === 'done' && <p className="text-xs font-bold text-emerald-600 pt-1">{`✓ ${st.message || 'Done.'}`}</p>}
                                    {st?.state === 'cancelled' && <p className="text-xs text-gray-400 pt-1">Cancelled — nothing was changed.</p>}
                                    {st?.state === 'error' && <p className="text-xs font-bold text-[#D55C48]">{st.message}</p>}
                                </div>; })}
                                {t.tools && t.tools.some(x => !x.startsWith('propose_')) && <p className="text-[10px] text-gray-400 pt-1">{`Looked at: ${[...new Set(t.tools.filter(x => !x.startsWith('propose_')).map(x => TOOL[x] || x))].join(', ')}`}</p>}</div></div>)}
                    {busy && <div className="flex gap-3"><span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#E86D58] to-[#111827] text-white flex items-center justify-center"><Icon name="sparkles" cls="w-4 h-4 animate-pulse" /></span>
                        <div className="bg-[#F8F8FA] rounded-2xl px-4 py-3 text-sm text-gray-400">Looking it up…</div></div>}
                    <div ref={end} />
                </div>
                <form className="flex items-end gap-2 pt-4 border-t border-gray-100 mt-2" onSubmit={e => { e.preventDefault(); send(); }}>
                    <textarea id="aiInput" rows={1} value={q} maxLength={1000} disabled={!ready} placeholder={ready ? 'Ask about shipments, customers, today…' : 'Checking the assistant…'} aria-label="Question"
                        onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        className="flex-1 resize-none bg-[#F8F8FA] rounded-[1.4rem] border border-transparent focus:border-gray-200 focus:bg-white outline-none px-4 py-3 text-sm" />
                    <button type="submit" disabled={!q.trim() || busy || !ready} className="w-11 h-11 rounded-full bg-[#E86D58] text-white flex items-center justify-center disabled:opacity-40" aria-label="Ask"><Icon name="send" cls="w-[18px] h-[18px]" /></button>
                </form>
            </>}
        </div>
    </AppFrame>;
}
