# Kinwall — v1 Spec

> Product name **Kinwall**. Home Assistant integration + add-on live in a separate repo: `JohnDuprey/kinwall-homeassistant`.

Self-hosted, open-source family wall calendar + chore chart, displayed full-screen on a wall-mounted iPad (Safari "Add to Home Screen"). **One codebase, two deploy targets**: Cloudflare Workers free tier (Workers + D1 + Cron Triggers + Static Assets) *and* a Docker container (Node 24 + built-in SQLite) for LAN self-hosting. **API-first**: the touch UI is just another API client, so everything it can do, automation (Home Assistant, n8n, Power Automate, Zapier, scripts) can do too.

## Scope

**In v1**
- Family members (name, color, avatar emoji/initial) — the color drives everything, Skylight-style.
- Calendars: `local`, `ics` (read-only URL subscription — works for Google "secret iCal address", Outlook "published calendar", iCloud public calendar), `google` (OAuth, two-way), `microsoft` (OAuth / Graph, two-way), `caldav` (iCloud / Fastmail / Nextcloud via app-specific password, two-way).
- Events: merged view across calendars, create/edit/delete (write-through to the provider).
- Chores: recurring or one-off, assigned to a member or anyone, points, complete/uncomplete per day.
- Lists: shopping / todo / reusable, grouped by store or category, items remember where they go, bulk add, reorder, clear-completed, reset (for reusable lists).
- API keys (bearer), OpenAPI docs at `/docs`, near-live updates via a cheap revision poll, outbound webhooks (HMAC-signed).
- Touch UI: Calendar (day / week / month / schedule), Chores, Settings.

**Later release**: native iPad wrapper app (SwiftUI + WKWebView) to hide the status bar / home indicator and keep the key in the Keychain — needs an Apple developer account for distribution.

**Out of v1** (add when asked): meal planning, photo frame, weather, rewards shop, multi-household, webhook retries, SSE/live-updates (would need Durable Objects on Workers; `/api/rev` polling covers it for now), editing a single occurrence of a *local* recurring event.

## Tech (fixed — don't swap)

| Concern | Choice | Why |
|---|---|---|
| HTTP | **Hono** + `@hono/zod-openapi` + `zod` + `@hono/swagger-ui` | same app runs on Workers and Node; OpenAPI from route schemas |
| Workers target | `server/src/worker.ts` → `export default { fetch, scheduled }`, root `wrangler.toml` (builds the UI via `[build]`, D1 binding `DB` auto-provisioned), cron `*/10 * * * *`, static assets from `../web/dist` (SPA fallback) | free tier |
| Node target | `server/src/node.ts` → `@hono/node-server` + `serveStatic` for `web/dist`, `setInterval` sync loop, `node:sqlite` wrapped by `server/src/d1-sqlite.ts` which implements the **D1 API subset** (`prepare().bind().all()/first()/run()`, `batch()`) | app code only ever sees `D1Database` |
| Migrations | `server/migrations/NNNN_name.sql` — applied at runtime on both targets, tracked in `_migrations`: the Node entry on boot, the Worker on its first request/cron per isolate (`server/src/migrate.ts`, files bundled via `server/src/worker-migrations.ts`) | one set of SQL |
| TS | Node runs `.ts` directly (native type stripping); wrangler bundles with esbuild. Rules: `import ... from './x.ts'` (with extension), `import type` for types, **no enums, no namespaces, no constructor parameter properties**. `tsc --noEmit` for typecheck | no build step for server |
| Runtime APIs | **Workers-compatible only** in shared code: `fetch`, Web Crypto (`crypto.subtle`, `crypto.randomUUID`), `Intl`. No `fs`, `node:crypto`, `process` outside `node.ts`/`d1-sqlite.ts`. Config comes from Hono `c.env` (Node entry passes `process.env` + adapted DB as env) | |
| Background work | `waitUntil` helper: `c.executionCtx.waitUntil` when present, else fire-and-forget | webhooks |
| ICS | `ical.js` (pure JS, has recurrence expansion) | runs on Workers |
| CalDAV | `tsdav` | |
| Google / Microsoft | plain `fetch` against REST (Calendar v3 / Graph v1.0) | no SDKs |
| Recurrence (local events/chores) | `rrule` | |
| Tests | `node:test` + `node:assert` against `app.request()` with the sqlite adapter | no framework |
| Web | Vite + React 18 + TypeScript, `date-fns`, plain CSS with custom properties | no UI kit, no state lib |

