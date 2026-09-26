# Sync behavior & intervals

## What gets synced

Each synced calendar keeps events from **30 days back to 365 days ahead**. Sync replaces that calendar's events in one atomic batch. Kinwall-only annotations (members, categories, travel time) are stored separately and re-applied. See [Writable vs read-only](writable-vs-read-only.md).

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
* **Sync now** does a full-window sync in one request. On the Workers free tier, a big feed can exceed the CPU budget there even though the cron handles it fine.

## Status and errors

Each calendar row in **Settings → Calendars** shows "Synced *time*", "Never synced", "Local calendar", or the **last error** (with secrets redacted). A failed sync keeps the previous events. Each sync fires a `calendar.synced` [webhook](../integrations/webhooks.md) (with `error` on failure) and `events.changed`.

Turn **Enabled** off in the calendar's **Edit calendar** sheet to stop syncing and hide its events without removing it.

## Live updates in the UI

The apps poll `GET /api/rev` every 15 seconds and when they come back into view. The number goes up on every write, including syncs, and the apps then refetch.
