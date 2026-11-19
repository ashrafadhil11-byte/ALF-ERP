# ALF-ERP → React migration plan

Status: **draft for approval** · 17 Nov 2026

## Goal

Move the screens from hand-written HTML pages to a React app **without changing any feature, rule, text, layout, colour, spacing or animation**. A user should not be able to tell which version they are using, except that switching pages is faster.

## What changes and what doesn't

| Part | Today | After |
|---|---|---|
| Server (API) | Node on Vercel, `api/router.js` + `api/_routes/*` | **Unchanged** |
| Database | Supabase Postgres, 20 migrations | **Unchanged** |
| Business rules & tests | `node --test tests/` (119 tests) | **Unchanged**, still the safety net |
| Screens | 19 HTML pages (~6,900 lines) + shared scripts (~1,900 lines) | React 18 + TypeScript, built with Vite |
| Styling | Prebuilt Tailwind + `ui.css` | **Same** Tailwind config and the same `ui.css`, imported as-is |
| Page changes | Full page reload | In-app navigation (sidebar and top bar stay put) |
| Data loading | `UI.api` with request de-duplication | TanStack Query (de-duplication + caching built in) |

The React screens call exactly the same `/api/...` endpoints with the same token, so every rule stays enforced on the server.

## Stack

- **React 18 + TypeScript**, built with **Vite**.
- **React Router** for pages; its navigation blocker replaces the current "unsaved changes" page guard.
- **TanStack Query** for API calls.
- **Tailwind 3.4** with the existing `scripts/tailwind.config.cjs`; the `content` paths are extended to cover `web/src`.
- **Vitest + Testing Library** for the shared components.
- **Playwright** for the side-by-side screenshot checks and click-through flows.

No new backend services, and no keys in the browser bundle (as now).

## Where it lives

- New folder `web/` with its own `package.json`. The repo root keeps no build dependencies, so the API deploys exactly as today.
- The React app is served at `/app/*` while the migration runs, e.g. `/app/shipments`.
- The sidebar links each item to the React page once it is done and approved, and to the old `.html` page until then. Both versions run against the same API, so nothing is lost if one page needs rolling back: switch the link back.
- At cutover, `/admin/<page>.html` redirects to `/app/<page>`, so bookmarks and printed links keep working.

## Shared pieces to rebuild first

Each of today's shared scripts becomes a React component or hook with the same markup and classes.

| Today | React |
|---|---|
| `sidebar.js` | `<Sidebar>` (same groups: Operations, CRM, Money & stock, Team, Settings) |
| `topbar.js`, `checkin.js` | `<TopBar>` with `<CheckIn>` (in / work / on break / done, reminder popups) |
| `notifications.js` | `<NotificationBell>` |
| `profile-modal.js` | `<ProfileModal>` |
| `ui.js` modal, confirm, toast | `<Modal>` with the dirty-data guard (asks before closing on outside click / Escape), `confirm()`, `toast()` |
| `ui.js` `autoFields`, `phoneField`, `combobox` | `<PhoneField>`, `<CountryField>`, `<CityField>` — same lists from `countries.js` and `oman-places.js` |
| `ui.js` `camera` | `<ScanButton>` (barcode scan that fills the field) |
| `ui.js` `whatsapp` | `useWhatsApp()` — the same single docked WhatsApp window |
| `ui.js` `menu`, `icon`, `pickBoxes` | `<Menu>`, `<Icon>`, `<PickBoxes>` |
| `print.js` | `printDocument()` (same print layouts) |
| page-leave animation | Route transition with the same timing |

## Phases

Each phase ends deployable, and nothing is pushed until you have seen it and approved it.

