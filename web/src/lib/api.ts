// Same behaviour as UI.api in admin/components/ui.js:
// bearer token, JSON in/out, identical GETs in flight share one request, 401 signs out.
import { session } from './session';

export class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

type Opts = { method?: string; body?: unknown; headers?: Record<string, string> };

const inflight = new Map<string, Promise<any>>();

export function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
    const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET') return request<T>(path, opts);
    const key = path + '|' + JSON.stringify(opts.headers || {});
    const hit = inflight.get(key);
    if (hit) return hit;
    const p = request<T>(path, opts).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

async function request<T>(path: string, { method = 'GET', body, headers = {} }: Opts): Promise<T> {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token()}`, ...headers },
        body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
        localStorage.removeItem('cargo_auth_token');
        location.replace('/app/login');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
    return data as T;
}
