# Kinwall — v1 Spec

> Product name **Kinwall**. Home Assistant integration + add-on live in a separate repo: `JohnDuprey/kinwall-homeassistant`.

Self-hosted, open-source family wall calendar + chore chart, displayed full-screen on a wall-mounted iPad (Safari "Add to Home Screen"). **One codebase, two deploy targets**: Cloudflare Workers free tier (Workers + D1 + Cron Triggers + Static Assets) *and* a Docker container (Node 24 + built-in SQLite) for LAN self-hosting. **API-first**: the touch UI is just another API client, so everything it can do, automation (Home Assistant, n8n, Power Automate, Zapier, scripts) can do too.

## Scope

**In v1**
- Family members (name, color, avatar emoji/initial) — the color drives everything, Skylight-style.
- Calendars: `local`, `ics` (read-only URL subscription — works for Google "secret iCal address", Outlook "published calendar", iCloud public calendar), `google` (OAuth, two-way), `microsoft` (OAuth / Graph, two-way), `caldav` (iCloud / Fastmail / Nextcloud via app-specific password, two-way).
- Events: merged view across calendars, create/edit/delete (write-through to the provider).
- Chores: recurring or one-off, assigned to a member or anyone, points, complete/uncomplete per day.
- API keys (bearer), OpenAPI docs at `/docs`, near-live updates via a cheap revision poll, outbound webhooks (HMAC-signed).
- Touch UI: Calendar (day / week / month / schedule), Chores, Settings.

**Later release**: native iPad wrapper app (SwiftUI + WKWebView) to hide the status bar / home indicator and keep the key in the Keychain — needs an Apple developer account for distribution.

**Out of v1** (add when asked): meal planning, lists, photo frame, weather, rewards shop, multi-household, webhook retries, SSE/push (would need Durable Objects on Workers), editing a single occurrence of a *local* recurring event.

## Tech (fixed — don't swap)

| Concern | Choice | Why |
|---|---|---|
| HTTP | **Hono** + `@hono/zod-openapi` + `zod` + `@hono/swagger-ui` | same app runs on Workers and Node; OpenAPI from route schemas |
| Workers target | `server/src/worker.ts` → `export default { fetch, scheduled }`, `wrangler.toml` with D1 binding `DB`, cron `*/10 * * * *`, static assets from `../web/dist` (SPA fallback) | free tier |
| Node target | `server/src/node.ts` → `@hono/node-server` + `serveStatic` for `web/dist`, `setInterval` sync loop, `node:sqlite` wrapped by `server/src/d1-sqlite.ts` which implements the **D1 API subset** (`prepare().bind().all()/first()/run()`, `batch()`) | app code only ever sees `D1Database` |
| Migrations | `server/migrations/NNNN_name.sql` — applied by `wrangler d1 migrations apply` on Workers, and by the Node entry on boot (tracks applied files in `_migrations`) | one set of SQL |
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
    worker.ts           Workers entry (fetch + scheduled -> syncDue)
    node.ts             Node entry (migrations, serve, static, interval)
    d1-sqlite.ts        node:sqlite -> D1 API subset adapter
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

## Config (env)

Workers: `[vars]` in wrangler.toml + `wrangler secret put` for secrets. Node: process env. `PORT` (8080, Node only), `DATA_DIR` (./data, Node only), `PUBLIC_URL` (e.g. `https://cal.home.example` — used for OAuth redirects), `ADMIN_API_KEY` (optional bootstrap key; if unset and no keys exist, generate one and log it once), `SYNC_INTERVAL_MINUTES` (10; Workers uses the cron instead), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (`common`).

## Data model (SQLite)

All ids are text (`crypto.randomUUID()`). Timestamps are ISO 8601 strings. Timed events stored in UTC ISO (`2026-09-24T14:00:00.000Z`); all-day events stored as `YYYY-MM-DD` dates with `end` exclusive.

```
settings(key PK, value)                       -- familyName, timezone, weekStart (0|1), theme, rev
members(id, name, color, avatar, sort, created_at)
accounts(id, kind  'google'|'microsoft'|'caldav', name, config JSON, created_at)
       -- config holds tokens / creds; NEVER returned by the API
calendars(id, kind 'local'|'ics'|'google'|'microsoft'|'caldav', account_id NULL, remote_id NULL,
          name, color NULL, member_id NULL, config JSON, writable INT, enabled INT,
          last_synced_at NULL, last_error NULL)
          -- ics: config.url. remote_id = provider calendar id / caldav URL
events(id, calendar_id, external_id NULL, title, start, end, all_day INT, location, description,
       rrule NULL, member_ids JSON '[]', updated_at)
       -- remote kinds: rows are already-expanded instances replaced wholesale on each sync
       -- local kind: one row per series; rrule expanded at query time
chores(id, title, emoji, member_id NULL, points INT, rrule NULL, due_date NULL, due_time NULL,
       active INT, sort, created_at)
       -- rrule NULL + due_date => one-off. rrule e.g. 'FREQ=DAILY' or 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
chore_completions(id, chore_id, date 'YYYY-MM-DD', member_id NULL, completed_at, UNIQUE(chore_id, date))
api_keys(id, name, hash, prefix, scope 'admin'|'display', created_at, last_used_at)     -- sha256 of key; key shown once
webhooks(id, url, events JSON, secret, enabled, created_at)
pairings(id, code, poll_token_hash, approved, key_id, key_name, encrypted_key, created_at, expires_at)
       -- short-lived display-pairing rows; encrypted_key is AES-256-GCM (AAD = id), deleted once the display polls it
```

