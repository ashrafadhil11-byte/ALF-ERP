// =====================================================================
//  api/_lib/integrations/connectors.js
//  ALL 3rd-party APIs live in this one file. Add or change an API here.
// =====================================================================
//
//  HOW TO ADD A NEW API
//  1. Copy the TEMPLATE at the bottom, give it an id (e.g. `fedex`).
//  2. Fill in baseUrl, secrets, headers and endpoints.
//  3. Push to GitHub → Vercel deploys it.
//  4. Admin → Integrations → "Add API", pick your connector, paste the key, tick Active, press Test.
//
//  From any API file, call it with:
//     import { callApi } from './_lib/integrations/http.js';
//     const data = await callApi('fedex', 'track', { awb: '123' });
//
//  FIELDS
//   label          name shown in the admin page
//   kinds          'order_source' | 'carrier' | 'notification' | 'ai' | 'other'
//   baseUrl        default URL (can be overridden per integration in the admin page)
//   fallbackUrls   tried in order if the base URL fails (network error / 5xx / 404)
//   secrets        { fieldName: 'ENV_VAR_NAME' } — value comes from the admin page first,
//                  then from the Vercel env var. NEVER write real keys in this file.
//   config         non-secret settings with defaults, editable in the admin page
//   headers(ctx)   headers sent on every call; ctx = { params, secrets, config }
//   endpoints      { name: { method, path, query(ctx), body(ctx), headers(ctx), isOk(data,res), parse(data,ctx), timeoutMs } }
//                  path can be a string or ctx => string. body: object → JSON, string → sent as is (XML etc.)
//   testInput      label for the input box next to the Test button (e.g. 'Order no.')
//   test({ call, input })  what the Test button does; return { ok, message, sample? }
//   postal         ADDRESS LOOKUP ONLY: { priority, covers(code, cc), lookup({ call }, code, cc) → places }
//                  places = [{ postOffice, city, state, postalCode, countryCode, street?, building?,
//                              additionalNumber?, shortAddress?, lat?, lng? }]
//                  /api/postal-lookup tries each connector whose covers() is true, lowest priority first,
//                  and returns the first non-empty result. New country = new connector here.
//   fetchEvents({ call }, awb)  CARRIERS ONLY: return the tracking events (any order):
//                  [{ at: ISO time, description, location, remark, code: <our status code or null> }]
//                  The carrier sync job uses this to update shipment statuses automatically.
//
// =====================================================================

import { searchOman } from '../oman-places.js';

