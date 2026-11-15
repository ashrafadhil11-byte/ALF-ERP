// File: api/_lib/integrations/generic-rest.js — any REST API: checks it answers with the saved auth header.
export default {
    label: 'Generic REST API',
    kinds: ['order_source', 'carrier', 'notification', 'other'],
    secretFields: ['header_name', 'header_value'],
    configFields: ['test_path'],

    async test(integration) {
        if (!integration.base_url) throw new Error('Base URL is required.');
        const url = integration.base_url.replace(/\/$/, '') + (integration.config?.test_path || '');
        const headers = { Accept: 'application/json' };
        const { header_name, header_value } = integration.secret || {};
        if (header_name && header_value) headers[header_name] = header_value;
        const r = await fetch(url, { headers });
        return { ok: r.ok, message: `HTTP ${r.status} from ${new URL(url).host}` };
    }
};
