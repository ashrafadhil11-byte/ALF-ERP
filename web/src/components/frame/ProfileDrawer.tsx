// Employee identity card drawer — same as admin/components/profile-modal.js (details + change password).
import { useEffect, useRef, useState } from 'react';
import { allowClose, markClean } from '../../lib/guard';
import { jwtPayload, session } from '../../lib/session';

type Profile = { full_name?: string; username?: string; role?: string; branch?: string; recovery_email?: string; contact_number?: string; oman_civil_id?: string; date_of_birth?: string };

export const formatRoleTitle = (role?: string) => !role ? 'Employee' : role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const formatBranchTitle = (branch?: string, role?: string) =>
    role === 'super_admin' || !branch || branch.toLowerCase() === 'global' ? 'Global (All Branches)' : branch.charAt(0).toUpperCase() + branch.slice(1) + ' Branch';

const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]';
const eye = <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>;

function fromToken(): Profile | null {
    const p = jwtPayload();
    if (!p) return null;
    const meta = p.user_metadata || {};
    return {
        full_name: meta.full_name || localStorage.getItem('cargo_user_name') || 'Muhammed Adhil',
        username: meta.username || 'admin', role: meta.role || 'super_admin', branch: meta.branch || 'Global',
        recovery_email: meta.recovery_email || p.email || 'Not Set', contact_number: meta.contact_number || 'Not Set',
        oman_civil_id: meta.oman_civil_id || 'Not Set', date_of_birth: meta.date_of_birth || 'Not Set'
    };
}