**Workers free-tier ceiling**: 10 ms CPU per request/cron (network wait doesn't count), 100k requests/day. Keep sync CPU-light (one calendar per cron tick if needed — pick the stalest). Heavy ICS feeds may need Workers Paid ($5/mo, 30 s CPU); document it.

## Layout

```
server/
  wrangler.toml
  migrations/0001_init.sql
  src/
    app.ts              createApp(): Hono app, auth middleware, routes, /docs, /openapi.json
    entry.ts            createKinwall(env): the one host seam (fetch + scheduled), see "Embedding the server"
    db.ts               KinwallDb: the subset of D1Database the app uses
    worker.ts           Workers entry, thin wrapper over entry.ts (lazy migrations, cron -> scheduled)
    node.ts             Node entry (migrations, serve, static, interval) over entry.ts
    d1-sqlite.ts        node:sqlite -> KinwallDb adapter
    env.ts              Env type (DB + config vars), helpers
    auth.ts             sha256 key hashing (Web Crypto), bootstrap key
    bus.ts              emit(c, type, data): bump revision + fire webhooks
    mcp.ts              handleMcp(c, app): MCP Streamable HTTP endpoint, tools call the REST routes via app.request()
    recurrence.ts       expand(rrule, dtstart, from, to, tz)
    sync.ts             syncCalendar(env, id), syncDue(env)
    routes/*.ts         one file per resource
    providers/
      types.ts          Provider contract (exists — don't change without reason)
      index.ts          getProvider(kind)
      ics.ts google.ts microsoft.ts caldav.ts
  test/*.test.ts
web/                    Vite app; build output web/dist served by both targets at /
Dockerfile, docker-compose.yml, README.md
```

## Embedding the server

`server/src/entry.ts` is the only way the server is hosted; `worker.ts` and `node.ts` are thin
wrappers over it, and another host (e.g. one Durable Object per household, consuming this repo as a
submodule) uses it the same way:

```ts
import { createKinwall } from './server/src/entry.ts';
import { MIGRATIONS } from './server/src/worker-migrations.ts'; // bundler must load .sql as text
const kinwall = createKinwall(env, { migrations: MIGRATIONS }); // env: Env, env.DB: KinwallDb
await kinwall.fetch(request, ctx?);  // Response
await kinwall.scheduled(now?, ctx?); // one cron tick: syncDue + runNotifications
```

- Create one per database and keep it: `migrations` are applied lazily before the first
  `fetch`/`scheduled` and memoised (retried on the next call if they fail). Omit `migrations` if the
  host migrates first (Node does, from the fs). `runMigrations(db, migrations)` is also exported.
- `fetch` serves the API only (`/api/*`, `/mcp`, `/oauth/*`, `/.well-known/*`, `/docs`,
  `/openapi.json`); everything else is a plain 404. Static web/dist serving is the host's job
  (Workers: the `[assets]` binding in front of the worker; Node: `serveStatic` on `kinwall.app`).
- `ctx` (anything with `waitUntil`) is optional: without it, background work (webhook delivery,
  sync-after-write) runs fire-and-forget with errors logged.
- `Env` is plain data (`server/src/env.ts`): the app never reads `process.env`, so the host builds
  it. `ENCRYPTION_KEY` is required for anything that stores secrets.
- A host acting on a family's behalf (restore, migration, deletion notice) logs it with
  `recordHostEvent(env.DB, action, detail?)`; the family sees it under Settings → Access →
  Hosting activity (`GET /api/host-events`). Kinwall itself never writes these. `HOST_PORTAL_URL`
  adds a "Manage or delete this family" link to the host's own page (surfaced via `/api/me`).
- Shared OAuth apps: set `GOOGLE_*`/`MS_*` plus `OAUTH_REDIRECT_URI` (one URI on the host's domain,
  registered once with Google/Microsoft). For env-sourced credentials, `/api/oauth/{kind}/start`
  then sends that `redirect_uri` and a `state` of `<hostLabel>.<kind>.<random>` (hostLabel = first
  DNS label of the request's Host, i.e. the family slug on `slug.host.example`; random is a UUID,
  no dots). The host's callback splits `state` on its first two dots to pick the family and kind,
  then forwards the full query string (`code`, `state`, or `error`) unchanged to that family's
  `GET /api/oauth/{kind}/callback` and returns its response as-is (a 302 to
  `PUBLIC_URL/#/settings?account=…`, or a 400 JSON error). The instance validates the full
  `state` against its single-use stored row and repeats the same `redirect_uri` in the token
  exchange. A household that configured its own app keeps its per-instance redirect URI.

`KinwallDb` (`server/src/db.ts`) is all the app calls on `env.DB`. Results may be sync or async.

```ts
interface KinwallStatement {
  bind(...values: unknown[]): KinwallStatement;
  first<T>(): Awaitable<T | null>;
  all<T>(): Awaitable<{ results: T[] }>;
  run(): Awaitable<{ meta: { changes: number } }>;
}
interface KinwallDb {
  prepare(sql: string): KinwallStatement;
  batch<T>(statements: KinwallStatement[]): Awaitable<{ results: T[] }[]>;
}
```

An adapter must guarantee:

- SQLite dialect, positional `?` params; `bind()` returns a bound statement (the app always binds
  a fresh `prepare()`, once). Bound values are strings, numbers and null.
- Rows are plain objects keyed by column name/alias; INTEGER columns come back as JS `number`
  (not `bigint`). `first()` is the first row or `null`; `first(column)` is never used.
- `run().meta.changes` is the affected row count: routes 404 when it is 0, and list bulk
  deletes/resets return it. `last_row_id` is never read (ids are app-generated TEXT).
- `batch()` runs its statements in order in one transaction, all-or-nothing, and returns one
  `{ results }` per statement (rows for a SELECT). Migrations depend on this: each file is one
  batch, and the first call reads the SELECT result of a `CREATE TABLE IF NOT EXISTS` +
  `SELECT` batch. Per-statement `changes` from a batch are never read.
- Foreign keys enforced (`ON DELETE CASCADE` is relied on). D1 and DO SQLite do this by default;
  node:sqlite needs `PRAGMA foreign_keys = ON` (d1-sqlite.ts sets it).
- Note for a Durable Object adapter: `ctx.storage.sql.exec` can't run `BEGIN`/`COMMIT`, so implement
  `batch` with `ctx.storage.transactionSync`, and build `{ results }` from the cursor's `toArray()`.
  `meta.changes` must be the affected row count - check that `cursor.rowsWritten` matches it (it may
  also count index writes); `SELECT changes()` right after the statement is the safe fallback.

## Config (env)

Workers: `[vars]` in wrangler.toml + `wrangler secret put` for secrets. Node: process env. `PORT` (8080, Node only), `DATA_DIR` (./data, Node only), `PUBLIC_URL` (e.g. `https://cal.home.example` — used for OAuth redirects), `ADMIN_API_KEY` (optional bootstrap key; if unset and no keys exist, generate one and log it once), `SYNC_INTERVAL_MINUTES` (10; Workers uses the cron instead), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (`common`), `OAUTH_REDIRECT_URI` (shared-app hosts, see "Embedding the server").

`PUBLIC_URL` and the Google/Microsoft OAuth credentials can also be configured from the UI
(Settings → Calendars → Calendar providers, admin only — see `GET/PUT/DELETE /api/providers*` below), stored
as `settings` rows (client secrets AES-256-GCM encrypted, AAD = the settings key). One resolver,
`providerEnv(env, db)` in `server/src/providers/config.ts` (plus its `effectivePublicUrl`), merges
the two everywhere a provider credential or `PUBLIC_URL` is read (start, callback, token refresh,
setup flags): `PUBLIC_URL` env wins; a provider's household-configured app (client id stored) wins
as a unit, else its env vars — a multi-tenant host's shared app. `PUT`/`DELETE` on a provider that
only env configures (or on an env `PUBLIC_URL`) returns 409 — the UI shows "Provided by your host".

## Data model (SQLite)

All ids are text (`crypto.randomUUID()`). Timestamps are ISO 8601 strings. Timed events stored in UTC ISO (`2026-09-24T14:00:00.000Z`); all-day events stored as `YYYY-MM-DD` dates with `end` exclusive.

```
settings(key PK, value)                       -- familyName, timezone, weekStart (0|1), theme, rev
members(id, name, color, avatar, sort, created_at)
accounts(id, kind  'google'|'microsoft'|'caldav', name, config JSON, created_at)
       -- config holds tokens / creds; NEVER returned by the API
calendars(id, kind 'local'|'ics'|'google'|'microsoft'|'caldav', account_id NULL, remote_id NULL,
          name, color NULL, member_id NULL, category_id NULL, config JSON, writable INT, enabled INT,
          last_synced_at NULL, last_error NULL)
          -- ics: config.url. remote_id = provider calendar id / caldav URL
          -- category_id = default category for events on this calendar with no override/keyword match
events(id, calendar_id, external_id NULL, title, start, end, all_day INT, location, description,
       rrule NULL, member_ids JSON '[]', category_id NULL, reminders JSON NULL, updated_at)
       -- remote kinds: rows are already-expanded instances replaced wholesale on each sync
       -- local kind: one row per series; rrule expanded at query time
       -- category_id is read only for local-kind rows; synced-kind category comes from the override tables below
       -- reminders = minutes-before array from the provider (Google popup / Graph / ICS VALARM), or
       -- set directly for local events; NULL = none known, falls back to settings.defaultReminderMinutes
       -- (30 when unset); '[]' = explicitly none (turned off on the event), never takes the default.
       -- API: events return `reminders` (in effect) + `reminderSource` ('event' | 'default' | null);
       -- PATCH `reminders` writes through to Google (popup overrides; null = calendar default) and
       -- Outlook (single reminder); CalDAV/ICS reminders are read-only.
categories(id, name, emoji NULL, color, keywords JSON '[]', sort, created_at)
       -- color overrides the assigned member's color; keywords = literal phrases, case-insensitive
       -- whole-word/phrase match against an event title, computed at read time (not stored)
event_category_overrides(calendar_id, external_id, category_id, updated_at, PK(calendar_id, external_id))
event_series_category_overrides(calendar_id, series_id, category_id, updated_at, PK(calendar_id, series_id))
       -- per-occurrence / per-series category override for synced events, keyed the same way (and
       -- for the same reason - deterministic ids survive re-sync) as the member-tag override tables
chores(id, title, emoji, member_id NULL, points INT, rrule NULL, due_date NULL, due_time NULL,
       active INT, sort, created_at)
       -- rrule NULL + due_date => one-off. rrule e.g. 'FREQ=DAILY' or 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
chore_completions(id, chore_id, date 'YYYY-MM-DD', member_id NULL, completed_at, UNIQUE(chore_id, date))
lists(id, name, emoji NULL, color NULL, kind 'todo'|'shopping'|'reusable', member_ids JSON '[]',
      group_by 'store'|'category'|'none', sort, archived INT, created_at)
list_items(id, list_id, title, notes NULL, quantity NULL, store NULL, category NULL, member_id NULL,
           due_date NULL, done INT, done_at NULL, done_by NULL, sort, created_at, updated_at)
list_groups(list_id, kind 'store'|'category', name, sort, PK(list_id, kind, name))
       -- user ordering of a list's store/category groups; not every store/category needs a row
api_keys(id, name, hash, prefix, scope 'admin'|'display', created_at, last_used_at)     -- sha256 of key; key shown once
webhooks(id, url, events JSON, secret, enabled, created_at)
pairings(id, code, poll_token_hash, approved, key_id, key_name, encrypted_key, created_at, expires_at)
       -- short-lived display-pairing rows; encrypted_key is AES-256-GCM (AAD = id), deleted once the display polls it
push_subscriptions(id, api_key_id NULL, endpoint UNIQUE, p256dh, auth, device_name, member_ids JSON '[]',
       prefs JSON, created_at, last_success_at NULL)
       -- one row per device; endpoint/p256dh/auth are the browser's PushSubscription, never returned by the API
       -- prefs = {eventReminders, dailySummary, summaryTime, choreNudge, choreNudgeTime, listUpdates}
sent_notifications(key PK, sent_at)   -- dedupe rows (rem:<sub>:<event>:<occurrence>:<minutes>, sum:<sub>:<date>, ...); pruned after ~3 days
```

## API (`/api`, JSON, `Authorization: Bearer <key>`)

Every route declares a zod-openapi schema with `tags` and `summary` so `/docs` is useful. Errors: `{ error: string }` with proper status.

```
GET    /api/health                                   (no auth) {ok} — deliberately no version (fingerprinting)
GET    /api/settings            PATCH /api/settings

GET    /api/members             POST /api/members
PATCH  /api/members/:id         DELETE /api/members/:id
         member response includes pointsToday, pointsWeek

GET    /api/providers            -> { publicUrl: {value, source}, redirectUris: {google, microsoft},
         google: {configured, source: 'env'|'ui'|null, clientId, secretSet}, microsoft: {...+tenant} }
         (admin only; secrets never returned)
PUT    /api/providers/:kind      {clientId, clientSecret?, tenant?}   (omit clientSecret to keep it; 409 if env-configured)
DELETE /api/providers/:kind      (409 if env-configured)
PUT    /api/providers/public-url {value}   (absolute http(s), trailing slash stripped; 409 if PUBLIC_URL env set;
         warns on a bare-IP host or plain http on a non-localhost host)

GET    /api/accounts            DELETE /api/accounts/:id          (config stripped)
GET    /api/oauth/:kind/start?key=  -> 302 to Google/Microsoft consent (kind google|microsoft; key via query since it's a browser nav; state = signed/random value stored in settings with 10-min expiry)
GET    /api/oauth/:kind/callback -> creates account, 302 to /#/settings?account=<id>
POST   /api/accounts/caldav     {name, serverUrl, username, password} -> account
GET    /api/accounts/:id/remote-calendars   -> [{remoteId, name, color, writable}]

GET    /api/calendars           POST /api/calendars   {kind, name, color?, memberId?, categoryId?, accountId?, remoteId?, url?}
PATCH  /api/calendars/:id       DELETE /api/calendars/:id
POST   /api/calendars/:id/sync  -> {ok, count} | 502 {error}

GET    /api/categories          -> Category[] (ordered by sort)
POST   /api/categories          {name, emoji?, color, keywords?, sort?}
PATCH  /api/categories/:id      DELETE /api/categories/:id   (clears every reference: events fall back to the next source)
POST   /api/categories/reorder  {ids} -> sort = index
         Category = {id, name, emoji, color, keywords, sort, createdAt}

GET    /api/events?from&to[&memberId][&calendarId]   -> EventInstance[] (sorted by start)
POST   /api/events              {calendarId, title, start, end, allDay, location?, description?, memberIds?, rrule?, categoryId?}
GET    /api/events/:id          PATCH /api/events/:id     DELETE /api/events/:id
         EventInstance = {id, calendarId, title, start, end, allDay, location, description,
                          memberIds, color, rrule, occurrenceStart, readOnly, categoryId, categorySource}
         memberIds: event.member_ids, else [calendar.member_id], else []
         color: first member's color, else calendar.color, else '#888'
         categoryId/categorySource resolve in order: occurrence override ('event') -> series override
         ('series') -> keyword match against the title, case-insensitive whole-word/phrase ('keyword')
         -> calendar default ('calendar') -> null/null. PATCH .../categoryId accepts string|null (null
         clears the override) with the same `scope: 'occurrence'|'series'` semantics as memberIds.
         writes to remote calendars go through the provider first; failure -> 502, nothing stored

GET    /api/chores              POST /api/chores   PATCH /api/chores/:id   DELETE /api/chores/:id
GET    /api/chores/day?date=YYYY-MM-DD  -> [{...chore, completed, completedAt, completedBy}]
         (chores due that date in the household timezone, grouped client-side by member)
POST   /api/chores/:id/complete   {date, memberId?}      DELETE /api/chores/:id/complete?date=

GET    /api/lists[?archived=true]   POST /api/lists   {name, kind, emoji?, color?, memberIds?, groupBy?}
         List = {..., memberIds, groupBy 'store'|'category'|'none' (default: shopping -> category, else none),
                 sort, archived, itemCount, openCount}   -- archived excluded unless archived=true
GET    /api/lists/:id   -> {list, items, groups, suggestions: {stores, categories}}   (suggestions = distinct
         non-null store/category values across all list_items, household-wide)
PATCH  /api/lists/:id       DELETE /api/lists/:id   (cascades items + groups)
POST   /api/lists/:id/items   body: ItemInput | ItemInput[] -> 201 ListItem[] (always an array)
         "Remembers where things go": store/category omitted (not explicit null) -> filled from the
         most recently updated list_item (any list) with a matching lower(trim(title))
PATCH  /api/lists/:id/items/:itemId   partial; done:true sets doneAt/doneBy, done:false clears both
DELETE /api/lists/:id/items/:itemId
POST   /api/lists/:id/clear-completed -> {deleted}     POST /api/lists/:id/reset -> {reset}
POST   /api/lists/:id/reorder   {itemIds} -> sort = index      PUT /api/lists/:id/groups   {groups} -> replaces ordering

GET    /api/leaderboard?period=today|week|month   (default week; household timezone, week respects settings.weekStart)
         -> [{memberId, name, color, avatar, points, completed, streak, rank}]
         sorted by points desc, then completed desc, then name; rank ties on equal points+completed.
         Members with zero activity still appear. streak = consecutive days, ending today (today
         only counts once its assigned chores are already complete), on which every chore assigned
         to the member and due that day was completed; days with nothing due are skipped, not
         broken; looks back at most 60 days. Read-only, no new bus event.

GET    /api/keys   POST /api/keys {name} -> {id, name, key}   DELETE /api/keys/:id

POST   /api/pair                        (no auth) -> {pairingId, code, pollToken, expiresAt}
POST   /api/pair/approve  {code, name}  (admin only) -> {keyId, name}   404 if code unknown/expired
POST   /api/pair/poll     {pairingId, pollToken}   (no auth) -> {status:'pending'} | {status:'approved', key} (once)
GET    /api/webhooks   POST /api/webhooks {url, events[], secret?}   PATCH/DELETE /api/webhooks/:id

GET    /api/rev                 -> {rev}  (integer bumped on every write; UI polls every 15s and refetches on change)

GET    /api/push/vapid-public-key   -> {publicKey}
POST   /api/push/subscriptions   {subscription: PushSubscriptionJSON, deviceName, memberIds?, prefs?} -> upsert by endpoint
PATCH  /api/push/subscriptions/:id  {deviceName?, memberIds?, prefs?}      DELETE /api/push/subscriptions/:id
         a key may only touch subscriptions it created, unless admin
GET    /api/push/subscriptions   (admin: every device; display: only its own; endpoint/keys never returned)
POST   /api/push/test/:id        -> {ok}   (sends a test push to that device)
POST   /api/notify   (admin only)   {title, body, memberIds?, url?} -> {ok, sent}
         sends now to every device following any of memberIds (device with no memberIds follows everyone;
         omitting memberIds targets every device)
```

## MCP (`/mcp`)

`POST/GET/DELETE /mcp` - MCP **Streamable HTTP** transport, stateless (no sessions/Durable Objects), same bearer keys as the REST API, or OAuth 2.1 access tokens (401 + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` without one).

**OAuth** (`server/src/routes/mcp-oauth.ts`, migration 0014): Kinwall is its own authorization server per the MCP authorization spec - RFC 9728 protected-resource and RFC 8414 server metadata, RFC 7591 open dynamic registration (https or loopback-http redirect URIs, exact match; unapproved registrations pruned after a day), authorization code with **PKCE S256 only**, public clients. `/oauth/authorize` validates client + redirect (errors shown, never redirected to an unregistered URI) and hands off to the SPA consent screen `#/authorize`, where a signed-in admin (passkey session or API key - never an OAuth token) approves *Full* (`kinwall:admin`) or *Everyday* (`kinwall:display`) access via `POST /api/authorizations/approve`. Codes live 5 min, single use; a replayed code revokes what it produced. Access tokens are `api_keys` rows (`kind='oauth'`, 1 h, linked to an `oauth_grants` row) so REST/MCP auth is unchanged; refresh tokens (90 days) rotate on every use and a reused one revokes the whole grant. `POST /oauth/revoke` (RFC 7009), `GET/DELETE /api/authorizations` for Settings → Access → Connected apps. All secrets stored as sha256 hashes. Implemented with `@modelcontextprotocol/sdk`'s `WebStandardStreamableHTTPServerTransport` (Web Standards - Request/Response/ReadableStream, no `node:*`; runs on Workers and Node unchanged). See `server/src/mcp.ts`.

Every tool is a thin wrapper that calls the REST routes above in-process via `app.request()`, forwarding the caller's `Authorization` header - so validation, scope enforcement (display vs admin), bus events/webhooks and rev bumps happen exactly as for REST. A REST 4xx/5xx becomes a tool result with `isError: true` and the route's `{error}` text. Tools: `get_household`, `list_events`, `create_event`, `update_event`, `delete_event`, `list_chores`, `complete_chore`, `uncomplete_chore`, `create_chore`, `get_leaderboard`, `add_member`, `list_lists`, `create_list`, `update_list`, `get_list`, `add_list_items`, `update_list_item`, `set_list_item_done`, `list_categories`, `set_event_category`, `send_notification`. Members may be referenced by name in tool args (resolved case-insensitively to id in the tool layer; ambiguous -> error listing matches); lists and categories likewise by name in `get_list`/`add_list_items` and `set_event_category`.

Bus event types (webhooks; every emit also bumps `rev`): `member.changed`, `calendar.changed`, `calendar.synced`, `events.changed`, `chore.changed`, `chore.completed`, `chore.uncompleted`, `list.changed`, `list.item.changed`, `category.changed`, `settings.changed`, `display.paired`. Webhook POST body `{type, data, at}`, header `X-Kinwall-Signature: sha256=<hex hmac of body>`; sent via `waitUntil`, 5s timeout, no retries.

## Provider contract (`server/src/providers/types.ts`)

Defined in **`server/src/providers/types.ts`** (source of truth). OAuth helpers take `env` as first arg.

Sync window: now − 30 days → now + 365 days. `syncCalendar` replaces all events of that calendar in one `db.batch()` (atomic on D1 and in the adapter), sets `last_synced_at`/`last_error`, emits `calendar.synced` + `events.changed`. `syncDue(env)` syncs enabled non-local calendars whose `last_synced_at` is older than the interval, stalest first, stopping after ~20 s wall time (Workers cron) — called by the cron on Workers and by `setInterval` on Node.

## Notifications (Web Push)

Standard Web Push - RFC 8291 payload encryption (`aes128gcm`) + RFC 8292 VAPID auth, both via Web
Crypto (no `web-push` npm package - it's Node-only and this needs to run on the Workers free tier).
See `server/src/webpush.ts` (crypto + send), `server/src/notify.ts` (scheduling), `server/src/routes/push.ts` (API).

VAPID keys are generated once on first need and stored in `settings` (private key encrypted at rest
the same way as `accounts.config`); `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env vars
override. `runNotifications(env, now)` runs from the Workers cron (every 5 min) and a Node
`setInterval` (~2 min), independent of `SYNC_INTERVAL_MINUTES`:

- **Event reminders**: for each event occurrence (recurring local events expanded the same way as
  `GET /api/events`) whose reminder fire time (`start - minutes`, or start-of-day-in-household-tz
  minus minutes for an all-day event) falls in `(now - 10min, now]`, notify every subscription with
  `eventReminders` on and a matching `memberIds` follow-list, deduped via `sent_notifications`.
- **Daily summary** at each subscription's `prefs.summaryTime` (household tz): event/chore counts.
- **Chore nudge** at `prefs.choreNudgeTime`: incomplete chores due today, for followed members.
- **List updates** (default off): fired inline from `POST /api/lists/:id/items` (not the periodic
  tick), debounced to one notification per list per 10 minutes.

`Notification.requestPermission()` must run from a user tap; `web/public/sw.js` handles `push` and
`notificationclick` and deliberately has **no fetch handler and caches nothing** (the app relies on
network + `Cache-Control`, not a caching SW). iPhone needs iOS 16.4+ and the app added to the Home
Screen first — Safari tabs can't receive push at all.

## Security

**Encryption at rest**: `accounts.config`, `calendars.config`, `webhooks.secret` are AES-256-GCM encrypted (Web Crypto) with `ENCRYPTION_KEY` (32 random bytes, base64). Stored as `v1:<iv b64>:<ciphertext b64>`; the row id is the AAD so blobs can't be swapped between rows. Key source: Workers secret; Docker `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE`, else generated once into `$DATA_DIR/encryption.key` (0600) with a startup warning.

**Key scopes**: `admin` = everything. `display` = GET on me/members/calendars (config-free)/events/chores/leaderboard/settings/rev, settings PATCH, member update, event create/update/delete, chore create/update/delete/complete/uncomplete, and all of `/api/lists*` (lists are display-safe end to end - create/update/delete a list, its items, clear-completed, reset, reorder, groups). `display` can NOT touch accounts, oauth, keys, webhooks, passkeys, displays, calendar create/delete, or member create/delete. Wall iPad uses a display key; its Settings tab shows Household, Appearance, This display (paired-as, nav position, unpair) and Members (edit only) — admin sections (calendar accounts, displays, passkeys, API keys, webhooks) don't render at all. The setup wizard's display-role flow and the phone `#/pair?code=` approval screen still use a temporary in-memory/sessionStorage admin key to finish setup/pairing. `ADMIN_API_KEY` env is admin.

**OAuth**: PKCE + single-use state; Google scopes `calendar.events calendar.readonly openid email` (not full `calendar`); revoke Google token on account delete.

**Untrusted content**: event titles/descriptions from providers render as text only (never HTML). Server sends `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://images.metmuseum.org https://picsum.photos https://fastly.picsum.photos; connect-src 'self' https://collectionapi.metmuseum.org; frame-ancestors 'self'` (HA ingress frames it). Never log tokens/keys; redact secrets from `last_error`.

**Exposure**

- Every `/api/*` route except `/api/health` and `/api/oauth/:kind/callback` requires a valid key; compare hashes, never plaintext.
- Account/calendar `config` (tokens, passwords, ICS URLs with secrets) is never returned by the API.
- OAuth `state` is single-use and expires; redirect URI is `PUBLIC_URL` + fixed path, or `OAUTH_REDIRECT_URI` for env (host-shared) credentials.
- CORS: off by default (same origin); `CORS_ORIGINS` env to allow automation from browsers.
- README recommends Cloudflare Access (free ≤ 50 users) in front of the UI as a second layer, with a service-token bypass for `/api/*`.

## Touch UI (Skylight-like)

Target: iPad landscape (1180×820 and 1024×768) first, portrait must work. Safari/WebKit only matters.

- **Look**: white/very light warm background, big rounded cards (16–20px radius), soft shadows, pastel member colors, friendly rounded sans (Nunito via Google Fonts, fallback system-ui). Events are colored rounded chips tinted by member color. Dark theme via `settings.theme` for night.
- **Header**: family name, large clock + date, member avatar row (tap opens that member's day/week snapshot, which holds the "show only them" calendar filter).
- **Bottom tab bar**: Calendar · Chores · Settings. Big icons + labels.
- **Calendar**: Week (default, 7 columns with all-day row + timed events; a 3-day window on phones), Day (time grid, a column per member), Month (grid with dots/chips), Schedule (agenda list). Segmented control to switch. Swipe left/right to page, "Today" button. Tap event → bottom sheet with details / Edit / Delete (hidden when readOnly). Floating "+" and tap-on-empty-slot → add sheet prefilled with that time.
- **Add/Edit sheet**: large inputs, native `<input type="date|time">`, all-day toggle, calendar picker (writable only), member avatars as toggle chips, repeat (none/daily/weekly/monthly).
- **Chores**: one column per member (+ "Anyone"), avatar + progress ring at top, chore cards (emoji, title, points). Tap = complete with a satisfying check + small confetti burst; tap again = undo. Date strip to look at other days. "+" to add; long-press (500ms) to edit.
- **Settings**: family name / timezone / week start / theme; members (add/edit color from a fixed pastel palette + emoji); calendars (add ICS URL, "Connect Google", "Connect Outlook", CalDAV form → pick remote calendars → assign member + color; sync now; last error shown); API keys (create shows key once); webhooks.
- **Kiosk behavior**: ≥ 48px touch targets (prefer 56+), no hover-only affordances, `touch-action: manipulation`, disable text selection & callouts & pinch zoom, no scroll bounce on the shell, pointer events for swipe (no gesture lib). Idle 2 min → return to today's calendar and close sheets. Near-live updates: poll `/api/rev` every 15 s (and on `visibilitychange`), refetch on change. PWA manifest + `apple-mobile-web-app-capable` so it runs full-screen from the home screen.
- **Auth on the display**: first visit `/?key=...` stores key in localStorage and strips it from the URL; no key → simple "paste API key" screen.
