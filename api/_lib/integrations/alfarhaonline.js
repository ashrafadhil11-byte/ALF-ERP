import { extractOrder } from '../booking-map.js';

// File: api/_lib/integrations/alfarhaonline.js — Al-Farha Online order lookup (same call as alfwebapp order-proxy).
export default {
    label: 'Al-Farha Online (order details)',
    kinds: ['order_source'],
    secretFields: ['api_key'],
    configFields: ['fallback_url'],

    async fetchOrder(integration, orderNo) {
        const clean = String(orderNo || '').trim().replace(/^'/, '');
        if (!clean) throw new Error('Order number is required.');
        const key = integration.secret?.api_key;
        if (!key) throw new Error('API key is not set for this integration.');

        const bases = [integration.base_url, integration.config?.fallback_url].filter(Boolean);
        let lastError = 'No base URL configured.';
        for (const base of bases) {
            try {
                const url = `${base.replace(/\/$/, '')}/api/order-details?order_no=${encodeURIComponent(clean)}`;
                const r = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'X-API-KEY': key,
                        'Accept': 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({ order_no: clean })
                });
                const text = await r.text();
                const data = JSON.parse(text);
                if (data && extractOrder(data) && (data.response === 'success' || data.data)) return data;
                lastError = `Order not found (HTTP ${r.status}).`;
            } catch (e) {
                lastError = e.message;
            }
        }
        throw new Error(lastError);
    },

    async test(integration, input = {}) {
        const o = extractOrder(await this.fetchOrder(integration, input.order_no)) || {};
        return { ok: true, message: `Found order ${o.o_unique_id || input.order_no}`, sample: { sender: o.sender_name, receiver: o.receiver_name, country: o.receiver_country } };
    }
};
