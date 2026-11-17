import { useEffect, type ReactNode } from 'react';
import { session } from '../lib/session';

// The login page stays the old one until Phase 5; without a token, go there (same as the old pages).
export function RequireAuth({ children }: { children: ReactNode }) {
    const token = session.token();
    useEffect(() => { if (!token) location.replace('/login.html'); }, [token]);
    return token ? <>{children}</> : null;
}
