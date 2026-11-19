// File: api/router.js — the ONLY Vercel function (Hobby plan allows 12).
// vercel.json rewrites /api/<name> → /api/router?__route=<name>; each handler lives in api/_routes/<name>.js.
// To add an endpoint: create api/_routes/<name>.js, import it below, add it to ROUTES.
import { withAudit } from './_lib/audit.js';
import accounts from './_routes/accounts.js';
import activity from './_routes/activity.js';
import attendance from './_routes/attendance.js';
import bookings from './_routes/bookings.js';
import chat from './_routes/chat.js';
import branches from './_routes/branches.js';
import codes from './_routes/codes.js';
import consolidation from './_routes/consolidation.js';
import carrierSync from './_routes/carrier-sync.js';
import countries from './_routes/countries.js';
import createUser from './_routes/create-user.js';
import customers from './_routes/customers.js';
import dashboardLayout from './_routes/dashboard-layout.js';
import dashboard from './_routes/dashboard.js';
import delivery from './_routes/delivery.js';
import integrations from './_routes/integrations.js';
import login from './_routes/login.js';
import mainOffice from './_routes/main-office.js';
import notifications from './_routes/notifications.js';
import postalLookup from './_routes/postal-lookup.js';
import profile from './_routes/profile.js';
import status from './_routes/status.js';
import track from './_routes/track.js';
import transfers from './_routes/transfers.js';
import users from './_routes/users.js';
import warehouse from './_routes/warehouse.js';

const ROUTES = {
    accounts,
    activity,
    attendance,
    bookings,
    chat,
    branches,
    codes,
    consolidation,
    'carrier-sync': carrierSync,
    countries,
    'create-user': createUser,
    customers,
    'dashboard-layout': dashboardLayout,
    dashboard,
    delivery,
    integrations,
    login,
    'main-office': mainOffice,
    notifications,
    'postal-lookup': postalLookup,
    profile,
    status,
    track,
    transfers,
    users,
    warehouse
};

// Longest job (carrier sync) needs up to 60s.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    const query = req.query || {};
    const name = String(query.__route || '').split('/')[0];
    delete query.__route; // handlers see the same query string as before
    const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
    if (!route) return res.status(404).json({ error: 'Not found' });
    // every change (POST / PUT / PATCH / DELETE) is written to the activity log — see api/_lib/audit.js
    return withAudit(name, route, req, res);
}
