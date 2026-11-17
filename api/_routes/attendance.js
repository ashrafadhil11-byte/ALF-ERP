// File: api/_routes/attendance.js — check in / out with GPS at the branch, shifts, leave.
//   GET  ?view=me[&month=YYYY-MM]                  my today + my month + my leave
//   GET  ?view=day[&date&branch]                   managers: who is in today
//   GET  ?view=report&from&to[&branch][&format=csv]
//   GET  ?view=leave[&status=pending]              managers: leave requests
//   GET  ?view=shifts[&branch]                     managers: staff shifts
//   POST { action:'punch', kind:'in'|'out', lat, lng, accuracy }
//   POST { action:'leave_request', leave_type, from_date, to_date, reason }
//   POST { action:'leave_cancel', id }
//   POST { action:'leave_decide', id, decision:'approved'|'rejected', note }     managers
//   POST { action:'manual', employee_id, date, check_in:'HH:MM'|null, check_out, reason }   managers
//   POST { action:'shift', employee_id, shift_start, shift_end, grace_min, weekly_off:[1..7] } managers
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

const enc = encodeURIComponent;
const MANAGERS = ['super_admin', 'head_office', 'branch_manager'];
const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'emergency', 'other'];
const MAX_ACCURACY_M = 150;        // GPS fixes worse than this are not trusted for the fence
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));

/** Metres between two GPS points. */
export function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = (d) => d * Math.PI / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Is a GPS fix inside the branch fence? Allows for the phone's stated accuracy (capped). */
export function insideFence(branch, lat, lng, accuracy) {
    if (branch?.lat == null || branch?.lng == null) return { ok: true, distance: null, unset: true };
    const d = distanceM(+branch.lat, +branch.lng, +lat, +lng);
    const slack = Math.min(Math.max(+accuracy || 0, 0), MAX_ACCURACY_M);
    return { ok: d <= (+branch.geofence_m || 200) + slack, distance: d };
}

/** Local date (YYYY-MM-DD) in a time zone. */
export function localDay(tz = 'Asia/Muscat', at = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** "YYYY-MM-DD" + "HH:MM" in a time zone → ISO instant. */
export function zonedIso(day, hm, tz = 'Asia/Muscat') {
    const guess = new Date(`${day}T${hm}:00Z`);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(guess).map(p => [p.type, p.value]));
    const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return new Date(guess.getTime() - (asLocal - guess.getTime())).toISOString();
}

/** Minutes since midnight + ISO weekday (1 Mon … 7 Sun) in a time zone. */
export function localClock(tz = 'Asia/Muscat', at = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
    return { minutes: (+p.hour) * 60 + (+p.minute), dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 };
}
const toMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };

/**
 * Should the user be reminded now?
 *   'in'  — from 15 min before the shift starts until the shift ends, not checked in yet
 *   'out' — shift is over (and 10 min more), checked in but not out (until midnight)
 * Never on a weekly off day or approved leave. Night shifts (end before start) only get the check-in reminder.
 */
export function remindFor({ record, shift, onLeave, tz, at = new Date() }) {
    if (onLeave) return null;
    const { minutes, dow } = localClock(tz, at);
    if ((shift.weekly_off || []).includes(dow)) return null;
    const s = toMin(shift.start), e = toMin(shift.end), night = e <= s;
    if (!record?.check_in) {
        const inWindow = night ? minutes >= s - 15 : (minutes >= s - 15 && minutes < e);
        return inWindow ? 'in' : null;
    }
    if (!record.check_out && !night && minutes >= e + 10) return 'out';
    return null;
}

