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

export const isSuperAdmin = (session) => session?.role === 'super_admin';

/**
 * The warehouse this request may act for: a valid unlock token for the user's own warehouse, or — for a super admin,
 * who may work in any warehouse with their own PIN — for the warehouse they unlocked (checked when the token was made).
 */
export function warehouseOf(session, req) {
    const e = session?.employee;
    const t = readToken(req.headers?.['x-warehouse-token'], session?.user?.id);
    if (!t || t.warehouse.startsWith('MO:')) return null;
    if (isSuperAdmin(session)) return t.warehouse;
    if (!e?.is_warehouse || !e.warehouse_code) return null;
    return t.warehouse === e.warehouse_code ? e.warehouse_code : null;
}

/** Main Office money: cashiers (Staff & Users → Main Office cashier) and super admins, after unlocking with their PIN. */
export const canMainOffice = (session) => Boolean(session?.employee?.is_cashier) || isSuperAdmin(session);
export function mainOfficeOf(session, req) {
    if (!canMainOffice(session)) return null;
    const t = readToken(req.headers?.['x-office-token'], session.user.id);
    return t && t.warehouse.startsWith('MO:') ? t.warehouse.slice(3) : null;
}

/**
 * Set / unlock the personal PIN (one PIN for warehouse and Main Office). Returns a token for `area`
 * ('<warehouse code>' or 'MO:<main office code>'), or throws { message, status }.
 */
export async function pinAction(b, employee, patchEmp, area) {
    const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    if (b.action === 'set_pin') {
        if (!validPin(b.pin)) fail('PIN must be 4 to 6 digits.');
        if (/^(\d)\1+$/.test(b.pin) || '0123456789'.includes(b.pin) || '9876543210'.includes(b.pin)) fail('Choose a less obvious PIN (not 1111 or 1234).');
        if (employee.wh_pin_hash && !checkPin(b.current_pin, employee.wh_pin_hash)) fail('Current PIN is wrong.');
        await patchEmp(employee.id, { wh_pin_hash: hashPin(b.pin), wh_pin_failed: 0, wh_pin_locked_until: null });
        return signToken(employee.id, area);
    }
    if (!employee.wh_pin_hash) fail('Set your PIN first.');   // (the warehouse page says "warehouse PIN")
    if (employee.wh_pin_locked_until && new Date(employee.wh_pin_locked_until) > new Date()) {
        fail(`Too many wrong PINs — try again after ${new Date(employee.wh_pin_locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Muscat' })}.`, 423);
    }
    if (!checkPin(b.pin, employee.wh_pin_hash)) {
        const tries = (employee.wh_pin_failed || 0) + 1, lock = tries >= MAX_TRIES;
        await patchEmp(employee.id, { wh_pin_failed: lock ? 0 : tries, wh_pin_locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60e3).toISOString() : null });
        fail(lock ? `Wrong PIN. Locked for ${LOCK_MINUTES} minutes.` : `Wrong PIN. ${MAX_TRIES - tries} tries left.`, 401);
    }
    await patchEmp(employee.id, { wh_pin_failed: 0, wh_pin_locked_until: null });
    return signToken(employee.id, area);
}
