// File: api/_routes/codes.js — destination codes + cargo types used in booking references.
//   GET                                   { destinations, cargo_types }  (any signed-in user)
//   POST   { type:'destination'|'cargo', ... }   create / update (super_admin, head_office)
//   DELETE ?type=destination&key=IN              remove a destination code (country then uses its alpha-2 code)
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';

const enc = encodeURIComponent;
class UserError extends Error {}

export default async function handler(req, res) {
    const session = await requireSession(req, res, req.method === 'GET' ? undefined : ADMIN_ROLES);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;

    try {
        if (req.method === 'GET') {
            const [d, c] = await Promise.all([
                fetch(`${rest}/destination_codes?select=*&order=code`, { headers: serviceHeaders() }),
                fetch(`${rest}/cargo_types?select=*&order=sort,code`, { headers: serviceHeaders() })
            ]);
            return res.status(200).json({ destinations: d.ok ? await d.json() : [], cargo_types: c.ok ? await c.json() : [] });
        }

        if (req.method === 'POST') {
            const b = req.body || {};
            let table, row, conflict;
            if (b.type === 'destination') {
                const country_code = String(b.country_code || '').trim().toUpperCase();
                const code = String(b.code || '').trim();
                if (!/^[A-Z]{2}$/.test(country_code)) throw new UserError('Choose a country.');
                if (!/^[0-9]{1,2}$/.test(code)) throw new UserError('Destination code must be a number (1–2 digits).');
                table = 'destination_codes'; conflict = 'country_code';
                row = { country_code, country_name: String(b.country_name || country_code).trim().slice(0, 80), code, active: b.active !== false };
            } else if (b.type === 'cargo') {
                const code = String(b.code || '').trim().toUpperCase();
                const name = String(b.name || '').trim();
                if (!/^[0-9A-Z]{1,2}$/.test(code)) throw new UserError('Cargo code must be 1–2 letters or digits.');
                if (!name) throw new UserError('Cargo type name is required.');
                table = 'cargo_types'; conflict = 'code';
                row = { code, name: name.slice(0, 60), description: String(b.description || '').trim().slice(0, 200) || null,
                        sort: Number.isFinite(+b.sort) ? +b.sort : 0, active: b.active !== false };
            } else {
                throw new UserError('Unknown type.');
            }
            const r = await fetch(`${rest}/${table}?on_conflict=${conflict}`, {
                method: 'POST',
                headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
                body: JSON.stringify(row)
            });
            const out = await r.json();
            if (!r.ok) {
                const msg = JSON.stringify(out);
                throw new UserError(msg.includes('destination_codes_code_key') ? `Code ${row.code} is already used by another country.` : 'Could not save.');
            }
            return res.status(200).json({ success: true, item: Array.isArray(out) ? out[0] : out });
        }

        if (req.method === 'DELETE') {
            const q = req.query || {};
            if (q.type !== 'destination') throw new UserError('Cargo types cannot be deleted — deactivate them instead.');
            const key = String(q.key || '').toUpperCase();
            if (!/^[A-Z]{2}$/.test(key)) throw new UserError('Invalid country.');
            const r = await fetch(`${rest}/destination_codes?country_code=eq.${enc(key)}`, { method: 'DELETE', headers: serviceHeaders() });
            if (!r.ok) throw new UserError('Could not delete.');
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        if (e instanceof UserError) return res.status(400).json({ error: e.message });
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
