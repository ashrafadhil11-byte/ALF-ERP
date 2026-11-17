// Same as UI.toast / UI.beep: bottom-right messages, green for success (4.5 s), coral for problems (8 s).
import { createStore, useStore } from './store';

type Toast = { id: number; ok: boolean; msg: string };
const toasts = createStore<Toast[]>([]);
let seq = 0;

export function toast(ok: boolean, msg: string) {
    const id = ++seq;
    toasts.set(list => [...list, { id, ok, msg }]);
    setTimeout(() => toasts.set(list => list.filter(t => t.id !== id)), ok ? 4500 : 8000);
}

/** Scanner feedback tone. */
export function beep(ok: boolean) {
    try {
        const a = new AudioContext(), o = a.createOscillator();
        o.frequency.value = ok ? 880 : 220; o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12);
    } catch { /* no audio */ }
}

export function Toaster() {
    const list = useStore(toasts);
    if (!list.length) return null;
    return (
        <div id="ui-toast" aria-live="polite">
            {list.map(t => (
                <div key={t.id} className={t.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-[#FFF5F3] text-[#D55C48] border-[#FFE8E3]'}>{t.msg}</div>
            ))}
        </div>
    );
}
