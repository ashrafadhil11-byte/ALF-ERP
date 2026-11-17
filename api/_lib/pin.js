// File: api/_lib/pin.js — warehouse PIN hashing + short-lived unlock token (no extra packages).
import crypto from 'node:crypto';

export const TOKEN_MINUTES = 30;
export const MAX_TRIES = 5;
export const LOCK_MINUTES = 15;

const secret = () => process.env.WAREHOUSE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-only-secret';

export function validPin(pin) { return /^\d{4,6}$/.test(String(pin || '')); }

export function hashPin(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

export function checkPin(pin, stored) {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const got = crypto.scryptSync(String(pin), salt, 32);
    const want = Buffer.from(hash, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Token = base64url(userId|warehouse|expiresMs).hmac — bound to this user and this warehouse. */
export function signToken(userId, warehouse, minutes = TOKEN_MINUTES) {
    const exp = Date.now() + minutes * 60e3;
    const body = Buffer.from(`${userId}|${warehouse}|${exp}`).toString('base64url');
    const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
    return { token: `${body}.${mac}`, expires_at: new Date(exp).toISOString() };
}

export function readToken(token, userId) {
    const [body, mac] = String(token || '').split('.');
    if (!body || !mac) return null;
    const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
    if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    const [uid, warehouse, exp] = Buffer.from(body, 'base64url').toString('utf8').split('|');
    if (uid !== userId || !(+exp > Date.now())) return null;
    return { warehouse, expires_at: new Date(+exp).toISOString() };
}

/** The warehouse this request may act for: the user is a warehouse operator and sent a valid unlock token. */
export function warehouseOf(session, req) {
    const e = session?.employee;
    if (!e?.is_warehouse || !e.warehouse_code) return null;
    const t = readToken(req.headers?.['x-warehouse-token'], session.user.id);
    return t && t.warehouse === e.warehouse_code ? e.warehouse_code : null;
}
