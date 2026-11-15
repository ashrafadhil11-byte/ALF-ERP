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
//   kinds          'order_source' | 'carrier' | 'notification' | 'other'
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
//
// =====================================================================

const enc = encodeURIComponent;
const clean = (v) => String(v ?? '').trim();
const properCase = (s) => clean(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const first = (...vals) => vals.find(v => v !== undefined && v !== null && clean(v) !== '' && clean(v) !== '0');
const num = (v) => {
    const n = parseFloat(clean(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
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
        testInput: 'AWB',
        async test({ call, input }) {
            const d = await call('track', { awb: input.value });
            return { ok: true, message: `${(d.Scans || []).length} scans returned`, sample: (d.Scans || [])[0] };
        }
    },

    // -----------------------------------------------------------------
    //  DHL — Shipment Tracking Unified API
    // -----------------------------------------------------------------
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
        testInput: 'AWB',
        async test({ call, input }) {
            const xml = await call('track', { awb: input.value });
            const updates = (xml.match(/<TrackingResult>/g) || []).length;
            return { ok: true, message: `${updates} tracking updates returned` };
        }
    },

    // -----------------------------------------------------------------
    //  Generic REST — checks any API answers (no code needed)
    // -----------------------------------------------------------------
    generic_rest: {
        label: 'Generic REST API (connectivity check)',
        kinds: ['order_source', 'carrier', 'notification', 'other'],
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
