// Same theme as the old pages (scripts/tailwind.config.cjs) so classes produce identical pixels.
const shared = require('../scripts/tailwind.config.cjs');
module.exports = { ...shared, content: ['./index.html', './src/**/*.{ts,tsx}'] };
