# Sync behavior & intervals

## What gets synced

Each synced calendar keeps events from **30 days back to 365 days ahead**. Sync compares what the provider sent with what Kinwall has stored and writes only the difference, in one atomic batch: new events are added, changed ones updated, and ones that are gone removed. Unchanged events aren't touched. Kinwall-only annotations (members, categories, travel time) are stored separately and kept. See [Writable vs read-only](writable-vs-read-only.md).

## When

| Target | Trigger |
|---|---|
| Docker / Node | Every `SYNC_INTERVAL_MINUTES` (default **10**). |
| Cloudflare Workers | A cron every **5 minutes**. Each tick syncs only calendars older than `SYNC_INTERVAL_MINUTES` (default 10 in `wrangler.toml`), so a faster cron doesn't double the work. |
| Manual | **Sync now** on a calendar in **Settings → Calendars**, or `POST /api/calendars/{id}/sync`. |
| Reconnect | Re-attaching an imported calendar, or changing an ICS URL, syncs in the background right away. |

Calendars sync **stalest first**, so a newly added calendar (never synced) goes first on the next tick. A tick stops after about 20 seconds.

## Staying within the free tier

* **Google, Microsoft, CalDAV** sync in **31-day slices**. The near slice (yesterday through the next 31 days) refreshes every tick. The far slices take turns and refresh at most every 6 hours.
* **ICS feeds** are fingerprinted. An unchanged feed is skipped without parsing.
* **Only changes are written.** A tick where nothing changed writes one row (the calendar's "last synced" time and slice position). This matters on hosted Kinwall, where storage is billed per row written.
* **Sync now** does a full-window sync in one request. On the Workers free tier, a big feed can exceed the CPU budget there even though the cron handles it fine.

## Status and errors

Each calendar row in **Settings → Calendars** shows "Synced *time*", "Never synced", "Local calendar", or the **last error** (with secrets redacted). A failed sync keeps the previous events. A sync that changed something fires a `calendar.synced` [webhook](../integrations/webhooks.md) (with `error` on failure), and `events.changed` when any event was added, changed or removed. The automatic background sync stays quiet when nothing changed: no webhook, and a failure that repeats the error already shown isn't sent again. **Sync now** always fires `calendar.synced`.

## When a calendar stops syncing

Most failures pass on their own (Google or Microsoft having a bad minute, a network blip): the next sync tries again, and the Board warns parents only after two failures in a row ("The Work calendar isn't syncing. Repair the connection").

A **revoked sign-in** is different: Google or Microsoft answers the token refresh with `invalid_grant`, meaning Kinwall's access was taken away or expired. Common causes are a parent removing Kinwall in **Family Link** (on a supervised kid's Google account), a password change, removing Kinwall under the account's third-party access, or a Google Cloud app still in Testing (see [Google](google.md#if-every-google-calendar-stops-about-weekly)). Only reconnecting fixes it, so:

* The calendar's row in **Settings → Calendars** says what happened, names the account, and has a **Reconnect** button. A kid's Google calendar also gets the Family Link hint.
* The Board's warning shows at once.
* The grown-ups get one notification, "Maya's calendar stopped syncing. Tap to reconnect it.", in the bell and as a push to parents' phones, never on kids' devices. It waits for the [night hours](../using/night.md) to end. It isn't repeated while the calendar keeps failing; after the calendar syncs again, a new revoked sign-in sends a new one.

Through the API, `GET /api/calendars` gives such a calendar `lastErrorCode: "revoked"` beside `lastError`.

Turn **Enabled** off in the calendar's **Edit calendar** sheet to stop syncing and hide its events without removing it.

## Live updates in the UI

The apps poll `GET /api/rev` every 30 seconds while they're on screen, and as soon as they come back into view; a wall screen keeps polling even when hidden. The number goes up on every write, including syncs that changed events, failed or cleared an error, and the apps then refetch. A sync that found nothing new leaves it alone. The app reloads the family's settings and members only when `revs` says events, chores or settings changed, not after a change to a list.