const enc = encodeURIComponent;
const clean = (v) => String(v ?? '').trim();
const properCase = (s) => clean(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const first = (...vals) => vals.find(v => v !== undefined && v !== null && clean(v) !== '' && clean(v) !== '0');
const num = (v) => {
    const n = parseFloat(clean(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------
//  CARRIER TEXT → OUR STATUS CODE
//  First matching rule wins. Edit freely; codes must exist in the status master.
//  No match = the event still shows on the timeline, but the shipment status doesn't change.
// ---------------------------------------------------------------------
export const CARRIER_STATUS_RULES = [
    [/not delivered|undeliver|unable to deliver|delivery (attempt|exception|failed)|attempted/i, 'DELIVERY_FAILED'],
    [/return(ed|ing)? to (shipper|sender|origin)/i, 'RETURNED_TO_SHIPPER'],
    [/\bdelivered\b/i, 'DELIVERED'],
    [/out for delivery|with delivery courier/i, 'OUT_FOR_DELIVERY'],
    [/ready for (pick ?up|collection)|available for (pick ?up|collection)|consignee collection|awaiting collection/i, 'READY_FOR_COLLECTION'],
    [/customs (released|cleared)|clearance (complete|completed|processing complete)|released by customs/i, 'IMPORT_CLEARED'],
    [/held (by|at) customs|customs hold|customs (delay|inspection)/i, 'CUSTOMS_HOLD'],
    [/customs|clearance/i, 'IMPORT_CUSTOMS'],
    [/arrived (at )?(the )?(delivery|destination) (facility|hub|station)|arrived at destination/i, 'ARRIVED_DEST_HUB'],
    [/depart|in transit|transit|forwarded|processed at|arrived at (sort|hub|facility)/i, 'IN_TRANSIT'],
    [/on hold|shipment hold/i, 'ON_HOLD']
];

export function carrierTextToStatus(text) {
    const t = String(text || '');
    if (/not received yet from shipper/i.test(t)) return null;
    const rule = CARRIER_STATUS_RULES.find(([re]) => re.test(t));
    return rule ? rule[1] : null;
}

/** Which connector tracks a shipment, from the forwarding agent name entered on "Handed to Forwarding Agent". */
export function carrierForAgent(agent) {
    const a = String(agent || '').toUpperCase();
    if (a.includes('SMSA')) return 'smsa';
    if (a.includes('DELHIVERY')) return 'delhivery';
    if (a.includes('ARAMEX')) return 'aramex';
    if (a.includes('DHL')) return 'dhl';
    return '17track'; // FedEx, UPS, India Post, etc. — 17Track covers most carriers
}

// Saudi National Address short address: 4 letters + 4 digits, e.g. RAAA2919
export const SA_SHORT = /^[A-Z]{4}\d{4}$/i;
// Countries zippopotam.us covers
const ZIPPO = new Set('AD AR AS AT AU BD BE BG BR CA CH CZ DE DK DO ES FI FO FR GB GF GG GL GP GT GU HR HU IM IN IS IT JE JP LI LK LT LU MC MD MH MK MP MQ MX MY NL NO NZ PH PK PL PM PR PT RE RU SE SI SJ SK SM TH TR US VA VI YT ZA'.split(' '));

const toIso = (v) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** a local time without zone ("2026-11-20T18:45:00") + its zone ("+03:00") → ISO; a time that has a zone keeps it */
export const zonedIso = (v, zone) => {
    const s = String(v || '').trim();
    const z = String(zone || '').trim();
    if (s && /^[+-]\d{2}:?\d{2}$/.test(z) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return toIso(s + (z.includes(':') ? z : z.slice(0, 3) + ':' + z.slice(3)));
    return toIso(s);
};

export default {

    // -----------------------------------------------------------------
    //  Al-Farha Online — order details (booking source)
    //  Docs: POST /api/order-details?order_no=...  header X-API-KEY
    // -----------------------------------------------------------------
    alfarhaonline: {
        label: 'Al-Farha Online (order details)',
        kinds: ['order_source'],
        baseUrl: 'https://api-direct.alfarhaonline.com',
        fallbackUrls: ['https://alfarhaonline.com'],
        secrets: { api_key: 'ALFARHA_ORDER_API_KEY' },
        headers: ({ secrets }) => ({ 'X-API-KEY': secrets.api_key }),
        endpoints: {
            getOrder: {
                method: 'POST',
                path: '/api/order-details',
                query: ({ params }) => ({ order_no: clean(params.orderNo).replace(/^'/, '') }),
                isOk: (data, res) => res.ok && data?.response === 'success' && Array.isArray(data.data) && data.data.length > 0,
                parse: (data) => data
            }
        },

        // Response → bookings row. Note: total_box / total_weight are at the TOP level, not inside data[0].
        toBooking(resp, orderNo, branch) {
            const o = resp.data[0];
            const rawType = clean(o.cargotype).toUpperCase();
            const CARGO = { D2D: 'Parcel', MAIL: 'Document', AIR: 'Air Freight', SEA: 'Sea Freight' };
            const address = [o.receiver_housename, o.receiver_street, o.receiver_landmark, o.receiver_postoffice,
                o.receiver_district, o.receiver_state, first(o.receiver_pincode)].map(clean).filter(v => v && v !== 'X').join(', ');
            const pieces = parseInt(first(resp.total_box, o.total_box, o.pcs, o.pieces, 1), 10);
            const awb = clean(first(o.o_unique_id, orderNo)).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
            return {
                awb,
                external_ref: clean(orderNo).replace(/^'/, '').replace(/\s+/g, '').toUpperCase(),
                source: 'alfarhaonline',
                branch_code: branch.branch_code,
                shipper: properCase(o.sender_name) || null,
                shipper_phone: first(o.sender_phone, o.sender_whatsappno) || null,
                consignee: properCase(o.receiver_name) || null,
                consignee_phone: first(o.receiver_mobile, o.receiver_phone, o.receiver_whatsapp) || null,
                consignee_address: address || null,
                origin_city: branch.location || branch.branch_name || null,
                origin_country: properCase(first(o.order_from, 'Oman')),
                dest_city: properCase(first(o.receiver_district, o.receiver_postoffice)) || null,
                dest_country: properCase(o.receiver_country) || null,
                package_type: CARGO[rawType] || (rawType ? clean(o.cargotype) : 'Parcel'),
                weight: num(first(resp.total_weight, o.total_weight, o.weight, o.actual_weight, o.chargeable_weight)),
                pieces: Number.isFinite(pieces) && pieces > 0 ? pieces : 1,
                declared_value: num(first(o.declared_value)),
                amount: num(first(o.amount, o.total_amount)),
                raw: { ...o, total_box: resp.total_box, total_weight: resp.total_weight },
                fetched_at: new Date().toISOString()
            };
        },

        testInput: 'Order no.',
        async test({ call, input }) {
            if (!clean(input.value)) return { ok: false, message: 'Enter an order number to test with.' };
            const resp = await call('getOrder', { orderNo: input.value });
            const o = resp.data[0];
            return { ok: true, message: `Found ${o.o_unique_id}: ${o.sender_name} → ${o.receiver_name}, ${o.receiver_country} (${resp.total_box} box, ${resp.total_weight} kg)` };
        }
    },

    // -----------------------------------------------------------------
    //  SMSA Express — tracking (endpoint from alfwebapp Database.gs)
    // -----------------------------------------------------------------
    smsa: {
        label: 'SMSA Express (tracking)',
        kinds: ['carrier'],
        baseUrl: 'https://ecomapis.smsaexpress.com',
        secrets: { api_key: 'SMSA_API_KEY' },
        headers: ({ secrets }) => ({ apikey: secrets.api_key }),
        endpoints: {
            track: { method: 'GET', path: ({ params }) => `/api/track/single/${enc(clean(params.awb))}` }
        },
        // SMSA scan type codes from the old system; anything else goes through the text rules.
        scanCodes: { AF: 'ARRIVED_DEST_HUB', CC: 'READY_FOR_COLLECTION', CR: 'IMPORT_CLEARED', DE: 'DELIVERY_FAILED', IC: 'IMPORT_CUSTOMS', ST77: 'IN_TRANSIT', HIP: null, PU: null },
        async fetchEvents({ call }, awb) {
            const d = await call('track', { awb });
            // a reply without a scan list is an error to show, not "nothing new" (this hid a broken reply before)
            const scans = d && typeof d === 'object' ? (d.Scans ?? d.scans) : undefined;
            if (!Array.isArray(scans)) {
                const said = d && typeof d === 'object' ? (d.message || d.Message || d.error || JSON.stringify(d).slice(0, 120)) : String(d || '').slice(0, 120);
                throw new Error(`SMSA reply not understood${said ? `: ${said}` : ''}`);
            }
            return scans.map(s => ({
                at: zonedIso(s.ScanDateTime, s.ScanTimeZone),
                description: clean(s.ScanDescription) || `SMSA ${clean(s.ScanType)}`,
                location: clean(s.City) || null,
                remark: clean(s.ReceivedBy) ? `Received by ${clean(s.ReceivedBy)}` : null,
                code: s.ScanType in this.scanCodes ? this.scanCodes[s.ScanType] : carrierTextToStatus(s.ScanDescription)
            }));
        },
        testInput: 'AWB',
        async test({ call, input }) {
            const events = await this.fetchEvents({ call }, input.value);
            return { ok: true, message: `${events.length} scans returned`, sample: events[0] };
        }
    },

    // -----------------------------------------------------------------
    //  DHL — Shipment Tracking Unified API
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    //  Delhivery B2B (India) — LR tracking, no API key: GET /v2/track/{LR}
    //  Gives the latest status only (+ manifested / picked-up / delivered times), times in India time (+05:30).
    // -----------------------------------------------------------------
    delhivery: {
        label: 'Delhivery B2B (LR tracking, no key)',
        kinds: ['carrier'],
        baseUrl: 'https://btob.api.delhivery.com',
        secrets: {},
        noKey: true,                      // works without an Integrations row (add one only to switch it off)
        endpoints: {
            track: { method: 'GET', path: ({ params }) => `/v2/track/${enc(clean(params.awb).replace(/\s+/g, ''))}` }
        },
        statusCode(status, remark) {
            const s = String(status || '').toUpperCase().replace(/[\s-]+/g, '_');
            const map = { DELIVERED: 'DELIVERED', OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', OFD: 'OUT_FOR_DELIVERY', IN_TRANSIT: 'IN_TRANSIT', INTRANSIT: 'IN_TRANSIT',
                PICKED_UP: null, MANIFESTED: null, PENDING: null, RTO: 'RETURNED_TO_SHIPPER', RETURNED: 'RETURNED_TO_SHIPPER', UNDELIVERED: 'DELIVERY_FAILED' };
            return s in map ? map[s] : carrierTextToStatus(`${remark || ''} ${status || ''}`);
        },
        async fetchEvents({ call }, lr) {
            let d;
            try { d = await call('track', { awb: lr }); }
            catch (e) { if (e.status === 404) throw new Error(`Delhivery does not know LR ${clean(lr)} (check the LR number)`); throw e; }
            if (!d || typeof d !== 'object' || !d.status) throw new Error(`Delhivery reply not understood: ${JSON.stringify(d).slice(0, 120)}`);
            const IST = '+05:30';
            const where = (v) => clean(v).replace(/_/g, ' ') || null;
            const out = [];
            if (d.manifested_date) out.push({ at: zonedIso(d.manifested_date, IST), description: 'Booked with Delhivery (manifested)', location: where(d.origin_branch) || clean(d.origin_city) || null, remark: d.mwbn ? `Waybill ${clean(d.mwbn)}` : null, code: null });
            if (d.pickup_date) out.push({ at: zonedIso(d.pickup_date, IST), description: 'Picked up by Delhivery', location: where(d.origin_branch) || clean(d.origin_city) || null, remark: null, code: null });
            const latest = zonedIso(d.delivered_date || d.timestamp, IST);
            if (latest) out.push({ at: latest, description: clean(d.scan_remark) || clean(d.status), location: where(d.location), remark: d.estimated_date && !d.delivered_date ? `Expected ${String(d.estimated_date).slice(0, 10)}` : null, code: this.statusCode(d.status, d.scan_remark) });
            return out.filter(e => e.at);
        },
        testInput: 'LR number',
        async test({ call, input }) {
            const events = await this.fetchEvents({ call }, input.value);
            const last = events[events.length - 1];
            return { ok: true, message: `${last?.description || 'No status'}${last?.location ? ' · ' + last.location : ''}`, sample: last };
        }
    },

    dhl: {
        label: 'DHL (tracking)',
        kinds: ['carrier'],
        baseUrl: 'https://api-eu.dhl.com',
        secrets: { api_key: 'DHL_API_KEY' },
        config: { service: 'express' },
        headers: ({ secrets }) => ({ 'DHL-API-Key': secrets.api_key }),
        endpoints: {
            track: {
                method: 'GET',
                path: '/track/shipments',
                query: ({ params, config }) => ({ trackingNumber: clean(params.awb), service: config.service || undefined })
            }
        },
        async fetchEvents({ call }, awb) {
            const d = await call('track', { awb });
            return (d.shipments?.[0]?.events || []).map(ev => ({
                at: toIso(ev.timestamp),
                description: clean(ev.description || ev.status || ev.statusCode) || 'DHL update',
                location: clean(ev.location?.address?.addressLocality) || null,
                remark: clean(ev.remark) || null,
                code: ev.statusCode === 'delivered' ? 'DELIVERED' : ev.statusCode === 'failure' ? 'DELIVERY_FAILED' : carrierTextToStatus(ev.description || ev.status)
            }));
        },
        testInput: 'AWB',
        async test({ call, input }) {
            const d = await call('track', { awb: input.value });
            const s = (d.shipments || [])[0];
            return { ok: Boolean(s), message: s ? `Status: ${s.status?.description || s.status?.statusCode}` : 'No shipment found' };
        }
    },

    // -----------------------------------------------------------------
    //  17Track — multi-carrier tracking (v2.4)
    // -----------------------------------------------------------------
    '17track': {
        label: '17Track (multi-carrier tracking)',
        kinds: ['carrier'],
        baseUrl: 'https://api.17track.net',
        secrets: { api_key: 'TRACK17_API_KEY' },
        headers: ({ secrets }) => ({ '17token': secrets.api_key }),
        endpoints: {
            register: { method: 'POST', path: '/track/v2.4/register', body: ({ params }) => [{ number: clean(params.awb), ...(params.carrier ? { carrier: params.carrier } : {}) }] },
            track: { method: 'POST', path: '/track/v2.4/gettrackinfo', body: ({ params }) => [{ number: clean(params.awb), ...(params.carrier ? { carrier: params.carrier } : {}) }] }
        },
        // 17Track milestone stages → our codes (checked before the text rules).
        stages: { Delivered: 'DELIVERED', OutForDelivery: 'OUT_FOR_DELIVERY', AvailableForPickup: 'READY_FOR_COLLECTION', DeliveryFailure: 'DELIVERY_FAILED', Returning: 'RETURNED_TO_SHIPPER', Returned: 'RETURNED_TO_SHIPPER' },
        async fetchEvents({ call }, awb) {
            const d = await call('track', { awb });
            const item = d?.data?.accepted?.[0];
            if (!item) {
                // Not known to 17Track yet: register it; events arrive on a later sync.
                await call('register', { awb });
                return [];
            }
            return (item.track_info?.tracking?.providers || []).flatMap(p => p.events || []).map(ev => ({
                at: toIso(ev.time_iso || ev.time_utc),
                description: clean(ev.description) || '17Track update',
                location: clean(ev.location) || null,
                remark: clean(ev.sub_status) || null,
                code: this.stages[ev.stage] || carrierTextToStatus(ev.description)
            }));
        },
        testInput: 'Tracking no.',
        async test({ call, input }) {
            const d = await call('track', { awb: input.value });
            const accepted = d?.data?.accepted?.length || 0;
            return { ok: d?.code === 0, message: accepted ? 'Tracking info found' : 'Number not registered yet (use register first)' };
        }
    },

    // -----------------------------------------------------------------
    //  Aramex — SOAP tracking (credentials: Integrations page or env)
    // -----------------------------------------------------------------
    aramex: {
        label: 'Aramex (tracking, SOAP)',
        kinds: ['carrier'],
        baseUrl: 'https://ws.aramex.net',
        secrets: { username: 'ARAMEX_USERNAME', password: 'ARAMEX_PASSWORD', account_pin: 'ARAMEX_ACCOUNT_PIN' },
        config: { account_number: '', account_entity: 'MCT', account_country_code: 'OM' },
        endpoints: {
            track: {
                method: 'POST',
                path: '/shippingapi/tracking/service_1_0.svc',
                headers: () => ({ 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml', SOAPAction: 'http://ws.aramex.net/ShippingAPI/v1/Service_1_0/TrackShipments' }),
                body: ({ params, secrets, config }) => {
                    const x = (v) => clean(v).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
                    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://ws.aramex.net/ShippingAPI/v1/" xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
 <soapenv:Body><v1:ShipmentTrackingRequest>
  <v1:ClientInfo><v1:UserName>${x(secrets.username)}</v1:UserName><v1:Password>${x(secrets.password)}</v1:Password><v1:Version>v1.0</v1:Version>
   <v1:AccountNumber>${x(config.account_number)}</v1:AccountNumber><v1:AccountPin>${x(secrets.account_pin)}</v1:AccountPin>
   <v1:AccountEntity>${x(config.account_entity)}</v1:AccountEntity><v1:AccountCountryCode>${x(config.account_country_code)}</v1:AccountCountryCode></v1:ClientInfo>
  <v1:Shipments><arr:string>${x(params.awb)}</arr:string></v1:Shipments>
  <v1:GetLastTrackingUpdateOnly>false</v1:GetLastTrackingUpdateOnly>
 </v1:ShipmentTrackingRequest></soapenv:Body></soapenv:Envelope>`;
                },
                isOk: (data, res) => res.ok && typeof data === 'string' && !/<HasErrors>true<\/HasErrors>/.test(data)
            }
        },
        async fetchEvents({ call }, awb) {
            const xml = await call('track', { awb });
            const tag = (block, name) => {
                const m = block.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
                return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : '';
            };
            const blocks = xml.match(/<(?:\w+:)?TrackingResult>[\s\S]*?<\/(?:\w+:)?TrackingResult>/g) || [];
            return blocks.map(b => ({
                at: toIso(tag(b, 'UpdateDateTime')),
                description: tag(b, 'UpdateDescription') || 'Aramex update',
                location: tag(b, 'UpdateLocation') || null,
                remark: tag(b, 'Comments') || null,
                code: carrierTextToStatus(tag(b, 'UpdateDescription'))
            }));
        },
        testInput: 'AWB',
        async test({ call, input }) {
            const xml = await call('track', { awb: input.value });
            const updates = (xml.match(/<TrackingResult>/g) || []).length;
            return { ok: true, message: `${updates} tracking updates returned` };
        }
    },

    // =================================================================
    //  POSTAL / ADDRESS LOOKUP  (used by /api/postal-lookup)
    // =================================================================

    // Oman — built-in list (api/_lib/oman-places.js): governorate → wilayat → town with Oman Post codes.
    // Answers a 3-digit code ("211") or a place name ("Ruwi"). No network, no key; runs before Zipcodebase.
    oman_local: {
        label: 'Oman postal codes (built-in list)',
        kinds: ['other'],
        endpoints: {},
        postal: {
            priority: 1,
            covers: (code, cc) => cc === 'OM',
            async lookup(_ctx, code) { return searchOman(code); }
        },
        testInput: 'Postal code or place (e.g. 211)',
        async test({ input }) {
            const r = searchOman(input.value);
            return { ok: r.length > 0, message: r.slice(0, 5).map(p => `${p.postalCode} ${p.postOffice}, ${p.state}`).join(' · ') || 'No match' };
        }
    },

    // India Post — 6-digit PIN → post offices. Free, no key.
    india_post: {
        label: 'India Post (PIN code lookup, free)',
        kinds: ['other'],
        baseUrl: 'https://api.postalpincode.in',
        endpoints: { pin: { method: 'GET', path: ({ params }) => `/pincode/${enc(params.code)}` } },
        postal: {
            priority: 10,
            covers: (code, cc) => (cc === 'IN' || !cc) && /^\d{6}$/.test(code),
            async lookup({ call }, code) {
                const d = await call('pin', { code });
                return (d?.[0]?.PostOffice || []).map(p => ({
                    postOffice: p.Name, city: p.District || p.Block || '', state: p.State || '', postalCode: code, countryCode: 'IN'
                }));
            }
        },
        testInput: 'PIN code',
        async test({ call, input }) { const d = await call('pin', { code: clean(input.value) }); return { ok: true, message: `${(d?.[0]?.PostOffice || []).length} post offices` }; }
    },

    // UK — postcodes.io (Royal Mail / ONS open data). Full or partial postcode. Free, no key.
    postcodes_io: {
        label: 'UK postcodes (postcodes.io, free)',
        kinds: ['other'],
        baseUrl: 'https://api.postcodes.io',
        endpoints: { search: { method: 'GET', path: '/postcodes', query: ({ params }) => ({ q: params.code, limit: 15 }) } },
        postal: {
            priority: 10,
            covers: (code, cc) => cc === 'GB' && /^[A-Z]{1,2}\d/i.test(code),
            async lookup({ call }, code) {
                const d = await call('search', { code });
                return (d?.result || []).map(r => ({
                    postOffice: r.admin_ward || r.parish || '', city: r.admin_district || '',
                    state: r.admin_county || r.region || r.country || '', postalCode: r.postcode, countryCode: 'GB',
                    lat: r.latitude, lng: r.longitude
                }));
            }
        },
        testInput: 'Postcode',
        async test({ call, input }) { const d = await call('search', { code: clean(input.value) }); return { ok: true, message: `${(d?.result || []).length} postcodes` }; }
    },

    // Saudi Arabia — National Address (SPL). Short Address (ABCD1234) or 5-digit zip. Needs an API key:
    // National Address developer portal → Profile → subscription key → paste in Integrations.
    // If the portal shows a different URL or path, change it in Integrations (no code change needed).
    saudi_address: {
        label: 'Saudi National Address (Short Address / zip)',
        kinds: ['other'],
        baseUrl: 'https://apina.address.gov.sa',
        secrets: { api_key: 'SAUDI_ADDRESS_API_KEY' },
        config: {
            short_address_path: '/NationalAddressByShortAddress/NationalAddressByShortAddress',
            zip_path: '/NationalAddress/v3.1/address/address-fixed-params',
            language: 'E'
        },
        // The old portal reads ?api_key=, the Azure portal reads this header — send both.
        headers: ({ secrets }) => ({ 'Ocp-Apim-Subscription-Key': secrets.api_key }),
        endpoints: {
            short: {
                method: 'GET', path: ({ config }) => config.short_address_path,
                query: ({ params, secrets, config }) => ({ shortaddress: params.code, language: config.language, format: 'json', encode: 'utf8', api_key: secrets.api_key })
            },
            zip: {
                method: 'GET', path: ({ config }) => config.zip_path,
                query: ({ params, secrets, config }) => ({ zipcode: params.code, language: config.language, format: 'json', encode: 'utf8', page: 1, api_key: secrets.api_key })
            }
        },
        postal: {
            priority: 5,
            covers: (code, cc) => cc === 'SA' && (SA_SHORT.test(code) || /^\d{5}$/.test(code)),
            async lookup({ call }, code) {
                const isShort = SA_SHORT.test(code);
                const d = await call(isShort ? 'short' : 'zip', { code: code.toUpperCase() });
                return (d?.Addresses || d?.addresses || []).map(a => ({
                    postOffice: clean(a.District), city: clean(a.City), state: clean(a.RegionName || a.Region),
                    postalCode: clean(a.PostCode), countryCode: 'SA',
                    street: clean(a.Street), building: clean(a.BuildingNumber), additionalNumber: clean(a.AdditionalNumber),
                    shortAddress: isShort ? code.toUpperCase() : clean(a.ShortAddress),
                    lat: num(a.Latitude), lng: num(a.Longitude)
                }));
            }
        },
        testInput: 'Short address (e.g. RAAA2919)',
        async test({ call, input }) {
            const d = await call('short', { code: clean(input.value).toUpperCase() });
            const a = (d?.Addresses || [])[0];
            return { ok: Boolean(a), message: a ? `${a.BuildingNumber} ${a.Street}, ${a.District}, ${a.City} ${a.PostCode}` : 'No address found for that short address' };
        }
    },

    // ~70 countries incl. USA, Canada (first 3 chars), Australia, Germany, France, Japan… Free, no key.
    zippopotam: {
        label: 'Zippopotam (US, CA, AU, EU & more — free)',
        kinds: ['other'],
        baseUrl: 'https://api.zippopotam.us',
        endpoints: { lookup: { method: 'GET', path: ({ params }) => `/${enc(params.cc.toLowerCase())}/${enc(params.code)}` } },
        postal: {
            priority: 20,
            covers: (code, cc) => ZIPPO.has(cc),
            async lookup({ call }, code, cc) {
                // Canada and UK are indexed by the first part only (FSA / outward code)
                const q = cc === 'CA' ? code.replace(/\s+/g, '').slice(0, 3)
                    : cc === 'GB' ? code.split(/\s+/)[0]
                    : code;
                const d = await call('lookup', { cc, code: q.toUpperCase() });
                return (d?.places || []).map(p => ({
                    postOffice: p['place name'], city: clean(p['place name'].replace(/\s*\(.*\)/, '')), state: p.state || '', stateCode: p['state abbreviation'] || '',
                    postalCode: cc === 'CA' ? code.toUpperCase() : d['post code'], countryCode: cc,
                    lat: num(p.latitude), lng: num(p.longitude)
                }));
            }
        },
        testInput: 'US zip (e.g. 10001)',
        async test({ call, input }) {
            const d = await call('lookup', { cc: 'us', code: clean(input.value) });
            return { ok: true, message: (d?.places || []).map(p => `${p['place name']}, ${p['state abbreviation']}`).join(' · ') || 'No match' };
        }
    },

    // Zipcodebase — paid global fallback (any country). Key: Integrations or ZIPCODEBASE_API_KEY.
    zipcodebase: {
        label: 'Zipcodebase (global postcodes, needs key)',
        kinds: ['other'],
        baseUrl: 'https://app.zipcodebase.com',
        secrets: { api_key: 'ZIPCODEBASE_API_KEY' },
        headers: ({ secrets }) => ({ apikey: secrets.api_key }),
        endpoints: { search: { method: 'GET', path: '/api/v1/search', query: ({ params }) => ({ codes: params.code, country: params.cc || undefined }) } },
        postal: {
            priority: 90,
            covers: (code) => !SA_SHORT.test(code),
            async lookup({ call }, code, cc) {
                const d = await call('search', { code, cc });
                return (d?.results?.[code] || []).map(r => ({
                    postOffice: r.city || r.province || code, city: r.city_en || r.city || r.county || '',
                    state: r.state || r.state_en || r.province || '', postalCode: r.postal_code || code,
                    countryCode: r.country_code || cc, lat: num(r.latitude), lng: num(r.longitude)
                }));
            }
        },
        testInput: 'Postcode',
        async test({ call, input }) { const d = await call('search', { code: clean(input.value) }); return { ok: true, message: `${Object.values(d?.results || {}).flat().length} places` }; }
    },

    // -----------------------------------------------------------------
    //  Generic REST — checks any API answers (no code needed)
    // -----------------------------------------------------------------
    generic_rest: {
        label: 'Generic REST API (connectivity check)',
        kinds: ['order_source', 'carrier', 'notification', 'ai', 'other'],
        secrets: { header_name: '', header_value: '' },
        requiredSecrets: [],
        config: { test_path: '' },
        headers: ({ secrets }) => (secrets.header_name && secrets.header_value ? { [secrets.header_name]: secrets.header_value } : {}),
        endpoints: { ping: { method: 'GET', path: ({ config }) => config.test_path || '', isOk: (d, res) => res.status < 500 } },
        async test({ call }) {
            await call('ping');
            return { ok: true, message: 'API answered.' };
        }
    }

    ,
    // -----------------------------------------------------------------
    //  AI — the assistant (api/_lib/assistant.js) uses whichever AI integration is active.
    //  Paste the key in Admin → Integrations; nothing works until a key is there.
    // -----------------------------------------------------------------
    claude: {
        label: 'Claude (Anthropic) — AI assistant',
        kinds: ['ai'],
        baseUrl: 'https://api.anthropic.com',
        secrets: { api_key: 'ANTHROPIC_API_KEY' },
        requiredSecrets: ['api_key'],
        config: { model: 'claude-sonnet-5-5' },
        headers: ({ secrets }) => ({ 'x-api-key': secrets.api_key, 'anthropic-version': '2023-06-01' }),
        endpoints: {
            messages: { method: 'POST', path: '/v1/messages', timeoutMs: 45000, body: ({ params, config }) => ({ model: config.model, max_tokens: 1500, ...params }) }
        },
        async test({ call }) {
            const d = await call('messages', { max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the word OK.' }] });
            return { ok: true, message: `Answered: ${(d?.content || []).map(c => c.text || '').join('').slice(0, 40)}` };
        }
    },
    openai_compat: {
        label: 'OpenAI-compatible (OpenAI, Azure, Groq, local…) — AI assistant',
        kinds: ['ai'],
        baseUrl: 'https://api.openai.com/v1',
        secrets: { api_key: 'OPENAI_API_KEY' },
        requiredSecrets: ['api_key'],
        config: { model: 'gpt-4o-mini' },
        headers: ({ secrets }) => ({ Authorization: `Bearer ${secrets.api_key}` }),
        endpoints: {
            chat: { method: 'POST', path: '/chat/completions', timeoutMs: 45000, body: ({ params, config }) => ({ model: config.model, ...params }) }
        },
        async test({ call }) {
            const d = await call('chat', { max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the word OK.' }] });
            return { ok: true, message: `Answered: ${String(d?.choices?.[0]?.message?.content || '').slice(0, 40)}` };
        }
    }

    // -----------------------------------------------------------------
    //  AI SLOT (reserved — see docs/ROADMAP.md "Phase G — AI")
    //  When we add AI: create a connector here with kinds: ['ai'], its key in
    //  secrets (e.g. { api_key: 'AI_API_KEY' }) and endpoints such as `chat`.
    //  The rest of the ERP will call it through callApi('<id>', 'chat', {...}),
    //  so the provider can be swapped later without touching any page.
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    //  TEMPLATE — copy, rename, fill in, remove the comment markers
    // -----------------------------------------------------------------
    // myapi: {
    //     label: 'My API (what it does)',
    //     kinds: ['carrier'],
    //     baseUrl: 'https://api.example.com',
    //     secrets: { api_key: 'MYAPI_API_KEY' },
    //     config: { account_no: '' },
    //     headers: ({ secrets }) => ({ Authorization: `Bearer ${secrets.api_key}` }),
    //     endpoints: {
    //         track: { method: 'GET', path: ({ params }) => `/v1/track/${encodeURIComponent(params.awb)}` },
    //         create: { method: 'POST', path: '/v1/shipments', body: ({ params, config }) => ({ account: config.account_no, ...params }) }
    //     },
    //     testInput: 'AWB',
    //     async test({ call, input }) {
    //         const d = await call('track', { awb: input.value });
    //         return { ok: true, message: JSON.stringify(d).slice(0, 120) };
    //     }
    // },
};