export function leaveDays(from, to) {
    return Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 864e5) + 1;
}

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const me = session.employee || {};
    const myId = session.user.id;
    const userName = me.full_name || session.user.email;
    const isManager = MANAGERS.includes(session.role);
    const isAdmin = ADMIN_ROLES.includes(session.role);
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    // Managers see their own branch; super admin / head office see all (or the one asked for).
    const scopeBranch = (asked) => isAdmin ? (asked || null) : session.branch;
    const needManager = () => { if (!isManager) throw new UserError('Only managers can do this.', 403); };
    const employeeInScope = async (id) => {
        const e = (await get(`employees?id=eq.${enc(id)}&select=id,full_name,branch,shift_start,shift_end`))[0];
        if (!e) throw new UserError('Employee not found.', 404);
        if (!isAdmin && e.branch !== session.branch) throw new UserError('That employee is not in your branch.', 403);
        return e;
    };
    const branchOf = async (code) => (await get(`branches?branch_code=eq.${enc(code)}&select=branch_code,branch_name,lat,lng,geofence_m,timezone`))[0] || null;

    try {
        const q = req.query || {};
        const b = req.body || {};

        if (req.method === 'GET') {
            if (q.view === 'status') {
                // Small, fast: today's record + whether to remind (used by the dashboard card and the popup on every page)
                const br = me.branch ? await branchOf(me.branch) : null;
                const tz = br?.timezone || 'Asia/Muscat';
                const today = localDay(tz);
                const [record, leave] = await Promise.all([
                    get(`attendance?employee_id=eq.${enc(myId)}&work_date=eq.${today}&select=check_in,check_out,late_min,worked_min`).then(r => r[0] || null),
                    get(`leave_requests?employee_id=eq.${enc(myId)}&status=eq.approved&from_date=lte.${today}&to_date=gte.${today}&select=leave_type&limit=1`).then(r => r[0] || null)
                ]);
                const shift = { start: String(me.shift_start || '09:00').slice(0, 5), end: String(me.shift_end || '18:00').slice(0, 5), grace_min: me.grace_min ?? 10, weekly_off: me.weekly_off || [5] };
                return res.status(200).json({ today, timezone: tz, record, shift, on_leave: leave?.leave_type || null,
                    branch: br ? { code: br.branch_code, name: br.branch_name, has_location: br.lat != null && br.lng != null, geofence_m: br.geofence_m } : null,
                    remind: remindFor({ record, shift, onLeave: Boolean(leave), tz }) });
            }
            if (!q.view || q.view === 'me') {
                const br = me.branch ? await branchOf(me.branch) : null;
                const tz = br?.timezone || 'Asia/Muscat';
                const today = localDay(tz);
                const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? q.month : today.slice(0, 7);
                const first = `${month}-01`;
                const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
                const [days, leave] = await Promise.all([
                    rpc('attendance_report', { p_branch: me.branch || null, p_from: first, p_to: last }).then(rows => rows.filter(r => r.employee_id === myId)),
                    get(`leave_requests?employee_id=eq.${enc(myId)}&select=*&order=from_date.desc&limit=30`)
                ]);
                return res.status(200).json({
                    today, month, timezone: tz,
                    branch: br ? { code: br.branch_code, name: br.branch_name, has_location: br.lat != null && br.lng != null, geofence_m: br.geofence_m } : null,
                    shift: { start: String(me.shift_start || '09:00').slice(0, 5), end: String(me.shift_end || '18:00').slice(0, 5), grace_min: me.grace_min ?? 10, weekly_off: me.weekly_off || [5] },
                    record: (await get(`attendance?employee_id=eq.${enc(myId)}&work_date=eq.${today}&select=*`))[0] || null,
                    days, leave
                });
            }
            needManager();
            if (q.view === 'day') {
                const day = isDay(q.date) ? q.date : localDay();
                const rows = await rpc('attendance_report', { p_branch: scopeBranch(q.branch), p_from: day, p_to: day });
                return res.status(200).json({ date: day, rows });
            }
            if (q.view === 'report') {
                const to = isDay(q.to) ? q.to : localDay();
                const from = isDay(q.from) ? q.from : `${to.slice(0, 7)}-01`;
                if (leaveDays(from, to) > 92) throw new UserError('Pick up to 3 months at a time.');
                if (leaveDays(from, to) < 1) throw new UserError('From must be before To.');
                const rows = await rpc('attendance_report', { p_branch: scopeBranch(q.branch), p_from: from, p_to: to });
                const sum = new Map();
                for (const r of rows) {
                    const s = sum.get(r.employee_id) || { employee_id: r.employee_id, full_name: r.full_name, branch: r.branch, present: 0, late: 0, absent: 0, leave: 0, off: 0, late_min: 0, early_min: 0, overtime_min: 0, worked_min: 0 };
                    if (s[r.status] !== undefined) s[r.status]++;
                    s.late_min += r.late_min; s.early_min += r.early_min; s.overtime_min += r.overtime_min; s.worked_min += r.worked_min;
                    sum.set(r.employee_id, s);
                }
                if (q.format === 'csv') {
                    const tz = 'Asia/Muscat';
                    const t = (v) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '';
                    const esc = (v) => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
                    const lines = [['Employee', 'Branch', 'Date', 'Status', 'In', 'Out', 'Late min', 'Early min', 'Overtime min', 'Worked hrs', 'Leave', 'Corrected'].join(',')]
                        .concat(rows.map(r => [r.full_name, r.branch, r.work_date, r.status, t(r.check_in), t(r.check_out), r.late_min, r.early_min, r.overtime_min, (r.worked_min / 60).toFixed(2), r.leave_type || '', r.edited ? 'yes' : ''].map(esc).join(',')));
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                    res.setHeader('Content-Disposition', `attachment; filename="attendance_${from}_${to}.csv"`);
                    return res.status(200).send(lines.join('\n'));
                }
                return res.status(200).json({ from, to, rows, summary: [...sum.values()] });
            }
            if (q.view === 'leave') {
                const br = scopeBranch(q.branch);
                const f = [q.status && /^[a-z]+$/.test(q.status) && `status=eq.${q.status}`, br && `branch_code=eq.${enc(br)}`].filter(Boolean).join('&');
                const rows = await get(`leave_requests?${f}&select=*&order=requested_at.desc&limit=200`);
                const ids = [...new Set(rows.map(r => r.employee_id))];
                const emps = ids.length ? await get(`employees?id=in.(${ids.map(enc).join(',')})&select=id,full_name`) : [];
                return res.status(200).json({ rows: rows.map(r => ({ ...r, full_name: emps.find(e => e.id === r.employee_id)?.full_name || '—' })) });
            }
            if (q.view === 'shifts') {
                const br = scopeBranch(q.branch);
                const rows = await get(`employees?${br ? `branch=eq.${enc(br)}&` : ''}active=is.true&select=id,full_name,branch,role,shift_start,shift_end,grace_min,weekly_off&order=full_name.asc`);
                return res.status(200).json({ rows });
            }
            throw new UserError('Unknown view.');
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        switch (b.action) {
            case 'punch': {
                if (!['in', 'out'].includes(b.kind)) throw new UserError('Unknown punch.');
                if (!me.branch) throw new UserError('Your account has no branch — ask an admin.');
                const br = await branchOf(me.branch);
                const lat = Number(b.lat), lng = Number(b.lng);
                let fence = { ok: true, distance: null, unset: true };
                if (br?.lat != null && br?.lng != null) {
                    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new UserError('Location is needed to check in. Allow location for this site and try again.');
                    fence = insideFence(br, lat, lng, b.accuracy);
                    if (!fence.ok) throw new UserError(`You are about ${fence.distance >= 1000 ? (fence.distance / 1000).toFixed(1) + ' km' : fence.distance + ' m'} from ${br.branch_name || me.branch}. Check ${b.kind} at the branch.`, 403);
                }
                const out = await rpc('attendance_punch', {
                    p_emp: myId, p_kind: b.kind, p_branch: me.branch,
                    p_lat: Number.isFinite(lat) ? lat : null, p_lng: Number.isFinite(lng) ? lng : null, p_distance: fence.distance
                });
                return res.status(200).json({ success: true, record: out, no_location: Boolean(fence.unset) });
            }
            case 'leave_request': {
                if (!LEAVE_TYPES.includes(b.leave_type)) throw new UserError('Pick a leave type.');
                if (!isDay(b.from_date) || !isDay(b.to_date)) throw new UserError('Pick the dates.');
                const days = leaveDays(b.from_date, b.to_date);
                if (days < 1) throw new UserError('To date must be on or after From date.');
                if (days > 60) throw new UserError('A leave request can be up to 60 days.');
                const clash = await get(`leave_requests?employee_id=eq.${enc(myId)}&status=in.(pending,approved)&from_date=lte.${b.to_date}&to_date=gte.${b.from_date}&select=id`);
                if (clash.length) throw new UserError('You already have leave on some of these days.');
                const r = await fetch(`${rest}/leave_requests`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' },
                    body: JSON.stringify({ employee_id: myId, branch_code: me.branch || null, leave_type: b.leave_type, from_date: b.from_date, to_date: b.to_date, days, reason: String(b.reason || '').trim().slice(0, 300) || null }) });
                if (!r.ok) throw new UserError('Could not send the request.');
                return res.status(200).json({ success: true, request: (await r.json())[0] });
            }
            case 'leave_cancel': {
                const l = (await get(`leave_requests?id=eq.${enc(b.id)}&select=*`))[0];
                if (!l || l.employee_id !== myId) throw new UserError('Request not found.', 404);
                if (l.status !== 'pending') throw new UserError(`This request is already ${l.status}.`);
                await fetch(`${rest}/leave_requests?id=eq.${l.id}&status=eq.pending`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ status: 'cancelled' }) });
                return res.status(200).json({ success: true });
            }
            case 'leave_decide': {
                needManager();
                if (!['approved', 'rejected'].includes(b.decision)) throw new UserError('Approve or reject.');
                const l = (await get(`leave_requests?id=eq.${enc(b.id)}&select=*`))[0];
                if (!l) throw new UserError('Request not found.', 404);
                if (!isAdmin && l.branch_code !== session.branch) throw new UserError('That request is not for your branch.', 403);
                if (l.employee_id === myId && !isAdmin) throw new UserError('You cannot approve your own leave.', 403);
                if (l.status !== 'pending') throw new UserError(`This request is already ${l.status}.`);
                await fetch(`${rest}/leave_requests?id=eq.${l.id}&status=eq.pending`, { method: 'PATCH', headers: serviceHeaders(),
                    body: JSON.stringify({ status: b.decision, decided_by: userName, decided_at: new Date().toISOString(), decision_note: String(b.note || '').trim().slice(0, 300) || null }) });
                return res.status(200).json({ success: true });
            }
            case 'manual': {
                needManager();
                if (!isDay(b.date)) throw new UserError('Pick the date.');
                if (b.check_in && !isTime(b.check_in)) throw new UserError('Check-in time must be HH:MM.');
                if (b.check_out && !isTime(b.check_out)) throw new UserError('Check-out time must be HH:MM.');
                if (!b.check_in && b.check_out) throw new UserError('Enter the check-in time too.');
                const e = await employeeInScope(b.employee_id);
                if (e.id === myId && !isAdmin) throw new UserError('Ask another manager to correct your own attendance.', 403);
                const br = await branchOf(e.branch);
                const tz = br?.timezone || 'Asia/Muscat';
                const inIso = b.check_in ? zonedIso(b.date, b.check_in, tz) : null;
                let outIso = b.check_out ? zonedIso(b.date, b.check_out, tz) : null;
                if (inIso && outIso && outIso <= inIso) outIso = new Date(new Date(outIso).getTime() + 864e5).toISOString(); // night shift ends next day
                const out = await rpc('attendance_set', { p_emp: e.id, p_day: b.date, p_branch: e.branch, p_in: inIso, p_out: outIso, p_reason: String(b.reason || '').slice(0, 300), p_user_name: userName });
                return res.status(200).json({ success: true, record: out });
            }
            case 'shift': {
                needManager();
                const e = await employeeInScope(b.employee_id);
                if (!isTime(b.shift_start) || !isTime(b.shift_end)) throw new UserError('Shift times must be HH:MM.');
                const grace = Math.round(Number(b.grace_min));
                if (!(grace >= 0 && grace <= 120)) throw new UserError('Grace must be 0–120 minutes.');
                const off = [...new Set((Array.isArray(b.weekly_off) ? b.weekly_off : []).map(Number).filter(n => n >= 1 && n <= 7))].sort();
                if (off.length > 3) throw new UserError('Up to 3 weekly off days.');
                await fetch(`${rest}/employees?id=eq.${enc(e.id)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ shift_start: b.shift_start, shift_end: b.shift_end, grace_min: grace, weekly_off: off }) });
                return res.status(200).json({ success: true });
            }
            default: throw new UserError('Unknown action.');
        }
    } catch (err) {
        if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Attendance request failed.', details: err.message });
    }
}
