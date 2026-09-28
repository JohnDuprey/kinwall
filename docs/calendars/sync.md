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

Each calendar row in **Settings → Calendars** shows "Synced *time*", "Never synced", "Local calendar", or the **last error** (with secrets redacted). A failed sync keeps the previous events. Each sync fires a `calendar.synced` [webhook](../integrations/webhooks.md) (with `error` on failure), and `events.changed` when any event was added, changed or removed.

Turn **Enabled** off in the calendar's **Edit calendar** sheet to stop syncing and hide its events without removing it.

## Live updates in the UI

The apps poll `GET /api/rev` every 30 seconds and when they come back into view. The number goes up on every write, including syncs that changed events, failed or cleared an error, and the apps then refetch. A sync that found nothing new leaves it alone.
