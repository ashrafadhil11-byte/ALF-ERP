// A number in a list that can be changed only on purpose: it shows as text with a pencil; tapping it opens a box with
// ✓ (or Enter) to save and ✕ (or Esc) to cancel. A big jump (more than 3× up or down) asks first.
// Use it for prices, rates and levels shown in tables, where an open box could be changed by accident.
import { useState } from 'react';
import { Icon } from '../Icon';
import { confirm } from '../../lib/dialogs';

type Props = {
    value: number | string | null | undefined;
    onSave: (v: string) => Promise<unknown> | unknown;
    label: string;                         // for screen readers and the confirm question, e.g. "Price to branches for Box M"
    format?: (v: number) => string;        // how the saved value is shown
    step?: string; min?: number; width?: string; empty?: string;
};

export function SafeNumber({ value, onSave, label, format = (v) => String(v), step = 'any', min = 0, width = '!w-28', empty = '—' }: Props) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const has = value !== null && value !== undefined && value !== '';
    const cur = has ? Number(value) : null;

    if (!open) return <button type="button" data-safe-edit className="safe-num inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -mx-2 hover:bg-[#F8F8FA] font-bold tabular-nums group"
        aria-label={`${label}: ${has ? format(cur!) : 'not set'} — edit`} title="Tap to change" onClick={() => { setDraft(has ? String(value) : ''); setOpen(true); }}>
        <span className={has ? '' : 'text-gray-300'}>{has ? format(cur!) : empty}</span>
        <Icon name="edit" cls="w-3 h-3 text-gray-300 group-hover:text-[#E86D58]" />
    </button>;

    const cancel = () => { setOpen(false); setDraft(''); };
    async function save() {
        const n = Number(draft);
        if (draft.trim() === '' && !has) return cancel();
        if (draft.trim() !== '' && (!Number.isFinite(n) || n < min)) return;
        if (has && draft.trim() !== '' && n === cur) return cancel();
        if (cur && n && (n > cur * 3 || n < cur / 3)
            && !await confirm({ title: 'Big change — are you sure?', message: `${label}: ${format(cur)} → ${format(n)}`, confirmText: 'Yes, save' })) return;
        setBusy(true);
        try { await onSave(draft.trim()); setOpen(false); } finally { setBusy(false); }
    }
    return <span className="inline-flex items-center gap-1" data-safe-open>
        <input autoFocus type="number" inputMode="decimal" min={min} step={step} value={draft} disabled={busy} aria-label={label}
            className={`field !py-1.5 ${width} text-right`} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') cancel(); }} />
        <button type="button" className="icon-btn !text-emerald-600" aria-label="Save" disabled={busy} onClick={save}><Icon name="check" cls="w-4 h-4" /></button>
        <button type="button" className="icon-btn" aria-label="Cancel" disabled={busy} onClick={cancel}><Icon name="x" cls="w-4 h-4" /></button>
    </span>;
}
