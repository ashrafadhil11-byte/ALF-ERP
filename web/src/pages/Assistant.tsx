// AI Assistant — ask the ERP in plain words ("how many shipments are in customs?"). Data: /api/assistant.
// It reads live data only, within what this user may see. Until an AI provider with a key is added in
// Admin → Integrations, the page explains how to switch it on.
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { PageLink } from '../components/PageLink';
import { api } from '../lib/api';
import { session } from '../lib/session';

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; error?: boolean };
const IDEAS = ['How many shipments did we book today?', 'Which shipments are stuck in customs?', 'Shipments to India this week, by status', "Today's summary for my branch", 'Find customer Ahmed'];
const TOOL: Record<string, string> = { find_shipments: 'shipments', count_shipments: 'counts', shipment_details: 'shipment history', daily_summary: 'daily summary', customer_lookup: 'customers' };

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
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { api<{ ready: boolean; provider: { name: string; model?: string } | null }>('/api/assistant').then(d => { setReady(d.ready); setProvider(d.provider); }).catch(() => setReady(false)); }, []);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy]);

    async function send(text = q) {
        const question = text.trim();
        if (!question || busy) return;
        const history = turns.filter(t => !t.error).map(({ role, content }) => ({ role, content }));
        setTurns(t => [...t, { role: 'user', content: question }]); setQ(''); setBusy(true);
        try {
            const r = await api<{ answer: string; tools: string[] }>('/api/assistant', { method: 'POST', body: { question, history } });
            setTurns(t => [...t, { role: 'assistant', content: r.answer || 'No answer.', tools: r.tools }]);
        } catch (e) { setTurns(t => [...t, { role: 'assistant', content: (e as Error).message, error: true }]); }
        finally { setBusy(false); }
    }

    return <AppFrame>
        <div className="flex-1 min-h-0 flex flex-col">
            <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 mb-4 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E86D58] to-[#111827] text-white flex items-center justify-center"><Icon name="sparkles" /></div>
                    <div><div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">AI Assistant</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{provider ? `Ask the ERP • ${provider.name}${provider.model ? ' · ' + provider.model : ''} • read-only` : 'Ask the ERP in plain words • read-only'}</p></div>
                </div>
                {turns.length > 0 && <button type="button" className="btn btn-light btn-sm self-start" onClick={() => setTurns([])}><Icon name="refresh" />New conversation</button>}
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
                                {t.tools && t.tools.length > 0 && <p className="text-[10px] text-gray-400 pt-1">{`Looked at: ${[...new Set(t.tools.map(x => TOOL[x] || x))].join(', ')}`}</p>}</div></div>)}
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
