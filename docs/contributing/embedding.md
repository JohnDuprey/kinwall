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
* **`fetch` serves the API only** (`/api/*`, `/mcp`, `/oauth/*`, `/.well-known/*`, `/plugins/*`, `/r/*`, `/docs`, `/openapi.json`). A host must route `/plugins/*` and `/r/*` (shared recipe pages and their photos) to it unchanged: both carry their own CSP, which the host mustn't replace. Everything else is a plain 404. Serving `web/dist` is the host's job.
* **`ctx`** is anything with `waitUntil`, and it's optional. Without it, background work (webhooks) runs fire-and-forget with logged errors.
* **`Env` is plain data** (`server/src/env.ts`). The app never reads `process.env`. `ENCRYPTION_KEY` is required for anything that stores secrets or health entries; `createKinwall` also encrypts any older plaintext health entries once per instance, before its first request. See [Configuration](../self-hosting/configuration.md).

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
3. The host's callback splits `state` on its first two dots to pick the family and kind. It redirects the browser (302) to that family's `GET /api/oauth/{kind}/callback` on the family's own host, with the full query string unchanged. It must be a redirect, not a server-side forward: Kinwall gives the browser that starts a sign-in a short-lived cookie on the family's host and finishes only for a request that carries it, so the browser has to make that request itself. Anyone can write `state`, so build the redirect's host only from a label you know as a family.
4. The instance validates the full `state` against its single-use stored row and repeats the same `redirect_uri` in the token exchange.

Starting a sign-in is `POST /api/oauth/{kind}/start` with the family's key in the `Authorization` header (it returns `{ url }`), so a link can't start one in someone else's browser. A callback without the flow's cookie answers with a page whose **Open in the Kinwall app** link (`family.kinwall.app:/provider-return?kind&state&code`) lets the phone app finish the sign-in in its own web view, on its own family's address.

Rolling this out on an existing host, in this order:

1. The host's callback redirects the browser (step 3) instead of forwarding. This works with Kinwall versions before and after the cookie check.
2. The Kinwall phone app with the provider hand-back (`family.kinwall.app:/provider-return`) ships to the stores and most people update.
3. The instances move to the Kinwall version that checks the cookie and starts with `POST`. An older app's web view then says to update the app or connect from a web browser, instead of failing at the end.

A household that configures its own app in the UI keeps its per-instance redirect URI.

## Apple push

The iPhone app's Live Activities use Apple push (`APNS_*`, see [Configuration](../self-hosting/configuration.md#live-activities-apple-push)). Apple only accepts HTTP/2. On Workers the default is a plain `fetch`, which works on a deployed Worker (Cloudflare's edge speaks HTTP/2 to Apple) but not in local `wrangler dev` on macOS. The Node entry point passes its HTTP/2 sender (`server/src/apns-node.ts`), since Node's `fetch` is HTTP/1.1.

`APNS_SEND` in `env` is optional and overrides the default: `(req: { host, path, headers, body }) => Promise<{ status, reason? }>`, sending one POST however the host likes (a relay, say). Kinwall builds the request, including its signed token, and handles Apple's answer the same way either way (410, `BadDeviceToken` or `Unregistered` drops the token).