| Phase | Work | Pages |
|---|---|---|
| **0. Foundation** | `web/` scaffold, API client, login gate, router; move the mock server into the repo (`tests/mock/`); record **baseline screenshots** of every current page and popup at 1366×800 and 375×812 | — |
| **1. Frame** | Sidebar, top bar, check-in, notifications, profile, and all shared fields and popups above | — |
| **2. Small pages** | | Activity, CRM, Status update, Customers, Integrations |
| **3. Medium pages** | | Dashboard, Attendance, Warehouse, Staff & Users, Delivery |
| **4. Large pages** | | Booking, Consolidation, Branches, Shipments, Accounts |
| **5. Public pages & cutover** | Login, Tracking page, home and offline page; redirects; update the service worker so the app still installs and works offline; old pages kept for one release as a fallback, then removed | Login, Track, Index, Offline |

## "Done" for every page

A page only switches over when all of these pass:

1. **Looks the same:** Playwright screenshots of the old and new page, and every popup on it, match the baseline at desktop and phone size (tiny anti-aliasing differences only).
2. **Layout check:** the existing alignment check (nothing wider than the screen, nothing sticking out of a card or popup) passes.
3. **Works the same:** a click-through script repeats the page's main flows on both versions, e.g. booking → status → handed to agent; check in → break → check out; warehouse PIN; close a half-filled popup and get asked first.
4. **No console errors**, and the 119 API tests still pass.
5. **You approve** it on a preview link before it goes live.

## Rules while it runs

- **New features:** if a page is already converted, the feature goes into the React version; if not, into the old page, and the conversion picks it up.
- **Nothing is pushed** without your approval. Each phase is shown to you first on a preview.
- **API changes** are avoided during the migration. If one is needed, it gets its own commit and tests.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| Small behaviour lost in the rewrite (dirty guard, reminders, auto country/city) | Each one gets a component test and a Playwright flow before any page uses it |
| Vercel build change breaks the API deploy | Phase 0 is tried on a preview deployment first; the API files are untouched |
| Users' installed app (PWA) keeps old files | Service worker version bump at cutover; old pages kept one release |
| Larger first load than today | Code split per page; the frame loads first |
| Work paused on features | Small pages go first, so most of the gain arrives early |

## Progress

**Phase 0 — done locally, not pushed (17 Nov 2026)**

- `web/`: React 18 + TypeScript + Vite app at `/app/`. It has the shared API client (same token, de-duplication and sign-out on 401 as `UI.api`, with 3 unit tests), the sign-in gate and the router, plus a placeholder page. It uses the same Tailwind theme and imports `admin/components/ui.css` directly.
- `tests/mock/server.mjs`: the sample-data server, now in the repo. It finds the repo by itself.
- `tests/visual/`: `capture.mjs` takes screenshots plus the layout check, and `compare.mjs` diffs the pixels.
  - Baseline: 78 screenshots (15 pages + every popup, at 1366×800 and 375×812). Captured twice, they match 0.00%, so the comparison is reliable.
  - Screenshots are not committed (`.gitignore`); they are regenerated from the old pages whenever needed.
- `vercel.json` is unchanged: Phase 0 changes nothing that is deployed. Serving `/app/` on Vercel gets wired up in Phase 1, tested on a preview first.

**Phase 1 — done locally, not pushed (17 Nov 2026)**

- **The frame in React** (`web/src/components/frame/`): sidebar, phone bottom bar and slide-in menu, top bar, check-in / break buttons, check-in reminder, notifications, and the profile drawer. The markup, classes and behaviour are the same as the old scripts.
- **Shared parts:**
  - Popups: `Modal` with the "unsaved changes" guard, plus `confirm()`, toasts, the row menu, and the guard against leaving the page with unsaved changes.
  - Fields: `PhoneField`, `CountryField`, `CityField`, `ScanInput` / `camera()`.
  - Helpers: `pickBoxes()` and `whatsapp()`.
  - The postcode lookup is still to do. It is used only by Booking and Branch Network, so it moves with those pages in Phase 4.
- **Layout:** the React root is `display: contents`, so the frame lays out exactly like the old pages. `ui.css` lists the matching `#root` selectors next to the old ones.
  - All 78 screenshots of the old pages are unchanged by this.
