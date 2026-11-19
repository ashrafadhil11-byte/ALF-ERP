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
