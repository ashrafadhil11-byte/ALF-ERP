// Popups opened from code (confirm, camera, box picker). Each one is a React element rendered by <DialogHost/>;
// the functions return promises like UI.confirm / UI.pickBoxes did.
import { useEffect, useRef, type ReactNode } from 'react';
import { createStore, useStore } from './store';

type Entry = { id: number; node: ReactNode };
const open = createStore<Entry[]>([]);
let seq = 0;

/** Show a popup; `render(close)` draws it. Returns a function that removes it. */
export function showDialog(render: (close: () => void) => ReactNode) {
    const id = ++seq;
    const close = () => open.set(list => list.filter(d => d.id !== id));
    open.set(list => [...list, { id, node: render(close) }]);
    return close;
}

export function DialogHost() {
    const list = useStore(open);
    return <>{list.map(d => <div key={d.id} style={{ display: 'contents' }}>{d.node}</div>)}</>;
}

type ConfirmOpts = { title: string; message: ReactNode; confirmText?: string; danger?: boolean };

/** Styled confirm dialog (same look and keys as UI.confirm). Resolves true / false. */
export function confirm({ title, message, confirmText = 'Confirm', danger = false }: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) => {
        const close = showDialog(() => <ConfirmDialog title={title} message={message} confirmText={confirmText} danger={danger} done={(v) => { close(); resolve(v); }} />);
    });
}

function ConfirmDialog({ title, message, confirmText, danger, done }: Required<ConfirmOpts> & { done: (v: boolean) => void }) {
    const ok = useRef<HTMLButtonElement>(null);
    useEffect(() => { ok.current?.focus(); }, []);
    return (
        <div className="ui-modal open" data-confirm="1" onClick={(e) => { if (e.target === e.currentTarget) done(false); }}>
            <div className="panel max-w-md" role="dialog" aria-modal="true" aria-labelledby="cfTitle">
                <h3 id="cfTitle" className="text-lg font-extrabold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">{message}</p>
                <div className="flex justify-end gap-2 mt-6">
                    <button type="button" data-v="0" className="btn btn-light" onClick={() => done(false)}>Cancel</button>
                    <button type="button" data-v="1" ref={ok} className={`btn ${danger ? 'btn-coral' : 'btn-dark'}`} onClick={() => done(true)}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
}