export function ProfileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const panel = useRef<HTMLElement>(null);
    const form = useRef<HTMLFormElement>(null);
    const [shown, setShown] = useState(false);       // slid in
    const [mounted, setMounted] = useState(false);   // backdrop present
    const [p, setP] = useState<Profile | null>(null);
    const [tab, setTab] = useState<'details' | 'security'>('details');
    const [vis, setVis] = useState({ newPasswordInput: false, confirmPasswordInput: false });
    const [alert, setAlert] = useState<{ ok: boolean; text: string } | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            requestAnimationFrame(() => setShown(true));
            const t = fromToken(); if (t) setP(t);
            const token = session.token();
            if (token) fetch('/api/profile', { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.ok ? r.json() : null).then(j => { if (j?.profile) setP(j.profile); }).catch(() => {});
        } else {
            setShown(false);
            const t = setTimeout(() => setMounted(false), 300);
            return () => clearTimeout(t);
        }
    }, [open]);

    const close = async () => { if (await allowClose(panel.current)) onClose(); };   // asks when a password was typed

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        const f = form.current!;
        const newPassword = (f.elements.namedItem('newPasswordInput') as HTMLInputElement).value;
        const confirmPassword = (f.elements.namedItem('confirmPasswordInput') as HTMLInputElement).value;
        if (newPassword !== confirmPassword) { setAlert({ ok: false, text: 'Passwords do not match. Please check and try again.' }); return; }
        setSaving(true); setAlert(null);
        try {
            const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token()}` }, body: JSON.stringify({ newPassword }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update password');
            setAlert({ ok: true, text: 'Password updated. Your new credentials are now active.' });
            f.reset();
            markClean(panel.current);
        } catch (err) {
            setAlert({ ok: false, text: (err as Error).message });
        } finally { setSaving(false); }
    }

    const sec = tab === 'security';
    const name = p?.full_name ?? 'Muhammed Adhil';
    const branchTitle = p ? formatBranchTitle(p.branch, p.role) : null;
    const pwInput = (id: 'newPasswordInput' | 'confirmPasswordInput', label: string, placeholder: string) => (
        <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-gray-700 ml-1">{label}</label>
            <div className="relative">
                <input type={vis[id] ? 'text' : 'password'} id={id} name={id} required minLength={6} placeholder={placeholder}
                    className="w-full px-4 py-3 bg-[#F8F8FA] border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-coral-500 transition-all" />
                <button type="button" onClick={() => setVis(v => ({ ...v, [id]: !v[id] }))} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-700">{eye}</button>
            </div>
        </div>
    );
    const tabBtn = (on: boolean) => `relative z-10 py-2.5 rounded-xl text-xs ${on ? 'font-extrabold' : 'font-bold'} transition-colors duration-300 ${on ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'}`;

    return (
        <div id="profile-component-host">
            <div id="profileDrawerBackdrop" onClick={close}
                className={`fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-sm ${mounted ? '' : 'hidden '}${shown ? '' : 'opacity-0 '}transition-opacity duration-300`}></div>

            <aside id="profileDrawerPanel" ref={panel} data-guard=""
                className={`fixed top-3 bottom-3 right-3 z-50 w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 flex flex-col justify-between overflow-hidden transform ${shown ? '' : 'translate-x-[110%] '}transition-transform duration-500 ${EASE}`}>
                <div>
                    <div className="relative bg-gradient-to-br from-[#111827] via-[#1F2937] to-[#111827] p-6 pb-14 text-white overflow-hidden">
                        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-coral-500/20 blur-xl pointer-events-none"></div>
                        <div className="flex justify-between items-center relative z-10">
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-coral-500"></span>
                                Employee Identity Card
                            </span>
                            <button onClick={close} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                    </div>

                    <div className="px-6 -mt-10 relative z-20">
                        <div className="bg-white rounded-3xl p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08)] border border-gray-100 flex items-center gap-4">
                            <img id="profModalAvatar" src={`https://ui-avatars.com/api/?name=${p ? encodeURIComponent(p.full_name || 'User') : 'Muhammed+Adhil'}&background=E86D58&color=fff&bold=true`}
                                alt="Avatar" className="w-16 h-16 rounded-2xl object-cover shadow-md border-2 border-white" />
                            <div className="min-w-0 flex-1">
                                <h3 id="profModalFullName" className="text-lg font-extrabold text-gray-900 truncate">{name}</h3>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    <span id="profModalRoleBadge" className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-coral-50 text-coral-600 border border-coral-100">{p ? formatRoleTitle(p.role) : 'Super Admin'}</span>
                                    <span id="profModalBranchBadge" className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#F8F8FA] text-gray-700 border border-gray-200/60">{branchTitle ?? 'Global HQ'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-6 mt-5">
                        <div className="relative grid grid-cols-2 bg-[#F8F8FA] p-1 rounded-2xl border border-gray-100 overflow-hidden">
                            <div id="profTabSlider" style={{ transform: sec ? 'translateX(100%)' : 'translateX(0%)' }}
                                className={`absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] bg-white rounded-xl shadow-sm transition-transform duration-500 ${EASE} pointer-events-none`}></div>
                            <button type="button" id="profTabDetailsBtn" onClick={() => setTab('details')} className={tabBtn(!sec)}>User &amp; Branch Info</button>
                            <button type="button" id="profTabSecurityBtn" onClick={() => setTab('security')} className={tabBtn(sec)}>Change Password</button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar my-4">
                    <div id="profTabsTrack" style={{ transform: sec ? 'translateX(-50%)' : 'translateX(0%)' }} className={`flex w-[200%] transition-transform duration-500 ${EASE}`}>
                        <div id="profTabDetailsPane" className={`w-1/2 px-6 space-y-3 transition-opacity duration-300 ${sec ? 'opacity-40' : 'opacity-100'}`}>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">System Username</p>
                                    <p id="profModalUsername" className="text-xs font-extrabold text-gray-900 mt-1">{p ? `@${p.username || 'admin'}` : '@adhil'}</p>
                                </div>
                                <div className="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Assigned Branch</p>
                                    <p id="profModalBranch" className="text-xs font-extrabold text-gray-900 mt-1">{branchTitle ?? 'Global (All Branches)'}</p>
                                </div>
                            </div>
                            <div className="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100 flex items-center justify-between">
                                <div className="min-w-0 pr-2">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Recovery &amp; Verification Email</p>
                                    <p id="profModalEmail" className="text-xs font-extrabold text-gray-900 mt-1 truncate">{p ? p.recovery_email || 'Not Set' : 'Loading...'}</p>
                                </div>
                                <span className="w-8 h-8 rounded-full bg-white border border-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Contact Number</p>
                                    <p id="profModalPhone" className="text-xs font-extrabold text-gray-900 mt-1">{p ? p.contact_number || 'Not Set' : 'Loading...'}</p>
                                </div>
                                <div className="bg-[#F8F8FA] p-3.5 rounded-2xl border border-gray-100">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Oman Civil ID</p>
                                    <p id="profModalOmanId" className="text-xs font-extrabold text-gray-900 mt-1">{p ? p.oman_civil_id || 'Not Set' : 'Loading...'}</p>
                                </div>
                            </div>
                            <div className="bg-[#FFF5F3] p-3.5 rounded-2xl border border-coral-100 flex items-center justify-between">
                                <div>
                                    <p className="text-[10px] font-bold text-coral-600 uppercase">Date of Birth</p>
                                    <p id="profModalDob" className="text-xs font-extrabold text-gray-900 mt-1">{p ? p.date_of_birth || 'Not Set' : 'Loading...'}</p>
                                </div>
                                <span className="text-[10px] font-bold bg-white text-coral-600 px-3 py-1 rounded-full border border-coral-100 shadow-sm">
                                    <svg className="w-3.5 h-3.5 inline -mt-0.5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01" /></svg>Birthday Sync Active
                                </span>
                            </div>
                        </div>

                        <div id="profTabSecurityPane" className={`w-1/2 px-6 transition-opacity duration-300 ${sec ? 'opacity-100' : 'opacity-40'}`}>
                            <form id="changePasswordForm" ref={form} onSubmit={submit} className="space-y-4">
                                <div className="bg-[#F8F8FA] p-4 rounded-2xl border border-gray-100">
                                    <h4 className="text-xs font-extrabold text-gray-900">Update Account Password</h4>
                                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">Enter a new password below. Your session will remain active across this device.</p>
                                </div>
                                <div id="passwordAlertBox" className={alert ? `p-3.5 rounded-2xl text-xs font-bold border ${alert.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'} block` : 'hidden p-3.5 rounded-2xl text-xs font-bold border'}>{alert?.text}</div>
                                {pwInput('newPasswordInput', 'New Password', 'Minimum 6 characters')}
                                {pwInput('confirmPasswordInput', 'Confirm New Password', 'Re-enter new password')}
                                <button type="submit" id="savePasswordBtn" disabled={saving}
                                    className="w-full bg-coral-500 hover:bg-coral-600 text-white font-extrabold text-xs py-3.5 rounded-2xl shadow-[0_8px_20px_-6px_rgba(232,109,88,0.5)] transition-all flex items-center justify-center gap-2">
                                    <span id="savePasswordBtnText">{saving ? 'Updating Security Credentials...' : 'Update Password'}</span>
                                </button>
                            </form>
                        </div>
                    </div>
                </div>

                <div className="p-5 border-t border-gray-100 bg-[#F8F8FA] flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Session Status</p>
                        <p className="text-[11px] font-extrabold text-emerald-600 flex items-center gap-1.5 mt-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Authenticated</p>
                    </div>
                    <button onClick={() => session.signOut()} className="px-4 py-2.5 rounded-full bg-red-50 hover:bg-red-100 text-red-600 text-xs font-extrabold flex items-center gap-1.5 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                        Sign Out
                    </button>
                </div>
            </aside>
        </div>
    );
}
