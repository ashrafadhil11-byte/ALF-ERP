// Camera barcode / QR scanning — the old UI.camera() and <input data-camera="fill|submit|click:id">.
//   camera({ title, continuous, onScan })                     opens the scanner popup
//   <ScanInput mode="fill" inputProps={{ id: 'docket', className: 'field', 'aria-label': 'Agent docket' }} />
// mode: 'fill' just fills the input · 'submit' submits its form · a function runs after the code is filled in.
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from 'react';
import { showDialog } from '../../lib/dialogs';
import { beep } from '../../lib/toast';
import { Icon } from '../Icon';

type CameraOpts = { title?: string; continuous?: boolean; onScan: (code: string) => void };

export function camera({ title = 'Scan barcode', continuous = false, onScan }: CameraOpts) {
    const close = showDialog(() => <CameraDialog title={title} continuous={continuous} onScan={onScan} close={() => close()} />);
}

function CameraDialog({ title, continuous, onScan, close }: Required<CameraOpts> & { close: () => void }) {
    const readerId = 'ui-cam-reader-' + useId().replace(/:/g, '');
    const [status, setStatus] = useState<string | null>('Starting camera…');
    const [log, setLog] = useState<string[]>([]);
    const scanner = useRef<any>(null);
    const closed = useRef(false);

    const stop = async () => {
        if (closed.current) return;
        closed.current = true;
        try { if (scanner.current?.isScanning) await scanner.current.stop(); } catch { /* ignore */ }
        close();
    };

    useEffect(() => {
        let last = '', lastAt = 0;
        (async () => {
            try {
                const { Html5Qrcode } = await import('html5-qrcode');
                if (closed.current) return;
                scanner.current = new Html5Qrcode(readerId, { verbose: false } as any);
                await scanner.current.start({ facingMode: 'environment' },
                    { fps: 10, qrbox: (w: number, h: number) => ({ width: Math.round(w * 0.8), height: Math.round(h * 0.45) }) },
                    (text: string) => {
                        const code = String(text).trim();
                        if (!code || (code === last && Date.now() - lastAt < 2500)) return;   // ignore the same code held in view
                        last = code; lastAt = Date.now();
                        beep(true);
                        if (navigator.vibrate) navigator.vibrate(60);
                        onScan(code);
                        if (continuous) setLog(l => [code, ...l]); else stop();
                    }, () => {});
                setStatus(null);
            } catch (err) {
                const s = String(err);
                setStatus(/permission|notallowed/i.test(s) ? 'Camera permission was denied. Allow camera access for this site and try again.'
                    : /notfound|no camera|devices/i.test(s) ? 'No camera found on this device.'
                        : /Failed to fetch|dynamically imported/i.test(s) ? 'Could not load the scanner. Check your connection.' : ((err as Error).message || s));
            }
        })();
        return () => { if (!closed.current) { closed.current = true; try { if (scanner.current?.isScanning) scanner.current.stop(); } catch { /* ignore */ } } };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="ui-modal open" onClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).closest('[data-close]')) stop(); }}>
            <div className="panel max-w-md !p-5" role="dialog" aria-modal="true" aria-label={title}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2"><span className="w-8 h-8 rounded-full bg-[#111827] text-white flex items-center justify-center"><Icon name="camera" /></span>
                        <div><p className="text-sm font-extrabold">{title}</p><p data-hint className="text-[11px] text-gray-400">{continuous ? 'Keep scanning — each code is added' : 'Point the camera at the barcode'}</p></div></div>
                    <button type="button" data-close className="icon-btn bg-[#F8F8FA]" aria-label="Close camera"><Icon name="x" /></button>
                </div>
                <div className="relative rounded-[1.5rem] overflow-hidden bg-black aspect-[4/3]"><div id={readerId} className="w-full h-full"></div>
                    {status && <p data-status className="absolute inset-0 flex items-center justify-center px-8 text-center text-xs font-bold text-white/80 leading-relaxed">{status}</p>}</div>
                {continuous && <div data-log className="flex flex-wrap gap-1.5 mt-3 min-h-[26px]">{log.map((c, i) => <span key={i} className="pill-tag pill-dark">{c}</span>)}</div>}
                <button type="button" data-close className="btn btn-dark w-full mt-4">{continuous ? 'Done' : 'Cancel'}</button>
            </div>
        </div>
    );
}

type ScanProps = {
    /** 'fill' (default for forms), 'submit', or a function called after the code is put in the box */
    mode?: 'fill' | 'submit' | ((code: string) => void);
    continuous?: boolean;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

/** A text box with a round camera button inside it (same look as the old data-camera inputs). */
export const ScanInput = forwardRef<HTMLInputElement, ScanProps>(function ScanInput({ mode = 'submit', continuous = false, inputProps = {} }, ref) {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => input.current!);
    const { className = '', ...rest } = inputProps;
    const label = inputProps['aria-label'];
    const open = () => camera({
        title: label ? `Scan ${label}` : 'Scan barcode',
        continuous,
        onScan: (code) => {
            const el = input.current!;
            // set the value the way typing does, so React and the page see the change
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, code);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            if (mode === 'fill') { beep(true); el.focus(); }
            else if (typeof mode === 'function') mode(code);
            else el.form?.requestSubmit();
        }
    });
    return (
        <div className="relative flex-1 min-w-0">
            <input {...rest} ref={input} className={`${className} !pr-14`} />
            <button type="button" onClick={open} aria-label="Scan with camera" title="Scan with camera"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center hover:bg-[#E86D58] transition-colors">
                <Icon name="camera" cls="w-[18px] h-[18px]" />
            </button>
        </div>
    );
});
