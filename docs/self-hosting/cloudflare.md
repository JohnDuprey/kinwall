# Cloudflare specifics

For deployment steps, see [Deploy to Cloudflare Workers](../getting-started/deploy-cloudflare.md). This page covers how Kinwall behaves on Workers.

## Free-tier limits

| Limit | Free tier | How Kinwall fits |
|---|---|---|
| Requests | 100,000 / day | A wall display polling `/api/rev` every 15 s uses about 5,800/day. Phones add more while open. |
| CPU | 10 ms per request or cron run (network wait doesn't count) | Google, Microsoft and CalDAV sync in 31-day slices, and unchanged ICS feeds are skipped by fingerprint. |
| D1 | generous free storage and reads | One small database. |

If a very large ICS feed hits the CPU limit, move to **Workers Paid** ($5/month, 30 s CPU). **Sync now** does a full-window sync in one request, so it's the first thing to hit the limit on a huge feed, even when the cron copes.

## Cron

```toml
[triggers]
crons = ["*/5 * * * *"]
```

Each run does both jobs:

* **Sync**: calendars older than `SYNC_INTERVAL_MINUTES` (default 10), stalest first, stopping after about 20 s.
* **Notifications**: reminders, daily summaries and chore nudges. That's why the cron runs every 5 minutes: reminders shouldn't wait for the slower sync interval.

## Placement

```toml
[placement]
mode = "smart"
```

Smart placement runs the Worker near its D1 database rather than near the visitor. A request that makes several database round trips stays fast. Create the D1 database in the location nearest your family (the setup script guesses it from your timezone). An auto-created database lands near Cloudflare's build servers, and every query then crosses that distance.

## Routing

Static assets (the UI) are served by Cloudflare's asset binding with single-page-app fallback. Only these paths reach the Worker: `/api/*`, `/docs`, `/openapi.json`, `/mcp`, `/oauth/*` and `/.well-known/*`.

## Logs

Worker observability is on. When `ADMIN_API_KEY` isn't set, the first-run setup code appears in the Worker's logs (dashboard, or `npx --prefix server wrangler tail`) on the first visit.

## Custom domains

Set them through `CUSTOM_DOMAIN` / the setup script, not only in the dashboard. Each deploy applies `wrangler.toml` and would remove a dashboard-only domain.

## Extra protection

Cloudflare Access in front of the UI (free for up to 50 users), with a service-token bypass for `/api/*`, adds a second login layer.
