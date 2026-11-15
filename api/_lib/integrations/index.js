// File: api/_lib/integrations/index.js
// Registry of code adapters for 3rd-party APIs. To add a new API:
//   1. create api/_lib/integrations/<name>.js exporting { label, kinds, secretFields, configFields, test(integration, input) }
//   2. import it below
//   3. add the integration in Admin → Integrations and pick the adapter.
import alfarhaonline from './alfarhaonline.js';
import genericRest from './generic-rest.js';

export const ADAPTERS = {
    alfarhaonline,
    generic_rest: genericRest
};

// Adapters seeded in the DB whose code is not written yet (carrier tracking, Phase 4).
export const PLANNED = ['smsa', 'aramex', 'dhl', '17track'];

export function adapterCatalog() {
    return Object.entries(ADAPTERS).map(([id, a]) => ({
        id, label: a.label, kinds: a.kinds, secretFields: a.secretFields, configFields: a.configFields || []
    })).concat(PLANNED.map(id => ({ id, label: `${id.toUpperCase()} (coming soon)`, kinds: ['carrier'], secretFields: ['api_key'], configFields: [], planned: true })));
}
