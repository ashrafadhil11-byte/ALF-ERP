// Staff & Users — same page as admin/create-user.html (super admin and head office only): stats, filterable team list,
// row menu (edit, password reset, deactivate / reactivate), Add User and Edit User popups with work hours and warehouse access.
// Data: /api/users, /api/create-user, /api/branches, /api/warehouse (reset PIN)
import { useEffect, useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { Icon } from '../components/Icon';
import { closeMenu, openMenu } from '../components/RowMenu';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { api } from '../lib/api';
import { confirm } from '../lib/dialogs';
import { hrefFor } from '../lib/pages';
import { session } from '../lib/session';
import { toast } from '../lib/toast';

const ROLES: Record<string, string> = { super_admin: 'Super Admin', head_office: 'Head Office', branch_manager: 'Branch Manager', staff: 'Staff' };
const ROLE_HELP: Record<string, string> = {
    super_admin: 'Everything, including other Super Admins and Integrations.',
    head_office: 'All branches and reports; manages staff (not Super Admins). No branch needed.',
    branch_manager: 'Own branch: shipments, status updates, reports, finance. Can move a status back and delete shipments.',
    staff: 'Own branch: add shipments and update statuses. No finance, no deleting.',
    driver: 'Staff account flagged as driver (pickups / deliveries).'
};
const ROLE_PILL: Record<string, string> = { super_admin: 'pill-dark', head_office: 'pill-coral', branch_manager: 'pill-amber', staff: 'pill-gray' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isGlobal = (r: string) => ['super_admin', 'head_office'].includes(r);
const hh = (v: unknown, d = '') => v ? String(v).slice(0, 5) : d;
export const ago = (iso?: string) => {
    if (!iso) return 'Never';
    const d = (Date.now() - +new Date(iso)) / 864e5;
    return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 30 ? `${Math.floor(d)} days ago` : new Date(iso).toLocaleDateString();
};
const initials = (n?: string) => String(n || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

type User = { id: string; full_name?: string; username?: string; recovery_email?: string; contact_number?: string; role: string; branch?: string; is_driver?: boolean; is_warehouse?: boolean;
    warehouse_code?: string; has_wh_pin?: boolean; is_me?: boolean; active: boolean; email_confirmed?: boolean; last_sign_in_at?: string;
    shift_start?: string; shift_end?: string; grace_min?: number; break_start?: string; break_end?: string; weekly_off?: number[] };
type Branch = { branch_code: string; branch_name: string; branch_type?: string };

function CloseX() {
    const dismiss = useDismiss();
    return <button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon name="x" /></button>;
}
function CancelBtn() {
    const dismiss = useDismiss();
    return <button type="button" className="btn btn-light" onClick={dismiss}>Cancel</button>;
}

export function Users() {
    const myRole = session.role();
    const allowed = isGlobal(myRole);
    useEffect(() => { if (!allowed) { const t = hrefFor('super-dashboard.html'); location.replace('to' in t ? '/app' + t.to : t.href); } }, [allowed]);

    const [users, setUsers] = useState<User[] | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [q, setQ] = useState(''), [roleF, setRoleF] = useState(''), [brF, setBrF] = useState(''), [actF, setActF] = useState('1');

    async function load() {
        try { const d = await api<{ users: User[] }>('/api/users'); setUsers(d.users); } catch (e) { toast(false, (e as Error).message); }
    }
    useEffect(() => {
        (async () => {
            try { const d = await api<{ branches?: Branch[] }>('/api/branches'); setBranches(d.branches || []); } catch (e) { toast(false, (e as Error).message); }
            load();
        })();
    }, []);
    const branchName = (code?: string) => (branches.find(b => b.branch_code === code) || ({} as Branch)).branch_name || code || '—';
    const roleOptions = (driver: boolean) => <>
        {Object.entries(ROLES).filter(([k]) => k !== 'super_admin' || myRole === 'super_admin').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        {driver && <option value="driver">Driver (Staff)</option>}
    </>;
    const branchOptions = branches.map(b => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} (${b.branch_code})`}</option>);

    // ---------- add ----------
    const [createOpen, setCreateOpen] = useState(false);
    const blank = { fullName: '', dob: '', omanId: '', email: '', username: '', password: '', role: '', branch: '' };
    const [c, setC] = useState(blank);
    const [cBusy, setCBusy] = useState(false);
    const cPh = useRef<PhoneHandle>(null);
    const cName = useRef<HTMLInputElement>(null);
    const openCreate = () => { setC(blank); cPh.current?.reset('OM'); setCreateOpen(true); setTimeout(() => cName.current?.focus(), 0); };
    const setRoleC = (role: string) => setC(v => ({ ...v, role, branch: isGlobal(role) ? '' : v.branch }));
    async function create(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) return e.currentTarget.reportValidity();
        const role = c.role;
        if (!role) return toast(false, 'Choose a role.');
        if (!cPh.current?.valid) return toast(false, 'Contact number looks wrong — check the country code and number.');
        const global = isGlobal(role);
        if (!global && !c.branch) return toast(false, 'Choose a branch for this role.');
        const payload = { fullName: c.fullName.trim(), dob: c.dob || null, contactNumber: cPh.current.value, recoveryEmail: c.email.trim(), omanId: c.omanId.trim(),
            username: c.username.trim(), role, branch: global ? null : c.branch, password: c.password };
        const ok = await confirm({ title: 'Create this user?', confirmText: 'Create user', message: <>
            <b>{payload.fullName}</b>{` (@${payload.username})`}<br />{`${role === 'driver' ? 'Driver (Staff)' : ROLES[role]} • ${global ? 'All branches' : branchName(payload.branch!)}`}<br />{payload.recoveryEmail}<br /><br />A verification email is sent to them.</> });
        if (!ok) return;
        setCBusy(true);
        try {
            await api('/api/create-user', { method: 'POST', body: payload });
            toast(true, `${payload.fullName} added. Ask them to verify their email.`);
            setCreateOpen(false); setTimeout(load, 800);
        } catch (err) { toast(false, (err as Error).message); }
        setCBusy(false);
    }

    // ---------- edit ----------
    const [editing, setEditing] = useState<User | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [e, setE] = useState({ name: '', role: '', branch: '', driver: false, wh: false, whCode: '', shStart: '', shEnd: '', grace: '', brStart: '', brEnd: '', off: [] as number[] });
    const ePh = useRef<PhoneHandle>(null);
    const whs = branches.filter(b => b.branch_type === 'warehouse');
    const openEdit = (u: User) => {
        closeMenu();
        setEditing(u);
        setE({ name: u.full_name || '', role: u.role, branch: isGlobal(u.role) ? '' : u.branch || '', driver: !!u.is_driver, wh: !!u.is_warehouse,
            whCode: u.warehouse_code || (whs[0]?.branch_code ?? ''), shStart: hh(u.shift_start, '09:00'), shEnd: hh(u.shift_end, '18:00'), grace: String(u.grace_min ?? 10),
            brStart: hh(u.break_start), brEnd: hh(u.break_end), off: [...(u.weekly_off || [5])] });
        ePh.current?.reset('OM'); if (u.contact_number) ePh.current?.setValue(u.contact_number, 'OM');
        setEditOpen(true);
    };
    async function saveEdit(ev: React.FormEvent) {
        ev.preventDefault();
        if (!ePh.current?.valid) return toast(false, 'Contact number looks wrong — check the country code and number.');
        const u = editing!;
        const body: Record<string, unknown> = { id: u.id, full_name: e.name, contact_number: ePh.current.value, branch: e.branch, is_driver: e.driver,
            is_warehouse: e.wh, warehouse_code: e.whCode, shift_start: e.shStart, shift_end: e.shEnd, grace_min: +e.grace,
            break_start: e.brStart, break_end: e.brEnd, weekly_off: [1, 2, 3, 4, 5, 6, 7].filter(n => e.off.includes(n)) };
        if (!u.is_me) body.role = e.role;
        const roleChanged = body.role && body.role !== u.role;
        if (roleChanged && !await confirm({ title: 'Change role?', confirmText: 'Change role', message: <>{`${u.full_name}: `}<b>{ROLES[u.role] || u.role}</b>{' → '}<b>{ROLES[body.role as string]}</b>. Their access changes at their next page load.</> })) return;
        try { await api('/api/users', { method: 'PATCH', body }); toast(true, 'User updated.'); setEditOpen(false); load(); }
        catch (err) { toast(false, (err as Error).message); }
    }
    const resetPin = async () => {
        const u = editing!;
        if (!await confirm({ title: `Reset ${u.full_name}'s warehouse PIN?`, message: 'They will set a new PIN the next time they open the Warehouse page.', confirmText: 'Reset PIN' })) return;
        try { await api('/api/warehouse', { method: 'POST', body: { action: 'reset_pin', employee_id: u.id } }); setEditing({ ...u, has_wh_pin: false }); toast(true, 'PIN reset.'); }
        catch (err) { toast(false, (err as Error).message); }
    };

    // ---------- row menu ----------
    const toggleActive = async (u: User) => {
        closeMenu();
        const ok = await confirm(u.active
            ? { title: `Deactivate ${u.full_name}?`, message: 'They are signed out and can no longer sign in. Their name stays on past shipments and history. You can reactivate them any time.', confirmText: 'Deactivate', danger: true }
            : { title: `Reactivate ${u.full_name}?`, message: 'They can sign in again with their existing password.', confirmText: 'Reactivate' });
        if (!ok) return;
        try { await api('/api/users', { method: 'PATCH', body: { id: u.id, active: !u.active } }); toast(true, u.active ? 'User deactivated.' : 'User reactivated.'); load(); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const resetPassword = async (u: User) => {
        closeMenu();
        if (!await confirm({ title: 'Send password reset?', message: <>A reset link is emailed to <b>{u.recovery_email || 'their email'}</b>.</>, confirmText: 'Send link' })) return;
        try { const r = await api<{ message: string }>('/api/users', { method: 'POST', body: { action: 'reset_password', id: u.id } }); toast(true, r.message); }
        catch (err) { toast(false, (err as Error).message); }
    };
    const userMenu = (btn: Element, u: User) => {
        const locked = u.role === 'super_admin' && myRole !== 'super_admin';
        openMenu(btn, locked ? <p className="px-3 py-2 text-[11px] text-gray-400">Only a Super Admin can change this account.</p> : <>
            <button type="button" onClick={() => openEdit(u)}><Icon name="edit" />{' Edit user'}</button>
            <button type="button" onClick={() => resetPassword(u)}><Icon name="key" />{' Send password reset'}</button>
            {!u.is_me && <><hr /><button type="button" className={u.active ? 'danger' : ''} onClick={() => toggleActive(u)}>{u.active ? <><Icon name="userX" />{' Deactivate'}</> : <><Icon name="userCheck" />{' Reactivate'}</>}</button></>}
        </>);
    };

    if (!allowed) return null;
    const active = (users || []).filter(u => u.active);
    const count = (fn: (u: User) => boolean) => active.filter(fn).length;
    const tile = (label: string, n: number, dark = false) => (
        <div key={label} className={`${dark ? 'bg-[#111827] text-white' : 'bg-[#F8F8FA] border border-gray-100'} rounded-[1.5rem] p-4`}>
            <p className="text-[10px] font-extrabold uppercase text-gray-400">{label}</p><p className="text-2xl font-extrabold mt-1">{n}</p></div>
    );
    const ql = q.trim().toLowerCase();
    const list = (users || []).filter(u =>
        (!ql || [u.full_name, u.username, u.recovery_email, u.contact_number].some(v => String(v || '').toLowerCase().includes(ql))) &&
        (!roleF || (roleF === 'driver' ? u.is_driver : u.role === roleF)) &&
        (!brF || u.branch === brF) &&
        (actF === '' || String(Number(u.active)) === actF));
    const cGlobal = isGlobal(c.role), eGlobal = isGlobal(e.role);

    const popups = <>
        <Modal id="createModal" open={createOpen} onClose={() => setCreateOpen(false)} panelClassName="max-w-2xl" form={{ id: 'createForm', autoComplete: 'off', onSubmit: create }}>
                <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                    <div>
                        <h3 className="text-lg font-extrabold">Add User</h3>
                        <p className="text-xs text-gray-400 mt-0.5">They receive a verification email, then sign in with their username or email.</p>
                    </div>
                    <CloseX />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar my-5 pr-1 space-y-5">
                    <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Personal</legend>
                        <div className="sm:col-span-2"><label className="ui-label" htmlFor="c_fullName">Full name <span className="req">*</span></label><input id="c_fullName" ref={cName} className="field" required placeholder="e.g. Muhammed Adhil" value={c.fullName} onChange={ev => setC({ ...c, fullName: ev.target.value })} /></div>
                        <div><label className="ui-label" htmlFor="c_dob">Date of birth</label><input id="c_dob" type="date" className="field" value={c.dob} onChange={ev => setC({ ...c, dob: ev.target.value })} /></div>
                        <div><label className="ui-label" htmlFor="c_omanId">Civil ID</label><input id="c_omanId" className="field" inputMode="numeric" pattern="\d*" placeholder="e.g. 12345678" value={c.omanId} onChange={ev => setC({ ...c, omanId: ev.target.value })} /></div>
                        <div><label className="ui-label" htmlFor="c_contact">Contact number <span className="req">*</span></label><PhoneField ref={cPh} country="OM" inputProps={{ id: 'c_contact', className: 'field', required: true, placeholder: 'Mobile number' }} /></div>
                        <div><label className="ui-label" htmlFor="c_email">Email <span className="req">*</span></label><input id="c_email" type="email" className="field" required placeholder="user@example.com" value={c.email} onChange={ev => setC({ ...c, email: ev.target.value })} /></div>
                    </fieldset>
                    <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <legend className="text-[10px] font-extrabold text-gray-400 uppercase mb-2">Access</legend>
                        <div><label className="ui-label" htmlFor="c_username">Username <span className="req">*</span></label><input id="c_username" className="field" required pattern="[A-Za-z0-9._\-]{3,30}" placeholder="e.g. madhil" value={c.username} onChange={ev => setC({ ...c, username: ev.target.value })} /></div>
                        <div><label className="ui-label" htmlFor="c_password">Temporary password <span className="req">*</span></label><input id="c_password" type="password" className="field" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={c.password} onChange={ev => setC({ ...c, password: ev.target.value })} /></div>
                        <div><label className="ui-label" htmlFor="c_role">Role <span className="req">*</span></label><select id="c_role" className="field" required value={c.role} onChange={ev => setRoleC(ev.target.value)}>
                            {createOpen && <><option value="">Choose role…</option>{roleOptions(true)}</>}</select></div>
                        <div><label className="ui-label" htmlFor="c_branch">Branch <span id="c_branchReq" className={`req${cGlobal ? ' hidden' : ''}`}>*</span></label><select id="c_branch" className="field" disabled={cGlobal} value={c.branch} onChange={ev => setC({ ...c, branch: ev.target.value })}>
                            {createOpen && <><option value="">Choose branch…</option>{branchOptions}</>}</select></div>
                    </fieldset>
                    <p id="roleHelp" className="text-[11px] text-gray-500 bg-[#F8F8FA] rounded-2xl px-4 py-3 border border-gray-100">{c.role ? ROLE_HELP[c.role] || '' : createOpen ? 'Pick a role to see what it can do.' : ''}</p>
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                    <CancelBtn />
                    <button id="createBtn" className="btn btn-coral" disabled={cBusy}>{cBusy ? 'Creating…' : 'Create user'}</button>
                </div>
        </Modal>

        <Modal id="editModal" open={editOpen} onClose={() => setEditOpen(false)} panelClassName="max-w-xl" form={{ id: 'editForm', onSubmit: saveEdit }}>
                <div className="flex justify-between items-start pb-4 border-b border-gray-100 gap-4">
                    <div>
                        <h3 id="e_title" className="text-lg font-extrabold">{editing ? `Edit ${editing.full_name || 'user'}` : 'Edit user'}</h3>
                        <p id="e_sub" className="text-xs text-gray-400 mt-0.5">{editing ? `@${editing.username || '—'} • ${editing.recovery_email || ''}` : ''}</p>
                    </div>
                    <CloseX />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-5">
                    <div className="sm:col-span-2"><label className="ui-label" htmlFor="e_name">Full name</label><input id="e_name" className="field" required value={e.name} onChange={ev => setE({ ...e, name: ev.target.value })} /></div>
                    <div className="sm:col-span-2"><label className="ui-label" htmlFor="e_contact">Contact number</label><PhoneField ref={ePh} country="OM" inputProps={{ id: 'e_contact', className: 'field', placeholder: 'Mobile number' }} /></div>
                    <div><label className="ui-label" htmlFor="e_role">Role</label><select id="e_role" className="field" disabled={!!editing?.is_me} value={e.role} onChange={ev => setE({ ...e, role: ev.target.value, branch: isGlobal(ev.target.value) ? '' : e.branch })}>{editing && roleOptions(false)}</select></div>
                    <div><label className="ui-label" htmlFor="e_branch">Branch</label><select id="e_branch" className="field" disabled={eGlobal} value={e.branch} onChange={ev => setE({ ...e, branch: ev.target.value })}>{editing && <><option value="">All branches</option>{branchOptions}</>}
                        {/* a branch that is no longer in the list shows blank (as before), not the first option */}
                        {e.branch && !branches.some(b => b.branch_code === e.branch) && <option value={e.branch} hidden></option>}</select></div>
                    <label className="sm:col-span-2 flex items-center gap-3 bg-[#F8F8FA] rounded-2xl px-4 py-3 border border-gray-100 cursor-pointer">
                        <input id="e_driver" type="checkbox" className="w-4 h-4" checked={e.driver} onChange={ev => setE({ ...e, driver: ev.target.checked })} /><span className="text-xs font-bold">Driver</span><span className="text-[11px] text-gray-400">— does pickups / deliveries</span>
                    </label>
                    <div className="sm:col-span-2 bg-[#F8F8FA] rounded-2xl px-4 py-3 border border-gray-100">
                        <p className="text-xs font-bold mb-2">Work hours <span className="text-[11px] text-gray-400 font-medium">— used for check-in reminders and late / early marking</span></p>
                        <div className="grid grid-cols-3 gap-2">
                            <div><label className="ui-label" htmlFor="e_shStart">Starts</label><input id="e_shStart" type="time" className="field" required value={e.shStart} onChange={ev => setE({ ...e, shStart: ev.target.value })} /></div>
                            <div><label className="ui-label" htmlFor="e_shEnd">Ends</label><input id="e_shEnd" type="time" className="field" required value={e.shEnd} onChange={ev => setE({ ...e, shEnd: ev.target.value })} /></div>
                            <div><label className="ui-label" htmlFor="e_grace">Grace (min)</label><input id="e_grace" type="number" min="0" max="120" className="field" required value={e.grace} onChange={ev => setE({ ...e, grace: ev.target.value })} /></div>
                            <div><label className="ui-label" htmlFor="e_brStart">Break from</label><input id="e_brStart" type="time" className="field" value={e.brStart} onChange={ev => setE({ ...e, brStart: ev.target.value })} /></div>
                            <div><label className="ui-label" htmlFor="e_brEnd">Break to</label><input id="e_brEnd" type="time" className="field" value={e.brEnd} onChange={ev => setE({ ...e, brEnd: ev.target.value })} /></div>
                            <div className="flex items-end pb-2"><span className="text-[10px] text-gray-400 leading-snug">Not counted as worked time. Leave empty for no break.</span></div>
                        </div>
                        <span className="ui-label block mt-2">Weekly off</span>
                        <div id="e_off" className="flex flex-wrap gap-1 mt-1">
                            {editing && DOW.map((d, i) => <button key={d} type="button" data-dow={i + 1} aria-pressed={e.off.includes(i + 1)} onClick={() => setE(v => ({ ...v, off: v.off.includes(i + 1) ? v.off.filter(x => x !== i + 1) : [...v.off, i + 1] }))}
                                className="px-3 py-1.5 rounded-full text-[11px] font-extrabold bg-white border border-gray-200 aria-pressed:bg-[#111827] aria-pressed:text-white aria-pressed:border-[#111827]">{d}</button>)}
                        </div>
                    </div>
                    <div className="sm:col-span-2 bg-[#F8F8FA] rounded-2xl px-4 py-3 border border-gray-100 space-y-2">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input id="e_wh" type="checkbox" className="w-4 h-4" checked={e.wh} onChange={ev => setE({ ...e, wh: ev.target.checked })} /><span className="text-xs font-bold">Warehouse operator</span><span className="text-[11px] text-gray-400">— branch requests, warehouse stock and purchases</span>
                        </label>
                        <div id="e_whBox" className={`${e.wh ? '' : 'hidden '}grid grid-cols-1 sm:grid-cols-2 gap-2 items-end`}>
                            <div><label className="ui-label" htmlFor="e_whCode">Warehouse</label><select id="e_whCode" className="field" value={e.whCode} onChange={ev => setE({ ...e, whCode: ev.target.value })}>
                                {whs.length ? whs.map(b => <option key={b.branch_code} value={b.branch_code}>{`${b.branch_name} (${b.branch_code})`}</option>) : <option value="">No warehouse yet — set a branch type to Warehouse in Branch Network</option>}</select></div>
                            <div className="flex items-center gap-2 text-[11px] text-gray-500"><span id="e_whPin">{editing?.is_warehouse ? (editing.has_wh_pin ? 'PIN is set.' : 'PIN not set yet.') : ''}</span>
                                <button type="button" id="e_whReset" className={`btn btn-light btn-sm${editing?.is_warehouse && editing.has_wh_pin ? '' : ' hidden'}`} onClick={resetPin}>Reset PIN</button></div>
                            <p className="sm:col-span-2 text-[11px] text-gray-400">They set their own warehouse PIN the first time they open the Warehouse page, and must enter it every time.</p>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                    <CancelBtn />
                    <button className="btn btn-dark">Save changes</button>
                </div>
        </Modal>
    </>;

    return (
        <AppFrame after={popups}>
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <section className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-gray-100 gap-4">
                    <div className="flex items-center gap-3.5 bg-[#F8F8FA] p-1.5 pr-5 rounded-full border border-gray-200/70 shadow-sm self-start">
                        <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                        </div>
                        <div>
                            <div className="flex items-center gap-2"><span className="text-xs font-extrabold tracking-tight">Staff &amp; Users</span><span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span></div>
                            <p className="text-[10px] font-medium text-gray-400 leading-tight mt-0.5">Accounts • Roles • Branch access</p>
                        </div>
                    </div>
                    <button type="button" className="btn btn-coral w-full sm:w-auto" onClick={openCreate}><Icon name="plus" />Add User</button>
                </section>

                <section id="stats" className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
                    {users && <>{tile('Active users', active.length, true)}{tile('Admins', count(u => isGlobal(u.role)))}{tile('Branch managers', count(u => u.role === 'branch_manager'))}{tile('Staff', count(u => u.role === 'staff'))}{tile('Drivers', count(u => !!u.is_driver))}</>}
                </section>

                <section className="bg-[#F8F8FA] rounded-[2rem] p-4 lg:p-6">
                    <div className="flex flex-col xl:flex-row gap-3 xl:items-center justify-between mb-4">
                        <div className="flex items-center gap-2"><span className="font-extrabold text-xs uppercase tracking-wider">Team</span><span id="listCount" className="pill-tag pill-gray">{users ? list.length : '…'}</span></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:flex gap-2">
                            <input id="search" type="search" placeholder="Search name, username, email…" className="field pill xl:!w-60 !py-2.5" value={q} onChange={ev => setQ(ev.target.value)} />
                            <select id="roleFilter" className="field pill xl:!w-44 !py-2.5" aria-label="Filter by role" value={roleF} onChange={ev => setRoleF(ev.target.value)}>
                                <option value="">All roles</option><option value="super_admin">Super Admin</option><option value="head_office">Head Office</option>
                                <option value="branch_manager">Branch Manager</option><option value="staff">Staff</option><option value="driver">Drivers</option>
                            </select>
                            <select id="branchFilter" className="field pill xl:!w-44 !py-2.5" aria-label="Filter by branch" value={brF} onChange={ev => setBrF(ev.target.value)}>
                                <option value="">All branches</option>{branches.map(b => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}
                            </select>
                            <select id="activeFilter" className="field pill xl:!w-36 !py-2.5" aria-label="Filter by status" value={actF} onChange={ev => setActF(ev.target.value)}>
                                <option value="">All</option><option value="1">Active</option><option value="0">Inactive</option>
                            </select>
                        </div>
                    </div>
                    <div className="bg-white rounded-[1.5rem] border border-gray-100 overflow-x-auto custom-scrollbar max-lg:bg-transparent max-lg:border-0">
                        <table className="rtable w-full text-xs min-w-[760px]">
                            <thead><tr className="text-[10px] text-gray-400 uppercase text-left border-b border-gray-100">
                                <th className="p-3 pl-4 font-extrabold">Name</th><th className="p-3 font-extrabold">Role</th><th className="p-3 font-extrabold">Branch</th>
                                <th className="p-3 font-extrabold">Contact</th><th className="p-3 font-extrabold">Last sign-in</th><th className="p-3 font-extrabold">Status</th><th className="p-3 w-12"></th>
                            </tr></thead>
                            <tbody id="rows" className="divide-y divide-gray-100">
                                {!users ? <tr><td colSpan={7} className="cell-empty p-8 text-center text-gray-400">Loading…</td></tr>
                                    : list.length ? list.map(u => (
                                        <tr key={u.id} className={`hover:bg-[#F8F8FA] ${u.active ? '' : 'opacity-60'}`}>
                                            <td className="cell-main p-3 pl-4">
                                                <div className="flex items-center gap-3">
                                                    <span className={`w-9 h-9 rounded-full ${u.active ? 'bg-coral-50 text-coral-600' : 'bg-gray-100 text-gray-400'} flex items-center justify-center font-extrabold text-[11px] flex-shrink-0`}>{initials(u.full_name)}</span>
                                                    <div className="min-w-0"><p className="font-extrabold truncate">{(u.full_name || '—') + (u.is_me ? ' ' : '')}{u.is_me && <span className="pill-tag pill-gray">You</span>}</p>
                                                        <p className="text-[10px] text-gray-400 truncate">{`@${u.username || '—'} • ${u.recovery_email || ''}`}</p></div>
                                                </div>
                                            </td>
                                            <td className="p-3" data-label="Role"><span className={`pill-tag ${ROLE_PILL[u.role] || 'pill-gray'}`}>{ROLES[u.role] || u.role || 'No role'}</span>{u.is_driver && <>{' '}<span className="pill-tag pill-gray">Driver</span></>}{u.is_warehouse && <>{' '}<span className="pill-tag pill-dark">Warehouse</span></>}</td>
                                            <td className="p-3 font-bold" data-label="Branch">{isGlobal(u.role) && !u.branch ? 'All branches' : branchName(u.branch)}<span className="block text-[10px] text-gray-400 font-medium">{`${hh(u.shift_start, '09:00')}–${hh(u.shift_end, '18:00')}${u.break_start ? ` · break ${hh(u.break_start)}–${hh(u.break_end)}` : ''}`}</span></td>
                                            <td className="p-3 text-gray-500" data-label="Contact">{u.contact_number || '—'}</td>
                                            <td className="p-3 text-gray-500" data-label="Last sign-in">{ago(u.last_sign_in_at) + (u.email_confirmed ? '' : ' ')}{!u.email_confirmed && <span className="pill-tag pill-amber">Email not verified</span>}</td>
                                            <td className="p-3" data-label="Status"><span className={`pill-tag ${u.active ? 'pill-green' : 'pill-gray'}`}>{u.active ? 'Active' : 'Inactive'}</span></td>
                                            <td className="cell-menu p-3 relative" data-menu-root="">
                                                <button type="button" onClick={ev => userMenu(ev.currentTarget, u)} aria-label={`Actions for ${u.full_name}`} className="icon-btn"><Icon name="more" cls="w-5 h-5" /></button>
                                            </td>
                                        </tr>
                                    )) : <tr><td colSpan={7} className="cell-empty p-8 text-center text-gray-400">No users match.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </AppFrame>
    );
}
