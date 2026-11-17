// WhatsApp: one dedicated window, reused for every chat — same as UI.whatsapp in the old pages.
// WhatsApp Web cannot be shown inside another site (it blocks embedding), so the ERP keeps a single
// WhatsApp window docked to the right of the screen and sends every "chat" to it.
import { toast } from './toast';

let waWin: Window | null = null;
export const whatsappOpen = () => Boolean(waWin && !waWin.closed);

export function whatsapp(phone?: string, text?: string) {
    const digits = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
    const url = digits ? `https://web.whatsapp.com/send?phone=${digits}${text ? `&text=${encodeURIComponent(text)}` : ''}` : 'https://web.whatsapp.com/';
    const s = screen as Screen & { availLeft?: number; availTop?: number };
    const w = Math.min(980, Math.round(s.availWidth * 0.5)), h = s.availHeight;
    const left = (s.availLeft || 0) + s.availWidth - w, top = s.availTop || 0;
    if (!whatsappOpen() || digits) waWin = window.open(url, 'alf_whatsapp', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!waWin) { toast(false, 'Allow pop-ups for this site to open WhatsApp.'); return null; }
    try { waWin.focus(); } catch { /* ignore */ }
    return waWin;
}
