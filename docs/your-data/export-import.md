# Export & import

**Settings → Access → Your data** (admin only).

## Download export

**Download export** saves `kinwall-export-YYYY-MM-DD.json` with everything your family entered:

| Included | Not included |
|---|---|
| Household settings | Passwords, OAuth tokens, CalDAV logins |
| Members, categories | API keys, sessions, recovery codes, the night PIN (set it again after a restore) |
| Chores **with completion history** (points awarded, and whether each is approved or waiting for a parent's OK), and the parent-approval settings on chores and members, and who's a grown-up | Webhook secrets, and "Not yet" notes on chores |
| Points spent, daily check-ins, sticker packs unlocked and sticker book pages | |
| [Temp check](../using/snapshot.md#temp-check) settings and answers (evening goal checks and energy battery check-ins too), each person's own feelings, and [journal](../using/journal.md) entries. [Medications](../using/medications.md) and their taken/skipped log. Sleep, feelings, goal checks, journal entries and medications are encrypted on the server but **in plain form in this file** (a connected app's export leaves them out). A [private journal](../using/journal.md#private-journals) entry's words and a private day's goal check notes are never in the file, for anyone: its mood and day are. Whether journals are private isn't in the file either | |
| Rewards (archived ones too), every reward request with its status and note, and each person's goal | |
| Lists (with their type: Groceries, Shopping, To-do or Reusable), items, group order, remembered store/category/aisle per item and the catalog categories (per catalog), stores' aisle orders | Push subscriptions |
| Local calendars **with their events** (reminders, travel time) | Synced events themselves (they're fetched again) |
| Every calendar's name, color, members, default category, filter and hidden events | Per-device appearance (it lives in each browser) |
| Per-event member, category and travel-time tags on synced events, and series-wide member and category tags on synced recurring events | |
| Notes threads on local events and list items | Notes on synced events |
| [Trackers](../using/trackers.md): books, memories and health visits. Health is encrypted on the server but **in plain form in this file** (it's your backup), so keep the file private | Photos (download them separately from Photos) |
| [Meals](../using/meals.md): recipes (archived ones too, basics with their links), planned meals with their own ingredient copies, and which ingredients were already added to which shopping list | |
| ICS feed URLs | |
| Passkey and webhook *names/URLs*, for reference | [Security activity](../using/sign-in-and-security.md#security-activity) (it's about this server's sign-ins and devices, and an import shouldn't be able to write one) |

Photos are never in this JSON export. They back up as a separate zip: **Activities → Photos → Download all (zip)**, and come back with **Import zip** on the same page. See [Photos](../using/photos.md#backing-up-and-moving-photos).

API: `GET /api/export`.

The file contains ICS feed URLs, which can be secret. Treat it like a password.

## Import from a Kinwall export

**Import from a Kinwall export** asks for the file, shows what it contains ("Merges 4 members, 12 chores, … into this family. Existing items with the same ids are updated.") and waits for **Import**.

* **Merge by ID**: importing the same file twice changes nothing more (idempotent). Items already here with the same ID are updated. Nothing else is deleted.
* **Settings** go through the normal settings validation. Keys this version doesn't know are ignored.
* **Local calendars** come back complete.
* **ICS calendars** come back connected if their URL is in the file and passes the [private-address check](../calendars/private-feeds.md).
* **Google, Outlook and CalDAV calendars** come back as placeholders that keep their settings and tags. [Reconnect](../calendars/reconnecting-after-import.md) each one once.
* **Members** from a file made before the **Grown-up** setting count as grown-ups when their birthday has a year making them 18 or older.
* **Passkeys and webhooks** are skipped. Set them up again.
* **Health entries**, Temp check sleep, feelings, goal checks, battery check-ins and own-feelings lists, journal entries and medications are encrypted again as they're saved. A private journal entry already on the server is never overwritten, and a private day keeps its goal check notes. A private entry that isn't there comes back with its mood and day but no words (the file doesn't have them). Without an `ENCRYPTION_KEY` on the server, an import with health entries is refused and nothing is changed.
* Maximum file size: 10 MB.

API: `POST /api/import` with the export JSON as the body.

## Moving to another server

1. On the old instance, **Download export**.
2. Deploy the new instance and complete the [setup wizard](../getting-started/setup-wizard.md).
3. **Import from a Kinwall export**. For photos, also **Download all (zip)** on the old instance and **Import zip** on the new one.
4. Reconnect Google, Outlook and CalDAV accounts, then add a passkey and recovery codes.

If you're moving between Docker hosts, copying the whole `/data` directory also works and keeps *everything*. See [Backups](backups.md).