- **Checks:**
  - The frame matches the old pages pixel for pixel on all 15 pages at desktop and phone size (30/30, 0.00%).
  - It also matches with notifications open, the profile drawer open, search expanded, and the phone menu open (8/8, 0%).
  - 13 unit tests cover the guard, phone codes, list search, check-in stages and notifications.
  - A scripted browser drove the fields on `/app/parts` without errors.
- **Mock server:** its clock is now frozen at 17 Nov 2026 11:30 Muscat, so screenshots repeat exactly. Run it with `MOCK_NOW=real` for a live clock.
- **Vercel:** builds `web/` into `/app` (`buildCommand`), and links into `/app/*` open the React app. Not deployed yet.
- **Review pages:** `/app/` (the frame; `?as=<page>.html` highlights that page in the menu) and `/app/parts` (try the fields and popups).

**Phase 1 — live in production since 17 Nov 2026 (commit a11f2d5).**

**Phase 2 — done locally, not pushed (18 Nov 2026)**

- **Converted pages:** Activity Log, CRM · WhatsApp, Scan & Update, Customers and Integrations, at `/app/activity`, `/app/crm`, `/app/status-update`, `/app/customers` and `/app/integrations`.
- **Menus:** the old pages' menu (`admin/components/sidebar.js`, `REACT_PAGES`) and the React menu (`web/src/lib/pages.ts`, `CONVERTED`) both open these five there. The old `.html` pages still work as a fallback.
- **Page styles:** each page's own `<style>` moved to `pages/<page>.css`. It is scoped to that page with `:where(body[data-page="…"])`, which keeps the same specificity, so it can't leak into other pages (Integrations restyles `.field`).
- **Checks:**
  - Page screenshots: 16 of 16 identical, covering desktop and phone plus their popups.
  - Step-by-step use (`tests/visual/flows.mjs`): 18 of 18 identical at 0%. The steps open a log entry, open a customer, edit and get asked before closing, search for a merge, pick a WhatsApp template, scan an AWB, accept the box picker, pick the agent milestone, submit, and open the integration edit and add forms.
  - Server requests: for each save the requests sent are byte-for-byte the same as the old pages'.
  - Exact text spacing: React splits text such as "2 · 2 shipments" into several pieces, which moves letters by a fraction of a pixel. Those texts are built as one piece.
- **One deliberate fix:** on Customers, after **Save details**, closing the profile no longer asks "Discard unsaved changes?". The old page forgot to clear its unsaved mark after saving.
- **Demo page removed:** `/app/parts` is gone. `/app/` on its own goes to the dashboard (still the old page). `/app/?as=<page>.html` stays for the frame check.

**Phase 2 — live in production since 18 Nov 2026 (commit 032eb72).**

**After the cutover — fixes and Reports (19 Nov 2026, not pushed yet)**

- **Reports** moved out of Accounts into its own page, `/app/reports`, under **Money & Stock** (Super Admin and Head Office, as before). Old `/app/accounts?tab=reports` links forward there.
  - **Print report** opens only the report as an A4 accounting document: company header, period, branch, currency, account codes, section subtotals, double-underlined totals, negatives in brackets, a balance check, "Prepared by / Approved by" lines and page numbers. Each currency prints on its own page.
  - **Export (Excel)** downloads the same report as a CSV spreadsheet.
  - The screen, the print and the export use one calculation (`web/src/lib/reports.ts`, with tests). Rows of the same account are now added together into one line.
