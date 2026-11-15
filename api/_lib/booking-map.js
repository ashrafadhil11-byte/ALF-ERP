// File: api/_lib/booking-map.js — alfarhaonline order → bookings row.
// Same field rules alfwebapp uses (js/mobilebooking.js); unknown fields stay in `raw`.

const properCase = (s) => String(s || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const first = (...vals) => vals.find(v => v !== undefined && v !== null && String(v).trim() !== '');
const numOrNull = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
};

const CARGO_TYPES = { D2D: 'Parcel', MAIL: 'Document', AIR: 'Air Freight', SEA: 'Sea Freight' };

export function cleanOrderNo(v) {
    return String(v || '').trim().replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
}

/** Picks the order object out of the API response ({ response, data: [order] } or a bare object). */
export function extractOrder(apiResponse) {
    const d = apiResponse?.data ?? apiResponse;
    return Array.isArray(d) ? d[0] || null : d || null;
}

/**
 * @param order   one order object from alfarhaonline
 * @param orderNo the number that was scanned / typed
 * @param branch  { branch_code, location, branch_name } of the importing branch
 */
export function mapOrderToBooking(order, orderNo, branch) {
    const rawType = String(order.cargotype || '').trim().toUpperCase();
    const pieces = parseInt(first(order.pcs, order.pieces, order.total_box, order.total_boxes, 1), 10);
    return {
        awb: cleanOrderNo(first(order.o_unique_id, orderNo)),
        external_ref: cleanOrderNo(orderNo),
        source: 'alfarhaonline',
        branch_code: branch.branch_code,
        shipper: properCase(order.sender_name) || null,
        shipper_phone: first(order.sender_phone, order.sender_mobile) || null,
        consignee: properCase(order.receiver_name) || null,
        consignee_phone: first(order.receiver_phone, order.receiver_mobile) || null,
        consignee_address: first(order.receiver_address, order.receiver_full_address) || null,
        origin_city: branch.location || branch.branch_name || null,
        origin_country: properCase(first(order.order_from, 'Oman')),
        dest_city: properCase(first(order.receiver_district, order.receiver_city)) || null,
        dest_country: properCase(order.receiver_country) || null,
        package_type: CARGO_TYPES[rawType] || (rawType ? String(order.cargotype).trim() : 'Parcel'),
        weight: numOrNull(first(order.weight, order.actual_weight, order.act_weight, order.total_weight, order.chargeable_weight)),
        pieces: Number.isFinite(pieces) && pieces > 0 ? pieces : 1,
        declared_value: numOrNull(first(order.declared_value, order.item_value)),
        amount: numOrNull(first(order.amount, order.total_amount, order.grand_total)),
        raw: order,
        fetched_at: new Date().toISOString()
    };
}
