# REST API

Kinwall is API-first. The touch UI is just another client, so anything it does, a script can do too.

## Docs

* **Interactive docs (Swagger UI)**: `https://<your-kinwall>/docs`
* **OpenAPI spec**: `https://<your-kinwall>/openapi.json`. You can import it into n8n, Power Automate, Postman and similar tools.

Every route has a summary and tags, so the Swagger page is the complete reference. This page covers the rules that apply to all of them.

## Authentication

```
Authorization: Bearer <key>
```

* Keys are **admin** or **display** scoped. See [Sign-in & security](../using/sign-in-and-security.md).
  * Create admin keys in **Settings → Access → API Keys**.
  * `POST /api/keys {name, scope?}` defaults to `display` (least privilege).
* A display key calling an admin-only route gets `403 {"error":"display key cannot access this route"}`.
* `GET /api/me` returns the caller's `scope`, `keyName`, `kind` (`api` / `session` / `oauth`) and the server `version`.
* A few routes need no key: `/api/health`, `/api/appearance`, `/api/setup*`, `/api/pair` and `/api/pair/poll`, the passkey and recovery login ceremonies, and the OAuth callback.
* `GET /api/oauth/{kind}/start?key=…` takes the key as a query parameter, because it's a browser navigation.

## Errors

Every error is JSON with a matching HTTP status:

```json
{ "error": "display key cannot access this route" }
```

| Status | Typical cause |
|---|---|
| 400 | Validation failed (zod message), or an unsafe URL. |
| 401 | Missing, unknown or expired key. `/mcp` also sends `WWW-Authenticate` with OAuth metadata. |
| 403 | Display key on an admin route. |
| 404 | Unknown ID. |
| 409 | Changing a provider or public URL that environment variables set. |
| 413 | Import file over 10 MB. |
| 429 | Too many sign-in, recovery-code or setup-code attempts. |
| 502 | Google, Outlook or CalDAV rejected a write. Nothing was stored. |

## Rate limits

General API calls aren't rate-limited. Only credential guessing is:

| Endpoint | Limit |
|---|---|
| Setup code claim | 10 per hour |
| Passkey login | 20 per 10 minutes per address |
| Recovery-code login | 10 per hour per address, 30 per hour overall |

On Workers, the free-tier quota (100k requests/day) is the practical ceiling. See [Cloudflare specifics](../self-hosting/cloudflare.md).

## Change detection

`GET /api/rev` returns `{rev}`, a counter that goes up on every write. Poll it cheaply and refetch when it changes. The apps do this every 15 seconds. For push-style updates, use [webhooks](webhooks.md).

## Route groups

| Area | Routes |
|---|---|
| Household | `GET/PATCH /api/settings`, `GET /api/appearance`, `GET /api/me`, `GET /api/rev`, `GET /api/health` |
| Setup | `GET /api/setup`, `POST /api/setup/claim` |
| Members | `GET/POST /api/members`, `PATCH/DELETE /api/members/{id}` |
| Calendars | `GET/POST /api/calendars`, `PATCH/DELETE /api/calendars/{id}`, `POST /api/calendars/{id}/sync` |
| Accounts | `GET /api/accounts`, `DELETE /api/accounts/{id}`, `POST /api/accounts/caldav`, `GET /api/accounts/{id}/remote-calendars`, `GET /api/oauth/{kind}/start`, `GET /api/oauth/{kind}/callback` |
| Providers | `GET /api/providers`, `PUT /api/providers/public-url`, `PUT/DELETE /api/providers/{kind}` |
| Events | `GET /api/events?from&to[&memberId][&calendarId]`, `POST /api/events`, `GET/PATCH/DELETE /api/events/{id}`, `GET /api/events/{id}/items` |
| Categories | `GET/POST /api/categories`, `PATCH/DELETE /api/categories/{id}`, `POST /api/categories/reorder` |
| Chores | `GET/POST /api/chores`, `PATCH/DELETE /api/chores/{id}`, `GET /api/chores/day?date=`, `POST/DELETE /api/chores/{id}/complete` |
| Leaderboard | `GET /api/leaderboard?period=today\|week\|month` |
| Lists | `GET/POST /api/lists`, `GET/PATCH/DELETE /api/lists/{id}`, items, steps (`POST/PATCH/DELETE .../steps[/{stepId}]`, `POST .../steps/reorder`), `clear-completed`, `reset`, `reorder`, `groups` |
| Snapshot & weather | `GET /api/snapshot?member=&range=day\|week`, `GET /api/weather`, `GET /api/geocode?q=` |
| Keys & pairing | `GET/POST /api/keys`, `DELETE /api/keys/{id}`, `POST /api/pair`, `/api/pair/approve`, `/api/pair/poll` |
| Passkeys & recovery | `/api/passkeys*`, `/api/sessions/logout`, `GET/POST /api/recovery-codes`, `POST /api/recovery/login` |
| Connected apps | `GET /api/authorizations`, `GET /api/authorizations/request`, `POST /api/authorizations/approve`, `DELETE /api/authorizations/{id}` |
| Webhooks | `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/{id}`, `POST /api/webhooks/{id}/rotate` |
| Push | `GET /api/push/vapid-public-key`, `/api/push/subscriptions*`, `POST /api/push/test/{id}`, `POST /api/notify`, `GET /api/notifications` |
| Stickers | `GET /api/members/{id}/points`, `GET /api/stickers/packs`, `POST /api/stickers/packs/{packId}/buy`, `GET/POST /api/stickers/scrapbook/{memberId}`, `PATCH/DELETE /api/stickers/scrapbook/{memberId}/{id}` |
| Notes | `GET/POST /api/notes`, `PATCH/DELETE /api/notes/{id}` |
| Data | `GET /api/export`, `POST /api/import`, `GET /api/host-events` |

Dates: timed events use UTC ISO strings (`2026-09-24T14:00:00.000Z`). All-day events use `YYYY-MM-DD` with an **exclusive** end.

## Examples

```bash
# What's on this week?
curl "https://kinwall.example/api/events?from=2026-09-21T00:00:00Z&to=2026-09-28T00:00:00Z" \
  -H "Authorization: Bearer $KEY"

# Mark a chore done from any automation
curl -X POST https://kinwall.example/api/chores/<id>/complete \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"date":"2026-09-24"}'

# Add groceries
curl -X POST https://kinwall.example/api/lists/<id>/items \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '[{"title":"Milk"},{"title":"Eggs","quantity":"12"}]'
```

## Calling from a browser

CORS is off by default (same origin only). To allow browser-based automations on other origins, set `CORS_ORIGINS` to a comma-separated list.
