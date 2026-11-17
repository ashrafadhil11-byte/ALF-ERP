// A page popup — same markup as the old <div class="ui-modal" id="…"><div class="panel">…</div></div>.
// It stays in the page while closed (like the old static popups), so the screenshot checks can open it by id.
//
//   const [open, setOpen] = useState(false);
//   <Modal id="formModal" open={open} onClose={() => setOpen(false)} panelClassName="max-w-2xl">…</Modal>
//
// Clicking outside, Esc, or a button calling useDismiss() ask first when something was typed (see lib/guard.ts).
// Setting open=false from code (after a save) closes without asking.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { allowClose, dismissers, markClean } from '../lib/guard';

const DismissContext = createContext<() => void>(() => {});
/** Inside a <Modal>: close it the way a user does (asks when there are unsaved changes). */
export const useDismiss = () => useContext(DismissContext);

type Props = {
    id: string;
    open: boolean;
    onClose: () => void;
    panelClassName?: string;
    labelledBy?: string;
    children: ReactNode;
};

export function Modal({ id, open, onClose, panelClassName = '', labelledBy, children }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const dismiss = async () => {
        if (await allowClose(ref.current)) { markClean(ref.current); onCloseRef.current(); }
    };

    useLayoutEffect(() => {
        const el = ref.current!;
        dismissers.set(el, dismiss);
        return () => { dismissers.delete(el); };
    });
    // opening starts clean; closing (by code or user) forgets what was typed
    useEffect(() => { markClean(ref.current); }, [open]);

    return (
        <DismissContext.Provider value={dismiss}>
            <div id={id} ref={ref} className={`ui-modal${open ? ' open' : ''}`}>
                <div className={`panel ${panelClassName}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
                    {children}
                </div>
            </div>
        </DismissContext.Provider>
    );
}