## API (`/api`, JSON, `Authorization: Bearer <key>`)

Every route declares a zod-openapi schema with `tags` and `summary` so `/docs` is useful. Errors: `{ error: string }` with proper status.

```
GET    /api/health                                   (no auth) {ok, version}
GET    /api/settings            PATCH /api/settings

GET    /api/members             POST /api/members
PATCH  /api/members/:id         DELETE /api/members/:id
         member response includes pointsToday, pointsWeek

GET    /api/accounts            DELETE /api/accounts/:id          (config stripped)
GET    /api/oauth/:kind/start?key=  -> 302 to Google/Microsoft consent (kind google|microsoft; key via query since it's a browser nav; state = signed/random value stored in settings with 10-min expiry)
GET    /api/oauth/:kind/callback -> creates account, 302 to /#/settings?account=<id>
POST   /api/accounts/caldav     {name, serverUrl, username, password} -> account
GET    /api/accounts/:id/remote-calendars   -> [{remoteId, name, color, writable}]

GET    /api/calendars           POST /api/calendars   {kind, name, color?, memberId?, accountId?, remoteId?, url?}
PATCH  /api/calendars/:id       DELETE /api/calendars/:id
POST   /api/calendars/:id/sync  -> {ok, count} | 502 {error}

GET    /api/events?from&to[&memberId][&calendarId]   -> EventInstance[] (sorted by start)
POST   /api/events              {calendarId, title, start, end, allDay, location?, description?, memberIds?, rrule?}
GET    /api/events/:id          PATCH /api/events/:id     DELETE /api/events/:id
         EventInstance = {id, calendarId, title, start, end, allDay, location, description,
                          memberIds, color, rrule, occurrenceStart, readOnly}
         memberIds: event.member_ids, else [calendar.member_id], else []
         color: first member's color, else calendar.color, else '#888'
         writes to remote calendars go through the provider first; failure -> 502, nothing stored

GET    /api/chores              POST /api/chores   PATCH /api/chores/:id   DELETE /api/chores/:id
GET    /api/chores/day?date=YYYY-MM-DD  -> [{...chore, completed, completedAt, completedBy}]
         (chores due that date in the household timezone, grouped client-side by member)
POST   /api/chores/:id/complete   {date, memberId?}      DELETE /api/chores/:id/complete?date=

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
```

## MCP (`/mcp`)

`POST/GET/DELETE /mcp` - MCP **Streamable HTTP** transport, stateless (no sessions/Durable Objects), same bearer keys as the REST API (401 + `WWW-Authenticate: Bearer` without one). Implemented with `@modelcontextprotocol/sdk`'s `WebStandardStreamableHTTPServerTransport` (Web Standards - Request/Response/ReadableStream, no `node:*`; runs on Workers and Node unchanged). See `server/src/mcp.ts`.

Every tool is a thin wrapper that calls the REST routes above in-process via `app.request()`, forwarding the caller's `Authorization` header - so validation, scope enforcement (display vs admin), bus events/webhooks and rev bumps happen exactly as for REST. A REST 4xx/5xx becomes a tool result with `isError: true` and the route's `{error}` text. Tools: `get_household`, `list_events`, `create_event`, `update_event`, `delete_event`, `list_chores`, `complete_chore`, `uncomplete_chore`, `create_chore`, `get_leaderboard`, `add_member`. Members may be referenced by name in tool args (resolved case-insensitively to id in the tool layer; ambiguous -> error listing matches).

Bus event types (webhooks; every emit also bumps `rev`): `member.changed`, `calendar.changed`, `calendar.synced`, `events.changed`, `chore.changed`, `chore.completed`, `chore.uncompleted`, `settings.changed`, `display.paired`. Webhook POST body `{type, data, at}`, header `X-Kinwall-Signature: sha256=<hex hmac of body>`; sent via `waitUntil`, 5s timeout, no retries.

## Provider contract (`server/src/providers/types.ts`)

Defined in **`server/src/providers/types.ts`** (source of truth). OAuth helpers take `env` as first arg.

