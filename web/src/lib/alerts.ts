// New-message alerts: a short chime (made in the browser, no sound file) and a system notification.
// Sound is on unless the user mutes it (remembered on this device). System notifications need the browser's
// permission, asked only when the user presses "Turn on" (browsers block asking without a click).

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const soundOn = () => read('alf_chat_sound') !== '0';
export const setSound = (on: boolean) => write('alf_chat_sound', on ? '1' : '0');

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyState = (): NotificationPermission | 'unsupported' => (canNotify() ? Notification.permission : 'unsupported');
export async function askNotify(): Promise<NotificationPermission | 'unsupported'> {
    if (!canNotify()) return 'unsupported';
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

let ctx: AudioContext | null = null;
/** Two soft notes, about half a second. Silent until the page has had a click (browser rule). */
export function chime() {
    if (!soundOn()) return;
    try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = ctx || new AC();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const t = ctx.currentTime;
        [[880, 0], [1318.5, 0.12]].forEach(([f, d]) => {
            const o = ctx!.createOscillator(), g = ctx!.createGain();
            o.type = 'sine'; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t + d);
            g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.38);
            o.connect(g).connect(ctx!.destination);
            o.start(t + d); o.stop(t + d + 0.4);
        });
    } catch { /* no audio */ }
}

/** A system notification (through the service worker when there is one, so it also works in the installed app). */
export async function systemNotify(title: string, body: string, url: string, tag: string) {
    if (!canNotify() || Notification.permission !== 'granted') return;
    const opts: NotificationOptions & { renotify?: boolean } = { body: body.slice(0, 180), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag, renotify: true, data: { url } };
    try {
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
        if (reg) { await reg.showNotification(title, opts); return; }
    } catch { /* fall back below */ }
    try {
        const n = new Notification(title, opts);
        n.onclick = () => { window.focus(); location.href = url; n.close(); };
    } catch { /* some phones only allow it through the service worker */ }
}
