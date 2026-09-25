# Export & import

**Settings → Access → Your data** (admin only).

## Download export

**Download export** saves `kinwall-export-YYYY-MM-DD.json` with everything your family entered:

| Included | Not included |
|---|---|
| Household settings | Passwords, OAuth tokens, CalDAV logins |
| Members, categories | API keys, sessions, recovery codes |
| Chores **with completion history** (and points awarded) | Webhook secrets |
| Points spent, sticker packs unlocked and sticker book pages | |
| Lists, items, group order | Push subscriptions |
| Local calendars **with their events** (reminders, travel time) | Synced events themselves (they're fetched again) |
| Every synced calendar's name, colour, members and default category | Per-device appearance (it lives in each browser) |
| Per-event member, category and travel-time tags on synced events, and series-wide member and category tags on synced recurring events | |
| Notes threads on local events and list items | Notes on synced events |
| ICS feed URLs | |
| Passkey and webhook *names/URLs*, for reference | |

API: `GET /api/export`.

The file contains ICS feed URLs, which can be secret. Treat it like a password.

## Import from a Kinwall export

**Import from a Kinwall export** asks for the file, shows what it contains ("Merges 4 members, 12 chores, … into this family. Existing items with the same ids are updated.") and waits for **Import**.

* **Merge by ID**: importing the same file twice changes nothing more (idempotent). Items already here with the same ID are updated. Nothing else is deleted.
* **Settings** go through the normal settings validation. Keys this version doesn't know are ignored.
* **Local calendars** come back complete.
* **ICS calendars** come back connected if their URL is in the file and passes the [private-address check](../calendars/private-feeds.md).
* **Google, Outlook and CalDAV calendars** come back as placeholders that keep their settings and tags. [Reconnect](../calendars/reconnecting-after-import.md) each one once.
* **Passkeys and webhooks** are skipped. Set them up again.
* Maximum file size: 10 MB.

API: `POST /api/import` with the export JSON as the body.

## Moving to another server

1. On the old instance, **Download export**.
2. Deploy the new instance and complete the [setup wizard](../getting-started/setup-wizard.md).
3. **Import from a Kinwall export**.
4. Reconnect Google, Outlook and CalDAV accounts, then add a passkey and recovery codes.

If you're moving between Docker hosts, copying the whole `/data` directory also works and keeps *everything*. See [Backups](backups.md).
