import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from './api';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('api (same behaviour as UI.api)', () => {
    beforeEach(() => { localStorage.setItem('cargo_auth_token', 'tok'); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sends the bearer token and shares identical GETs in flight', async () => {
        const fetchMock = vi.fn(async () => json({ ok: 1 }));
        vi.stubGlobal('fetch', fetchMock);
        const [a, b] = await Promise.all([api('/api/x'), api('/api/x')]);
        expect(a).toEqual({ ok: 1 });
        expect(b).toBe(a);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer tok');
    });

    it('never shares writes, and throws the server error message with its status', async () => {
        const fetchMock = vi.fn(async () => json({ error: 'Nope' }, 400));
        vi.stubGlobal('fetch', fetchMock);
        const err = await api('/api/y', { method: 'POST', body: {} }).catch(e => e);
        expect(err).toBeInstanceOf(ApiError);
        expect([err.message, err.status]).toEqual(['Nope', 400]);
        await expect(api('/api/y', { method: 'POST', body: {} })).rejects.toThrow('Nope');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('signs out on 401', async () => {
        const replace = vi.fn();
        vi.stubGlobal('location', { replace });
        vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
        await expect(api('/api/z')).rejects.toThrow();
        expect(localStorage.getItem('cargo_auth_token')).toBeNull();
        expect(replace).toHaveBeenCalledWith('/login.html');
    });
});
