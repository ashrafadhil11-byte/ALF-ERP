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
