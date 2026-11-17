// Phase 0 only: proves the React app runs with the same styles, sign-in and API as the old pages.
// Phase 1 replaces this with the real frame (sidebar, top bar, check-in).
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { session } from '../lib/session';

type Me = { profile?: { full_name?: string }; full_name?: string };

export function Placeholder() {
    const me = useQuery({ queryKey: ['profile'], queryFn: () => api<Me>('/api/profile') });
    const name = me.data?.profile?.full_name || me.data?.full_name || session.name() || '…';
    return (
        <div className="min-h-screen p-3 lg:p-5 flex">
            <main className="flex-1 min-w-0 bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-5 lg:p-8 border border-white">
                <p className="sd-label">React frame · Phase 0</p>
                <h1 className="text-xl font-extrabold tracking-tight mt-2">Al-Farha Cargo ERP</h1>
                <p className="text-sm text-gray-500 mt-2">
                    Signed in as <b className="text-gray-900">{name}</b> ({session.role()}).{' '}
                    {me.isSuccess && <span className="text-emerald-600">API connected.</span>}
                    {me.isError && <span className="text-coral-600">Could not reach the API: {(me.error as Error).message}</span>}
                </p>
                <div className="flex gap-2 mt-6">
                    <a href="/admin/super-dashboard.html" className="btn btn-coral">Open the current app</a>
                    <button type="button" className="btn" onClick={() => session.signOut()}>Sign out</button>
                </div>
            </main>
        </div>
    );
}