- **Hidden buttons showing:** `ui.css` loads after Tailwind, so `.btn` (and the other shared classes that set a display) beat `hidden`. Buttons that should be hidden showed, for example "Show more" on the Activity Log and "Sync carriers" for staff. Fixed in `ui.css` for old and new pages.
- **Shipment card:** the edit and cancel forms, confirmations and messages opened from the card now show above it, not behind it.
- **Accounts:** after a Void form, the next form's Save button no longer stays coral.
- **Sidebar groups:** fold and open again (pushed earlier, commit a554471).
- **Activity log:** entries are recorded (checked in the database: every change since logging started on 17 Nov 2026 is there). A save to the log that the database refuses is now written to the server logs instead of being lost silently.
- **Local test setup:** the dev server now serves `/pwa.js` like production. `ALF_BROWSER=chrome` makes the test scripts use Chrome when Edge won't start.

**Phase 5 — done locally, not pushed (19 Nov 2026)**

- **Converted pages:** Sign-in at `/app/login` and customer tracking (with the delivery review) at `/app/track`. Both are public: they need no sign-in and show no menus.
- **Cutover — old addresses open the new pages** (Vercel redirects in `vercel.json`; the query string is kept):
  - `/login.html` goes to `/app/login`.
  - `/track.html?awb=…&r=…` goes to `/app/track?awb=…&r=…`, so tracking and review links already sent to customers keep working.
  - `/admin/<page>.html` goes to `/app/<page>` for all 15 pages, so bookmarks and saved links keep working.
  - The home page `/` sends visitors to `/app/login`.
- **Signing out or an expired session** now goes straight to `/app/login`.
- **Installed app (PWA):**
  - The service worker is now version 7, so installed apps drop the old cached pages.
  - The React pages now load `pwa.js`, so the "Install app" prompt and the installed-app look work on them. The tracking page skips it, as before.
- **Offline page:** kept as a plain `offline.html` on purpose. The service worker must be able to show it with no network, when the app's own code may not be available.
- **Tab titles:** every page shows its own title again (for example "Shipments - Al-Farha Cargo"). Phases 1 to 4 had left them all as "Al-Farha Cargo".
- **Rolling back:** the old `.html` files are still in the repository for one release. Removing the `redirects` block from `vercel.json` brings them back. After that release they can be deleted.
- **Checks:**
  - Public pages: 14 of 14 screenshots identical at 0% (desktop and phone, wrong password, show/hide password, tracking, review). Login and review requests are identical, and so is what sign-in saves.
  - All 15 signed-in pages after the cutover: 78 of 78 page and popup screenshots identical, frame 36 of 36.
  - The redirects only exist on Vercel, so they can't be tested locally. They need checking on the live site right after the push.
- **Sample server:** `tests/mock/server.mjs` now has a sample `/api/login`. `tests/visual/public.mjs` checks the public pages.

**Phase 4 — live in production (commit 3ddea72).**

**Phase 4 — details (19 Nov 2026)**

- **Converted pages:** New Booking, Branch Network, Consolidation & Bulk, Shipments & AWB and Accounts, at `/app/booking`, `/app/branches`, `/app/consolidation`, `/app/shipments` and `/app/accounts`. All 15 signed-in pages are now React.
- **New shared pieces:** the postcode / PIN / Saudi short-address lookup (`PostalLookup`), label and receipt printing (`lib/print.ts`, which reuses the old print code), and manifest printing (`lib/manifest.ts`).
- **Links switched to the new pages:** the menus, the "New booking" button in the top bar, the Shipments / View / New booking buttons, the AWB links on Customers, Scan & Update and the profit report, and the notification links (for example "4 shipments coming from …" now opens `/app/consolidation?tab=inbound`). The old `.html` pages still work as a fallback.
- **Checks:**
  - Page and popup screenshots: all 26 identical at 0% for the five pages, at desktop and phone size. Re-run across all 15 pages after the link switch: 78 of 78 identical.
  - Frame: 36 of 36 identical.
  - Step-by-step: Consolidation 31 of 31, Shipments 29 of 29, Accounts 76 of 77, Branch Network 16 of 17, New Booking identical apart from a sticky side panel drawn a fraction differently (positions measured identical).
    - The Accounts step that differs: right after **Year**, the old page was still showing "Loading…" when the picture was taken. One step later both are identical.
    - The Branch Network step that differs: the browser's spell-check underline.
  - Server requests: identical on all five pages, byte for byte.
