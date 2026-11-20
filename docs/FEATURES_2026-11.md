# New features — November 2026 (batch 1)

## Loyalty points (migration 025)
- **Earn:** every receipt on a customer's invoice earns points. Default 1 point per OMR 1; a currency without a rate earns nothing.
- **Tiers** by points earned in the last 12 months: Silver (0) · Gold (300, +25 % points) · Platinum (1000, +50 %).
- **Spend:** Accounts → open an invoice → "Use points" (from 100 points; 100 points = OMR 1). Booked as Dr 5800 Loyalty discounts / Cr 1100.
- **Undo:** voiding a receipt takes its points back; voiding an invoice gives back points spent on it. Merged customers keep all points.
- **Where:** customer profile shows balance, worth, tier, progress and history; managers can adjust (with a reason).
  Head office: Customers → "Loyalty settings" (on/off, earn rate, point value, minimum, tiers).

## Pickup requests (migration 026)
- Menu → **Pickups**: record a request (customer, phone, address, day, time slot, pieces, notes).
- A manager assigns a driver (Staff & Users → tick "Driver"). The driver sees **My pickups** with Call, WhatsApp, Map, "Picked up", "Could not".
- **Make booking** opens the booking form with the sender filled in; saving links the booking to the pickup.
- Bell: the driver hears about a pickup given to them; managers about new requests.

## Daily manager summary (migration 027)
- Menu → **Daily summary** (managers and head office): bookings and kg, received (by method), invoiced, expenses,
  cash closed or not, deliveries, pickups, exceptions, unpaid invoices, and what is still waiting (cargo, cash, requests, materials).
- Head office sees the company total and every branch. Any past day can be opened.
- **Every evening at 8 pm Oman** (Vercel Cron → `/api/summary`) the day is saved and the bell tells each manager — and head office for the company.

# Batch 2

## Chat extras (migration 028)
- In a chat, the **+** button opens: **Photo / PDF** (photos are made smaller before sending; max 3 MB), **Share shipment**
  (a live card: status, destination, boxes — opens the shipment) and the emoji.
- Paste a picture straight into the message box. Files sit in the private "chat-files" storage, shown through 10-minute links;
  deleting your message removes the file.
- "**… is typing**" shows in the chat header while the other person types.

## Backups you keep (migration 029)
- Every night, with the 8 pm job, every business table is saved as one compressed file in private storage; the last 14 are kept.
- Super admin → Settings → **Backups**: download any copy, or **Back up now**.
- Left out: integration API keys and PIN codes. Sign-in passwords stay with Supabase.

## AI assistant (ready — needs a key)
- Menu → **AI Assistant**: ask in plain words ("which shipments are stuck in customs?").
- Switch it on: Integrations → add **Claude (Anthropic)** or **OpenAI-compatible**, paste the API key, save, active.
- Read-only. It can look at shipments, counts, one shipment's history, the daily summary (managers) and customers —
  only within what the user may see (their branch; head office everything). Questions are not copied into the Activity Log.

## AI assistant — jobs and reports (migration 030)
- **Reads everything the user may open**, through the same APIs as the pages: super admin / head office every branch,
  others their own branch. Accounts (money, profit for any period, packing-material stock, invoices…), customers,
  transfers, consolidations, attendance, deliveries, pickups, bookings, staff, daily summary.
  Not the Main Office and Warehouse-operator pages (they need their PIN) — the AI sends people there.
- **Does jobs, after a Confirm tap:** shipment status updates (one or many AWBs), new pickups, giving a pickup to a driver,
  "picked up", chat messages to a colleague, scheduled reports. The AI only *prepares* a card; nothing changes until the
  user taps **Confirm**, and then it goes through the normal API — same permissions and checks, in the Activity Log
  as that user (user agent "AI Assistant").
- **Scheduled reports** ("send me the daily summary every morning"): daily summary (managers), unpaid invoices (managers),
  shipments with problems (anyone). Morning ≈ 6 am Oman (yesterday's figures, rides on the carrier-sync job, now 02:00 UTC);
  evening ≈ 8 pm (today's, rides on the summary job). They arrive in **Messages → AI Assistant** with the chime and phone
  notification. Stop one by asking the assistant.
- Free Vercel plan: scheduled jobs start some time within their hour (6–7 am / 8–9 pm).

## Farah — the assistant becomes a chat colleague (migration 031)
- The AI assistant is now **Farah**, a chat in **Messages** (and the floating chat button), pinned at the top with her own
  avatar. She greets each person by first name when her chat is made, and greets again on their first message of the day.
- Talk to her like a colleague; she answers in the user's language, shows "Farah is typing…", and puts **Confirm / Cancel**
  cards right inside her message. The cards are kept on the server (chat_messages.ai_actions), so Confirm runs exactly what
  was shown; a card can be done only once, and permissions are checked again when it runs.
- Scheduled reports arrive in the same chat. Text only (no photos or shipment cards to Farah yet).
- The old AI Assistant page and menu item ("Farah · AI") open her chat.
- Consolidations can be opened by MAWB (`/api/consolidation?mawb=…`); typographic dashes (‑ –) count as "-".

## Farah as a personal assistant · To-do · live screens (migration 032)
- **Daily check-in:** on the first visit of the day (from 5 am Oman), if anything is waiting, Farah writes what it is —
  leave requests to decide, payment / cash / material requests and incoming cargo for your locations (the bell),
  shipments with problems, to-dos due — and asks what you would like ("Shall I approve Ali's leave, or look first?").
  Nothing waiting → no message. Sent once a day (the day is claimed first, so two tabs do not both send it).
- She asks short questions when something is unclear and offers the next step. Links she writes (/app/…) can be tapped.
- **Leave approvals** through Farah (managers; Confirm card; not your own leave). Payment requests, cash and warehouse
  requests stay behind the PIN — Farah gives the link instead.
- **To-do** (menu → To-do): your own list (nobody else sees it), overdue / today / coming up / any time / done.
  Farah can add ("remind me to…"), list and tick off to-dos; "Ask Farah" on a to-do opens her chat with it ready to send.
- **Shipment card anywhere:** any link to a shipment (chat cards, AWB numbers in messages, Accounts, Customers, Status
  Update…) opens the card over the page you are on, with "Open in Shipments" and "Update status". The Shipments page
  keeps its own buttons (edit, WhatsApp, sync, cancel, delete). Shared code: web/src/components/ShipmentDrawer.tsx.
- **Changes show at once:** after any save, reads started before it are not reused, cached lists are marked out of
  date, and the open page reloads (also after Farah's Confirm, a save in another ERP tab, and when you come back to the
  tab). Chat and "seen" saves are quiet. See web/src/lib/live.ts.

## Needs setting once
- **CRON_SECRET** in Vercel → Settings → Environment Variables (Production): any long random text. Vercel then signs its
  scheduled calls; without it the 8 pm summary save and the nightly backup do not run (the pages still work).
