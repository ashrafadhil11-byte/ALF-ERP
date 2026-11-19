import { useEffect, type ReactNode } from 'react';
import { session } from '../lib/session';

// Without a token, go to the sign-in page (same as the old pages).
export function RequireAuth({ children }: { children: ReactNode }) {
    const token = session.token();
    useEffect(() => { if (!token) location.replace('/app/login'); }, [token]);
    return token ? <>{children}</> : null;
}