- **Changed on purpose:** on Accounts, closing the cash with a difference used to show the error "c is not defined" instead of "Closed with a difference of …". It now shows the right message. Closing with no difference was already correct.
- **Kept as before (worth fixing later):**
  - On Shipments, **Edit** from the shipment card opens the form behind the card.
  - On Accounts, after a **Void** form the Save button of the next form stays coral.
- **Test helpers:** the step runner closes print windows and keeps the page in front, so printing no longer stalls it.

**Phase 3 — live in production (commit 00cf51f).**

**Phase 3 — details (18 Nov 2026)**

- **Converted pages:** Dashboard (10 widgets and Customize mode), Attendance, Warehouse, Staff & Users and Delivery & POD, at `/app/super-dashboard`, `/app/attendance`, `/app/warehouse`, `/app/create-user` and `/app/delivery`.
- **Links switched to the new pages:** the menus, the logo, the phone bottom bar, the check-in "Done" button, the "Open warehouse" link on Accounts and the admin-only redirects. Sign-in and the installed app's start page now open `/app/super-dashboard`. The old `.html` pages still work as a fallback.
- **Faster first load:** each page is downloaded the first time it is opened. The main bundle is about 101 KB compressed.
- **`Modal` can render its panel as a `<form>`:** the old popups that were `<form class="panel">` keep their exact structure.
- **Checks:**
  - Page and popup screenshots: 46 of 48 identical, covering all 10 pages at desktop and phone size.
    - The Dashboard's sync badge can read "Cloud Synced" or "Live", depending on which request finishes last. The old page does the same.
    - Integrations on phone differs by a few pixels.
  - Frame: 36 of 36 identical.
  - Step-by-step: 68 of 77 identical. The rest are pop-up messages caught as they faded, plus near-zero (0.00%) differences on the Dashboard.
  - Server requests: identical on every page, including the drawn delivery signature.
- **Changed on purpose:**
  - Cancelling a leave request: the confirmation box no longer shows the word "undefined".
  - The Dashboard's Latest Bookings search box shows what is typed in the top search.
  - On Staff & Users, a user whose branch no longer exists shows a blank Branch box, as before.
- **Sample server:** `tests/mock/server.mjs` now has a `/api/create-user` endpoint.

### How to run

```bash
node tests/mock/server.mjs                                   # old pages + sample API on http://localhost:5178
npm --prefix web install                                     # once
npm --prefix web run dev                                     # React app on http://localhost:5173/app/
npm --prefix web test                                        # React unit tests
node tests/visual/capture.mjs --out baseline                 # screenshots of the old pages
node tests/visual/capture.mjs --out current --target new     # screenshots of the converted React pages
node tests/visual/compare.mjs                                # differences → tests/visual/diff/
node tests/visual/capture.mjs --frame --out frame-old       # frame only (sidebar, top bar), old pages
node tests/visual/capture.mjs --frame --target new --out frame-new
node tests/visual/compare.mjs --base frame-old --cur frame-new --diff frame-diff
node tests/visual/flows.mjs --target old --out flows-old     # the same clicks on old and React pages
node tests/visual/flows.mjs --target new --out flows-new
node tests/visual/compare.mjs --base flows-old --cur flows-new --diff flows-diff
```

The layout check reports two existing items on the old pages; the React pages must report the same, no more:
- The collapsed top-bar search on desktop (hidden on purpose).
- On Staff & Users at phone width, the "You" tag next to your own name is cut off by the name truncation.

## Decisions needed from you

1. **URLs:** clean `/app/shipments` style (recommended), or keep `.html` names.
2. **Public tracking page:** convert it too (recommended for consistency) or leave it as a light plain page for customers on slow phones.
3. **Start:** begin with Phase 0 and show you the baseline screenshots and the empty React frame before anything else.
