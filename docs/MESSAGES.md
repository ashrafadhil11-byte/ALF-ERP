# Messages and notifications

## Messages (chat between users)
- Page: **Messages** (top of the menu) and the chat button in the top bar, which shows unread messages.
- One-to-one chats and groups. Groups can be renamed, people added, and anyone can leave.
- Reply to a message, copy it, delete your own (it shows "Message deleted"). "Seen" shows on your last message.
- Shipment numbers (9 digits or AFC-123456) and web links in a message open on click.
- New messages arrive within a few seconds while the page is open; the badge updates every 20 s elsewhere.
- Only the people in a chat can read it. Messages are **not** copied into the Activity Log.
- Database: migration `023_chat.sql` (chat_threads, chat_members, chat_messages). API: `/api/chat`.

## Notifications between locations (the bell)
| Event | Who is told |
|---|---|
| Cash sent | the receiving location (Main Office cashiers / the branch) — "confirm when you count it" |
| Cash received | the sender, with short / over |
| Payment request | Main Office cashiers and super admin |
| Payment request paid / rejected | the branch that asked |
| Material request | the warehouse operators |
| Materials dispatched / rejected | the branch that asked |
| Materials received | the warehouse |
| Cargo manifest received | the sending branch (missing boxes flagged) |
| Shared agent bill | each branch that carries a share |

Nothing is stored for notifications: they are read live from these records (last 7 days); your own actions are left out.
