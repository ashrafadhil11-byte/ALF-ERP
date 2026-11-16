// File: api/_routes/track.js — PUBLIC customer tracking + review (no sign-in).
//   GET  ?awb=X[&r=<review token>]   customer-facing status and timeline (no names, phones or internal remarks)
//   POST { token, rating 1-5, comment? }   one review per delivered shipment
import { serviceHeaders } from '../_lib/auth.js';
import { cleanOrderNo } from '../_lib/booking-map.js';

const enc = encodeURIComponent;

export default async function handler(req, res) {
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.method === 'GET') {
            const awb = cleanOrderNo(req.query?.awb);
            if (!awb || awb.length > 30) return res.status(400).json({ error: 'Enter your tracking number.' });
            const r = await fetch(`${rest}/bookings?awb=eq.${enc(awb)}&archived=is.false&select=id,awb,booked_at,origin_city,origin_country,dest_city,dest_country,pieces,current_status_code,current_stage,delivered_at,review_token,reviewed_at,review_rating,statuses(customer_label)`, { headers: serviceHeaders() });
            const b = (r.ok ? await r.json() : [])[0];
            if (!b) return res.status(404).json({ error: 'No shipment found with that tracking number.' });

            const er = await fetch(`${rest}/tracking_events?booking_id=eq.${b.id}&select=status_code,status,location,event_at,statuses(customer_label)&order=event_at.desc&limit=100`, { headers: serviceHeaders() });
            const events = (er.ok ? await er.json() : []).map(e => ({
                status: e.statuses?.customer_label || e.status, location: e.location || null, at: e.event_at
            }));
            const token = String(req.query?.r || '');
            return res.status(200).json({
                awb: b.awb,
                status: b.statuses?.customer_label || b.current_status_code,
                stage: b.current_stage,
                booked_at: b.booked_at,
                delivered_at: b.delivered_at,
                origin: [b.origin_city, b.origin_country].filter(Boolean).join(', '),
                destination: [b.dest_city, b.dest_country].filter(Boolean).join(', '),
                pieces: b.pieces,
                events,
                review: {
                    done: Boolean(b.reviewed_at),
                    rating: b.reviewed_at ? b.review_rating : null,
                    can_review: Boolean(token && b.review_token && token === b.review_token && !b.reviewed_at)
                }
            });
        }

        if (req.method === 'POST') {
            const { token, rating, comment } = req.body || {};
            if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return res.status(400).json({ error: 'This review link is not valid.' });
            const r = await fetch(`${rest}/rpc/review_submit`, {
                method: 'POST', headers: serviceHeaders(),
                body: JSON.stringify({ p_token: token, p_rating: parseInt(rating, 10), p_comment: String(comment || '').slice(0, 1000) })
            });
            const out = await r.json().catch(() => ({}));
            if (!r.ok) return res.status(400).json({ error: out.message || 'Could not save your review.' });
            return res.status(200).json({ success: true, awb: out });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: 'Tracking is unavailable right now.' });
    }
}
