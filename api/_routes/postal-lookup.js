// File: api/_routes/postal-lookup.js
// GET /api/postal-lookup?code=<postcode | Saudi short address>&countryCode=<ISO2>
// Providers (India Post, postcodes.io, Saudi National Address, Zippopotam, Zipcodebase) live in connectors.js.
import { requireSession } from '../_lib/auth.js';
import { lookupPostal } from '../_lib/postal.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const session = await requireSession(req, res); if (!session) return;

    const code = String(req.query.code || '').trim();
    if (code.length < 2 || code.length > 12) return res.status(400).json({ error: 'Enter a postal code or short address.' });

    const out = await lookupPostal(code, req.query.countryCode);
    return res.status(200).json({ code, count: out.locations.length, provider: out.provider, locations: out.locations, errors: out.errors });
}
