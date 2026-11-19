# Main Office cash

Main Office is a location with its own books (`branch_type = 'main_office'`, only one allowed).
It holds Main Office Cash (account 1000) and the bank accounts (1021–1049, listed in `money_accounts`).
A branch may also have its own bank account.

## Who can use it
- Cashiers (`employees.is_cashier`, ticked by the super admin in Users) and the super admin.
- Both need their personal PIN (the same PIN as the warehouse). An unlock lasts 30 minutes.
- Branch users never see Main Office documents in Accounts.

## Money moves (none of them is an expense)
| What | Branch books | Main Office books |
|---|---|---|
| Branch sends cash | Cr 1000, Dr 1050 (in transit) | on receipt: Dr 1000, Cr 1050 at the branch; difference to 3900 |
| Main Office pays a branch's expense or bill | Dr expense / 2000, Cr 2060 (due to main office) | Dr 1160 (due from branches), Cr cash or bank |
| Split agent bill | each branch: Dr its cost, Cr 2060 | Dr 1160 + own share, Cr 2000 (agent) |

A transfer straight into a bank account is posted at once; a cash transfer to another location waits for "Receive".

## Split agent bill
Main Office → Payments → **Split an agent bill**. Shares can be set by hand or worked out
from a consolidation's shipments (chargeable weight, or CBM for containers). The bill is
kept at Main Office and paid from the Payments list like any other bill.

## Going live
1. Apply `supabase/migrations/021_main_office.sql`.
2. Branch Network → add the Main Office location (type "Main Office").
3. Users → tick "Main Office cashier" for the right people. They sign out and in once.
4. Each cashier sets a PIN on first open of Main Office.

## Booking code, cargo stock, shared consolidation costs (migration 022)
- Main Office and the warehouse make no bookings: their AWB digit is always 0. Only branches need a unique digit.
- Every box knows where it is. A transfer moves only the boxes that arrive: boxes left behind stay in the
  sender's stock, missing boxes are in nobody's stock. A shipment moves to the receiver once no box is left
  at the sender. Consolidation & Bulk shows cargo on hand / coming in / sent; the warehouse has a Cargo tab,
  separate from Packing materials.
- A cost bill on a consolidation is shared between the branches that booked its shipments (chargeable kg,
  containers by CBM) — even when the cargo now sits in the warehouse. Each branch carries its share as its own
  cost; the branch that took the bill is owed the rest through Main Office. Needs the Main Office location;
  without it (or for another currency) the whole bill stays with the branch that took it.
