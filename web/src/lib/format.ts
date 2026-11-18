// Small text helpers shared by pages (same as the old UI.clean).

/** Scanned / typed codes: trim, drop a leading apostrophe (spreadsheets), remove spaces, upper-case. */
export const clean = (v: unknown) => String(v || '').trim().replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
