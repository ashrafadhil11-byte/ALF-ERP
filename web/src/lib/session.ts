// Who is signed in. Same localStorage keys as the old pages, so both versions share one sign-in.
export type Role = 'super_admin' | 'head_office' | 'branch_manager' | 'staff' | string;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export const session = {
    token: () => read('cargo_auth_token'),
    role: (): Role => read('cargo_user_role') || 'staff',
    name: () => read('cargo_user_name') || '',
    isWarehouse: () => read('cargo_is_warehouse') === '1',
    isAdmin: () => ['super_admin', 'head_office'].includes(session.role()),
    signOut() {
        for (const k of ['cargo_auth_token', 'cargo_user_role', 'cargo_is_warehouse']) localStorage.removeItem(k);
        location.replace('/login.html');
    }
};
