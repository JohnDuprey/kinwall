# Embedding the server

Kinwall's server can be hosted by something other than the bundled Worker or Node entry points, for example one Durable Object per household, with this repo as a submodule. The authoritative reference is the "Embedding the server" section of [SPEC.md](../../SPEC.md). This page summarizes it.

```ts
import { createKinwall } from './server/src/entry.ts';
import { MIGRATIONS } from './server/src/worker-migrations.ts'; // bundler must load .sql as text
const kinwall = createKinwall(env, { migrations: MIGRATIONS }); // env: Env, env.DB: KinwallDb
await kinwall.fetch(request, ctx?);  // Response
await kinwall.scheduled(now?, ctx?); // one cron tick: syncDue + runNotifications
```

* **Create one instance per database and keep it.** Migrations are applied lazily before the first `fetch`/`scheduled` and memoised (retried if they fail). Leave out `migrations` if you migrate yourself. `runMigrations(db, migrations)` is exported too.
* **`fetch` serves the API only** (`/api/*`, `/mcp`, `/oauth/*`, `/.well-known/*`, `/docs`, `/openapi.json`). Everything else is a plain 404. Serving `web/dist` is the host's job.
* **`ctx`** is anything with `waitUntil`, and it's optional. Without it, background work (webhooks) runs fire-and-forget with logged errors.
* **`Env` is plain data** (`server/src/env.ts`). The app never reads `process.env`. `ENCRYPTION_KEY` is required for anything that stores secrets. See [Configuration](../self-hosting/configuration.md).

## The database interface

`KinwallDb` (`server/src/db.ts`) is the subset of D1 the app uses: `prepare(sql).bind(...).first() / all() / run()` and `batch([...])`. An adapter must provide:

* SQLite dialect with positional `?` parameters. INTEGER columns come back as `number`.
* `run().meta.changes` must be the affected row count, because routes return 404 when it's 0.
* `batch()` runs its statements in order, in one all-or-nothing transaction, and returns one `{results}` per statement.
* Foreign keys enforced (`ON DELETE CASCADE` is relied on).

For a Durable Object adapter, implement `batch` with `ctx.storage.transactionSync`, and check that `rowsWritten` matches `changes`.

## Host events

When a host acts on a family's behalf (restore, migration, deletion notice), it records it:

```ts
recordHostEvent(env.DB, action, detail?)
```

The family sees these under **Settings → Access → Hosting activity** (`GET /api/host-events`). Kinwall itself never writes them. Set `HOST_PORTAL_URL` to add a "Manage or delete this family" link to the host's own page (exposed through `/api/me`).

## Passkeys across subdomains

Serving families on `slug.host.example`? Set `WEBAUTHN_RP_ID=host.example` so passkeys share one rpID.

## Shared OAuth apps

A host can register **one** Google and **one** Microsoft app for all families:

1. Set `GOOGLE_*` / `MS_*` plus `OAUTH_REDIRECT_URI`, a single URI on the host's domain.
2. For environment credentials, `/api/oauth/{kind}/start` sends that `redirect_uri` and a `state` of `<hostLabel>.<kind>.<random>`. `hostLabel` is the first DNS label of the request's Host (the family slug), and `random` is a UUID with no dots.
3. The host's callback splits `state` on its first two dots to pick the family and kind. It forwards the full query string unchanged to that family's `GET /api/oauth/{kind}/callback` and returns the response as-is (a 302 to `PUBLIC_URL/#/settings?account=…`, or a 400 JSON error).
4. The instance validates the full `state` against its single-use stored row and repeats the same `redirect_uri` in the token exchange.

A household that configures its own app in the UI keeps its per-instance redirect URI.
