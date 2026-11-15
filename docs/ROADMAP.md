# ALF-ERP — Roadmap to the complete ERP

_Last updated 2026-11-16. Decisions below come from the owner's answers._

**Ground rule:** every module is **added alongside** what exists. Current features (Al-Farha Online import,
shipments, scan & update, carrier sync, dashboard, branches, staff, integrations, PWA) keep working as they are.
New tables and new API routes only; existing API routes keep their behaviour; tests run on every change.

## Already live
Dashboard (role-based), Shipments & AWB (import / manual / CSV / edit / cancel / delete), Scan & Update,
carrier sync (SMSA, Aramex, DHL, 17Track, every 15 min), Integrations (`connectors.js`), Branches,
Staff & Users, installable PWA with phone navigation.

---

## Phase A — Booking reference + full booking form  ← next

### Reference rule: `D B C NNNNNN` (no separators)
| Part | Source | Example |
|---|---|---|
| **D** destination | `destination_codes` table (admin-editable). Frequent countries get a **numeric** code; every other country uses its **2-letter ISO** code | 3 (India), DE (Germany) |
| **B** branch | `branches.booking_code` (the "AWB digit" set when creating the branch) | 1 (Salalah), 2 (Sannayya) |
| **C** cargo type | `cargo_types` table (admin-editable list) | 1 Air, 2 Sea, 3 Road |
| **NNNNNN** | 6-digit running number from **000001**, **per branch + per destination, never resets**. All 2-letter-coded countries **share one series per branch** | 000001 |

Examples — Salalah (1), Air (1):
- India (3): `311000001`, next India booking `311000002`
- Germany (DE): `DE11000001`, then Canada (CA): `CA11000002` (shared alpha series)

Seed values (editable afterwards): India **3** (one code for all of India), UAE 2, Saudi 4, Pakistan 5, Bangladesh 6,
Sri Lanka 7, Philippines 8, Egypt 9; code 1 free. Cargo: 1 Air, 2 Sea, 3 Road.

- Generated in the database in one transaction (`next_booking_ref()`, counter row locked) — no duplicates even with many counters at once.
- **Imported Al-Farha Online orders keep their own order number** as AWB. Only bookings created in the ERP get the new reference.
- Branches page "Live AWB" preview updated to the D-B-C order and 000001 start.
- New admin pages: **Destination codes**, **Cargo types**.

### Full booking form (replaces the short "New Shipment" form for manual bookings)
1. **Sender** — search existing customer by phone or civil ID (Phase D links them), or type new.
2. **Receiver** — name, phones (mobile + WhatsApp), full address (house, street, landmark, post office, district, state, PIN, country).
3. **Shipment** — destination (drives D), cargo type (drives C), service, contents, declared value, insurance.
4. **Boxes** — one line per box: weight, L×W×H → volumetric weight, chargeable weight.
5. **Charges** — from rate card (Phase C), discounts, loyalty redemption (Phase E), total, payment method.
6. **Review & confirm** → reference generated → print label (barcode) + receipt, WhatsApp confirmation.

---

## Phase B — Delivery + proof of delivery (POD)
- Out for delivery (own driver or 3rd-party agent), delivered, failed attempt with reason, re-attempt.
- Driver phone screen (in the PWA): today's list, scan, receiver name, photo, signature.
- POD files in Supabase Storage (private). POD visible in shipment details and printable.
- On delivery: review request (tracking page + WhatsApp link + email).

## Phase C — Accounts (role-based)
| Role | Sees |
|---|---|
| **Branch manager** ("Branch Admin") | **Branch operations**: rate cards, invoices/receipts, payments (cash / card / bank / credit), customer balances, expenses, daily cash closing, branch P&L — per currency |
| **Super Admin / Head Office** | **Full accounting**: all of the above + chart of accounts, double-entry journals (auto-posted from invoices, payments, expenses), ledgers, trial balance, P&L, balance sheet, all branches |

Rate-card methods: per kg, fixed by volumetric weight band, fixed per package, per box. Multi-currency per branch.

## Phase D — Customer database
- One customer record per sender, matched by **phone (normalised) or civil ID**; receivers saved as the customer's contacts.
- Auto-built from every booking (manual and imported); staff can **merge duplicates**.
- Customer page: all shipments, totals, balance, notes.

## Phase E — Loyalty
- **All earning options available**, chosen in settings later: per amount spent, per kg shipped, per shipment, plus tiers (e.g. Silver / Gold / Platinum).
- Points ledger per customer; redeem as a discount on a booking (Phase A form) / invoice (Phase C).

## Phase F — CRM + WhatsApp (planned later)
To decide when we get there:
- **WhatsApp Business Cloud API** (official, Meta-approved, template messages, reliable) vs **WhatsApp Web automation** (unofficial — risk of the number being banned).
- Auto-reply: customer sends an AWB → bot replies with live status from the ERP.
- Shared inbox, message templates (booking confirmation, out for delivery, delivered, review), campaign lists from the customer database.

---

## Order of work
A → B → C → D → E → F. Each phase ships on its own, with tests, without changing earlier behaviour.