Sync window: now − 30 days → now + 365 days. `syncCalendar` replaces all events of that calendar in one `db.batch()` (atomic on D1 and in the adapter), sets `last_synced_at`/`last_error`, emits `calendar.synced` + `events.changed`. `syncDue(env)` syncs enabled non-local calendars whose `last_synced_at` is older than the interval, stalest first, stopping after ~20 s wall time (Workers cron) — called by the cron on Workers and by `setInterval` on Node.

## Security

**Encryption at rest**: `accounts.config`, `calendars.config`, `webhooks.secret` are AES-256-GCM encrypted (Web Crypto) with `ENCRYPTION_KEY` (32 random bytes, base64). Stored as `v1:<iv b64>:<ciphertext b64>`; the row id is the AAD so blobs can't be swapped between rows. Key source: Workers secret; Docker `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE`, else generated once into `$DATA_DIR/encryption.key` (0600) with a startup warning.

**Key scopes**: `admin` = everything. `display` = GET on me/members/calendars (config-free)/events/chores/leaderboard/settings/rev, event create/update/delete, chore create/update/delete/complete/uncomplete. `display` can NOT touch accounts, oauth, keys, webhooks, calendar create/delete, member create/update/delete, or settings PATCH. Wall iPad uses a display key; its web Settings tab shows only a minimal "This display" card (paired-as, nav position, unpair) — no admin sections render at all for a display key. The setup wizard's display-role flow and the phone `#/pair?code=` approval screen still use a temporary in-memory/sessionStorage admin key to finish setup/pairing. `ADMIN_API_KEY` env is admin.

**OAuth**: PKCE + single-use state; Google scopes `calendar.events calendar.readonly openid email` (not full `calendar`); revoke Google token on account delete.

**Untrusted content**: event titles/descriptions from providers render as text only (never HTML). Server sends `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'` (HA ingress frames it). Never log tokens/keys; redact secrets from `last_error`.

**Exposure**

- Every `/api/*` route except `/api/health` and `/api/oauth/:kind/callback` requires a valid key; compare hashes, never plaintext.
- Account/calendar `config` (tokens, passwords, ICS URLs with secrets) is never returned by the API.
- OAuth `state` is single-use and expires; redirect URI is always `PUBLIC_URL` + fixed path.
- CORS: off by default (same origin); `CORS_ORIGINS` env to allow automation from browsers.
- README recommends Cloudflare Access (free ≤ 50 users) in front of the UI as a second layer, with a service-token bypass for `/api/*`.

## Touch UI (Skylight-like)

Target: iPad landscape (1180×820 and 1024×768) first, portrait must work. Safari/WebKit only matters.

- **Look**: white/very light warm background, big rounded cards (16–20px radius), soft shadows, pastel member colors, friendly rounded sans (Nunito via Google Fonts, fallback system-ui). Events are colored rounded chips tinted by member color. Dark theme via `settings.theme` for night.
- **Header**: family name, large clock + date, member avatar row (tap to filter; tap again to clear).
- **Bottom tab bar**: Calendar · Chores · Settings. Big icons + labels.
- **Calendar**: Week (default, 7 columns with all-day row + timed events), Day (time grid, a column per member), Month (grid with dots/chips), Schedule (agenda list). Segmented control to switch. Swipe left/right to page, "Today" button. Tap event → bottom sheet with details / Edit / Delete (hidden when readOnly). Floating "+" and tap-on-empty-slot → add sheet prefilled with that time.
- **Add/Edit sheet**: large inputs, native `<input type="date|time">`, all-day toggle, calendar picker (writable only), member avatars as toggle chips, repeat (none/daily/weekly/monthly).
- **Chores**: one column per member (+ "Anyone"), avatar + progress ring at top, chore cards (emoji, title, points). Tap = complete with a satisfying check + small confetti burst; tap again = undo. Date strip to look at other days. "+" to add; long-press (500ms) to edit.
- **Settings**: family name / timezone / week start / theme; members (add/edit color from a fixed pastel palette + emoji); calendars (add ICS URL, "Connect Google", "Connect Outlook", CalDAV form → pick remote calendars → assign member + color; sync now; last error shown); API keys (create shows key once); webhooks.
- **Kiosk behavior**: ≥ 48px touch targets (prefer 56+), no hover-only affordances, `touch-action: manipulation`, disable text selection & callouts & pinch zoom, no scroll bounce on the shell, pointer events for swipe (no gesture lib). Idle 2 min → return to today's calendar and close sheets. Near-live updates: poll `/api/rev` every 15 s (and on `visibilitychange`), refetch on change. PWA manifest + `apple-mobile-web-app-capable` so it runs full-screen from the home screen.
- **Auth on the display**: first visit `/?key=...` stores key in localStorage and strips it from the URL; no key → simple "paste API key" screen.
