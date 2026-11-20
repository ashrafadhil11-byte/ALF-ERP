// To-do — my own list (nobody else sees it). Farah can add to it, tick things off and help get each one done:
// "Ask Farah" opens her chat with the to-do ready to send. Data: /api/todos
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppFrame } from '../components/frame/AppFrame';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

type Todo = { id: number; title: string; notes?: string | null; due_date?: string | null; link?: string | null; source: 'me' | 'farah'; done_at?: string | null; created_at: string };

const today = () => new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 10);       // Oman day
const plus = (n: number) => new Date(Date.now() + 4 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const nice = (d: string) => d === today() ? 'Today' : d === plus(1) ? 'Tomorrow' : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const appHref = (link: string) => '/app/' + link.replace(/\.html/, '');

export function Todo() {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['todos'], queryFn: () => api<{ todos: Todo[] }>('/api/todos') });
    const [title, setTitle] = useState('');
    const [due, setDue] = useState('');
    const [busy, setBusy] = useState(false);
    const list = q.data?.todos || [];

    const groups = useMemo(() => {
        const open = list.filter(t => !t.done_at);
        return [
            ['Overdue', open.filter(t => t.due_date && t.due_date < today())],
            ['Today', open.filter(t => t.due_date === today())],
            ['Coming up', open.filter(t => t.due_date && t.due_date > today())],
            ['Any time', open.filter(t => !t.due_date)],
            ['Done', list.filter(t => t.done_at)]
        ].filter(([, l]) => (l as Todo[]).length) as [string, Todo[]][];
    }, [list]);

    async function act(body: Record<string, unknown>, ok?: string) {
        try { await api('/api/todos', { method: 'POST', body }); if (ok) toast(true, ok); qc.invalidateQueries({ queryKey: ['todos'] }); }
        catch (e) { toast(false, (e as Error).message); }
    }
    async function add(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        await act({ action: 'add', title, due_date: due || undefined });
        setTitle(''); setDue(''); setBusy(false);
    }
    const askFarah = (t: Todo) => location.assign(`/app/messages?farah=1&ask=${encodeURIComponent(`Help me with my to-do: "${t.title}"${t.due_date ? ` (due ${t.due_date})` : ''}`)}`);
    const open = list.filter(t => !t.done_at).length;

    return <AppFrame>
        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
            <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 mb-5 border-b border-gray-100 gap-4">
                <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                    <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="checkCircle" /></div>
                    <div><div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">To-do</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                        <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">{open ? `${open} open · only you see this list` : 'Only you see this list'}</p></div>
                </div>
                <a href={`/app/messages?farah=1&ask=${encodeURIComponent('What should I do today?')}`} className="btn btn-light btn-sm self-start"><Icon name="sparkles" />Plan my day with Farah</a>
            </section>

            <form id="todoAdd" onSubmit={add} className="flex flex-col sm:flex-row gap-2 mb-6">
                <input id="todoTitle" className="field flex-1" placeholder="Add a to-do — e.g. Call the agent about MAWB EAG-01" value={title} maxLength={300} onChange={e => setTitle(e.target.value)} aria-label="New to-do" />
                <div className="flex gap-2">
                    <select className="field !w-auto" value={due === '' ? '' : due === today() ? 't' : due === plus(1) ? 'm' : 'd'} aria-label="When"
                        onChange={e => setDue(e.target.value === 't' ? today() : e.target.value === 'm' ? plus(1) : e.target.value === 'd' ? plus(2) : '')}>
                        <option value="">Any time</option><option value="t">Today</option><option value="m">Tomorrow</option><option value="d">Pick a day…</option>
                    </select>
                    {due && due !== today() && due !== plus(1) && <input type="date" className="field !w-auto" value={due} min={today()} onChange={e => setDue(e.target.value)} aria-label="Due day" />}
                    <button type="submit" className="btn btn-coral" disabled={!title.trim() || busy}><Icon name="plus" />Add</button>
                </div>
            </form>

            {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-14 rounded-2xl bg-[#F8F8FA] animate-pulse" />)}</div>
                : !list.length ? <div className="text-center py-16"><span className="mx-auto w-16 h-16 rounded-[1.5rem] bg-[#FFF5F3] text-[#E86D58] flex items-center justify-center mb-4"><Icon name="checkCircle" cls="w-7 h-7" /></span>
                    <p className="font-extrabold">Nothing to do yet 🎉</p><p className="text-sm text-gray-400 mt-1">Add one above — or just tell Farah "remind me to…" in Messages.</p></div>
                : groups.map(([name, items]) => <section key={name} className="mb-6" data-group={name}>
                    <h3 className={`text-[11px] font-extrabold uppercase tracking-wider mb-2 ${name === 'Overdue' ? 'text-[#D55C48]' : 'text-gray-400'}`}>{`${name} · ${items.length}`}</h3>
                    <ul className="space-y-1.5">{items.map(t => <li key={t.id} data-todo={t.id} className="group flex items-start gap-3 bg-[#F8F8FA] hover:bg-white hover:shadow-sm rounded-2xl px-4 py-3 transition">
                        <button type="button" aria-label={t.done_at ? 'Mark not done' : 'Mark done'} onClick={() => act({ action: t.done_at ? 'undo' : 'done', id: t.id }, t.done_at ? undefined : 'Done ✓')}
                            className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${t.done_at ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-[#E86D58]'}`}>{t.done_at && <Icon name="check" cls="w-3 h-3" />}</button>
                        <div className="min-w-0 flex-1">
                            <p className={`text-sm font-bold break-words ${t.done_at ? 'line-through text-gray-400' : 'text-gray-800'}`}>{t.title}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-3">
                                {t.due_date && <span className={!t.done_at && t.due_date < today() ? 'text-[#D55C48] font-bold' : ''}>{nice(t.due_date)}</span>}
                                {t.source === 'farah' && <span className="inline-flex items-center gap-1"><Icon name="sparkles" cls="w-3 h-3" />added by Farah</span>}
                                {t.link && <a href={appHref(t.link)} className="font-bold text-[#E86D58]">Open</a>}
                                {t.notes && <span className="text-gray-500">{t.notes}</span>}
                            </p>
                        </div>
                        {!t.done_at && <button type="button" className="btn btn-light btn-sm opacity-70 group-hover:opacity-100" onClick={() => askFarah(t)} title="Farah helps you get it done"><Icon name="sparkles" cls="w-3.5 h-3.5" />Ask Farah</button>}
                        <button type="button" className="icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Delete" onClick={() => act({ action: 'delete', id: t.id })}><Icon name="trash" cls="w-3.5 h-3.5" /></button>
                    </li>)}</ul>
                </section>)}
        </div>
    </AppFrame>;
}
