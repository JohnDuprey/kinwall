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
* `GET /api/me` returns the caller's `scope`, `keyName`, `kind` (`api` / `session` / `oauth`), `owner`, `locked` and the server `version`.
* A device's `owner` is `shared` (the whole family), a member id, or `null` (paired before owners existed, or not a device). `POST /api/pair/approve {code, name, owner?}` sets it (default `shared`); only an admin can change it with `PATCH /api/keys/{id} {owner}`. A device key minted with `POST /api/device-keys` inherits the caller's owner.
* The Kinwall app's OAuth sign-in has an owner too: `POST /api/authorizations/approve` takes `owner` (default `shared`) when the redirect is `family.kinwall.app:/oauth` (`GET /api/authorizations/request` says so with `deviceApp: true`). `GET /api/authorizations` lists each grant's `owner` and `deviceApp`, and `PATCH /api/authorizations/{id} {owner}` changes it for the grant and its current access key.
* `locked` is true only for a **display** key with an owner: a member id pins its view to that member, `shared` keeps it on everyone, and either way it can't pick its own filter. On an **admin** key the owner is only for personal defaults and `locked` is always false.
* A few routes need no key: `/api/health`, `/api/appearance`, `/api/setup*`, `/api/pair` and `/api/pair/poll`, the passkey and recovery login ceremonies, and the OAuth callback.
* A shared recipe's page `GET /r/{token}` (HTML with schema.org Recipe data) and its photos `GET /r/{token}/image` and `GET /r/{token}/steps/{n}/image` are public: the link is the credential. An unknown or stopped link is `404`. See [Sharing a recipe](../using/meals.md#sharing-a-recipe).
* `GET /api/oauth/{kind}/start?key=…`, `GET /api/photos/export.zip?key=…`, `GET /api/photos/{id}/image?key=…` and the recipe photos `GET /api/recipes/{id}/image?key=…` / `GET /api/meals/{id}/image?key=…` (and a recipe step's `GET /api/recipes/{id}/steps/{n}/image?key=…`) also take the key as a query parameter, because they're browser navigations and an `<img src>`. No other route does.
* Uploading a photo: `POST /api/photos` with the image itself as the body (`Content-Type: image/webp`, `image/jpeg` or `image/png`, at most 600 KB), its pixel size in `X-Photo-Width` / `X-Photo-Height`, and an optional `?caption=`. Too large is `413`, another type is `415`, and a full album is `409` with the quota. Display keys can upload (so a wall display can save a Paint drawing to the family photos). Editing, deleting, the zip export and the zip import need an admin key.

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
| Quiet-hours PIN check | 10 wrong tries in a row per key per 15 minutes (429) |
| Shared recipe pages and photos (`/r/*`) | 120 per minute per address |

On Workers, the free-tier quota (100k requests/day) is the practical ceiling. See [Cloudflare specifics](../self-hosting/cloudflare.md).

## Change detection

`GET /api/rev` returns `{rev}`, a counter that goes up on every write. Poll it cheaply and refetch when it changes. The apps do this every 30 seconds. For push-style updates, use [webhooks](webhooks.md).

## Route groups

| Area | Routes |
|---|---|
| Household | `GET/PATCH /api/settings`, `PUT/DELETE /api/quiet-pin` (`{ pin }`, 4 to 8 digits; parent devices only, not display keys or connected apps; `settings.quietPin` says only whether one is set), `POST /api/quiet-pin/verify` (`{ pin }` → `{ ok }`, `ok: true` when no PIN is set; display keys may, connected apps can't), `GET /api/appearance`, `GET /api/me`, `GET /api/rev`, `GET /api/health` |

Color settings on `PATCH /api/settings`: `colorScheme` is a built-in id (`meadow` is shown as Peach, `field` as Meadow, plus `ocean`, `lavender`, `midnight`, `spring`, `summer`, `autumn`, `winter`, `harvest`, `festive`), `seasonal`, or a `customSchemes` id. `customSchemes` is the family's own schemes, up to 10, each `{ id: "custom-…", name, emoji, light, dark }` with `light`/`dark` as `{ bg, card, text, accent }` hex colors. A scheme whose text or derived dim text is under 4.5:1 on its background or cards, in either mode, is refused with 400 and the failing pairs. `accent`, `backgroundLight`, `backgroundDark` and `customColors` are kept for older clients.
`themeMode` is `light`, `dark`, `auto` (follow the device's system setting, the default for a family that hasn't picked one) or `scheduled` (dark between `darkFrom` and `darkTo`).
`typeface` is the family's typeface: `default` (Nunito, the default), `hyperlegible`, `dyslexia`, `modern`, `playful`, `storybook` or `handwritten`; anything else is refused with 400. It's also on `GET /api/appearance`, and a device can override it locally. Like the other family settings, a display key gets 403 changing it.
`timeFormat` is how clock times read: `auto` (the default), `12` ("3:40 PM") or `24` ("15:40"); anything else is refused with 400. On `auto`, the app follows each device's locale, and text the server writes (notifications, Live Activity headlines, insights) follows the `location` country: 12-hour for US, CA, AU, NZ, PH, IN, PK, BD, EG, SA and MY, 24-hour elsewhere, 12-hour with no location. A device can override it locally. A display key gets 403 changing it.
Feature switches on `PATCH /api/settings` are sent as the complete `features` object: `{ chores, lists, contacts, paint, photos, notes, messages, trackersReading, trackersMemories, trackersHealth, meals }`. Each value is boolean. `contacts` defaults to `true` when omitted so clients from before the Contacts switch remain compatible; the newer tracker and meals switches also default to on when omitted. The switches hide their feature in the app but keep its data and API available unless a route says otherwise.
| Setup | `GET /api/setup`, `POST /api/setup/claim` |
| Members | `GET/POST /api/members`, `PATCH/DELETE /api/members/{id}` (`grownUp: true` keeps `needsApproval` false, see [Family](../settings/family.md#members)), `GET /api/members/{id}/stats?period=today\|week\|month\|year\|all` (a member's profile numbers; wall screens and kids' devices too, see [Member stats](#member-stats)) |
| Calendars | `GET/POST /api/calendars`, `PATCH/DELETE /api/calendars/{id}`, `POST /api/calendars/{id}/sync` |
| Accounts | `GET /api/accounts`, `DELETE /api/accounts/{id}`, `POST /api/accounts/caldav`, `GET /api/accounts/{id}/remote-calendars`, `GET /api/oauth/{kind}/start`, `GET /api/oauth/{kind}/callback` |
| Providers | `GET /api/providers`, `PUT /api/providers/public-url`, `PUT/DELETE /api/providers/{kind}` |
| Events | `GET /api/events?from&to[&memberId][&calendarId]`, `POST /api/events`, `GET/PATCH/DELETE /api/events/{id}`, `GET /api/events/{id}/items`, `PUT /api/calendars/{id}/events/sync` (admin; see [Syncing events from an automation](#syncing-events-from-an-automation)) |
| Categories | `GET/POST /api/categories`, `PATCH/DELETE /api/categories/{id}`, `POST /api/categories/reorder` |
| Chores | `GET/POST /api/chores`, `PATCH/DELETE /api/chores/{id}`, `GET /api/chores/day?date=`, `POST/DELETE /api/chores/{id}/complete`, `GET /api/chores/pending`, `POST /api/chores/{id}/approve`, `POST /api/chores/{id}/reject` (the last three admin only; see [Parent approval](../using/chores.md#parent-approval)) |
| Leaderboard | `GET /api/leaderboard?period=today\|week\|month` |
| Lists | `GET/POST /api/lists`, `PUT /api/lists/order` (the family's list order), `GET/PATCH/DELETE /api/lists/{id}` (`?store=` for a shopping trip view), items, steps (`POST/PATCH/DELETE .../steps[/{stepId}]`, `POST .../steps/reorder`), `clear-completed`, `reset`, `reorder`, `groups`, `POST /api/lists/values` (rename or remove a store, category or aisle), `PUT /api/lists/aisles` (a store's aisle order). See [Lists](../using/lists.md#api-and-mcp) |
| Meals | `GET/POST/PATCH/DELETE /api/recipes[/{id}]`, `POST /api/recipes/import`, `POST /api/recipes/import-url` (read a recipe web page, optionally saving it), `POST /api/recipes/parse-text` (read pasted recipe text), `PUT /api/recipes/{id}/rating` (`{ memberId, stars }`: set a member's 1-5 stars, `null` or `0` clears; wall and member devices too, a member's own device only for them; recipes carry `rating: { average, count, byMember }`), `GET /api/recipes/{id}/source.pdf` and `GET /api/meals/{id}/source.pdf` (the recipe card PDF, fetched from the record's own `sourceUrl`), `GET /api/recipes/{id}/image` and `GET /api/meals/{id}/image` (the recipe photo from its own `imageUrl`), `POST /api/recipes/{id}/share` (make the recipe's public link, or get the one it has: `{ url, token, createdAt }`) and `DELETE /api/recipes/{id}/share` (turn it off), with admin keys seeing `share: { url, createdAt }` or `null` on each recipe, `GET/POST/PATCH/DELETE /api/meals[/{id}]`, `GET /api/meals/projection`, `POST /api/meals/projection/apply`, `POST /api/meals/{id}/swap` (`{ otherId }`: trade two meals' date and slot), `POST/DELETE /api/meals/{id}/calendar-link`, `POST /api/meals/{id}/calendar-event`. See [Meals](../using/meals.md). |
| Trackers | `GET/POST /api/trackers`, `GET/PATCH/DELETE /api/trackers/{id}`, `GET /api/trackers/summary?year=`. See [Trackers](../using/trackers.md). A connected app's OAuth token gets no health entries (403 when asked for one) unless the `aiHealthAccess` setting is on; see [MCP server](mcp.md#health-entries). |
| Activity plugins | `GET /api/plugins/catalog`, `GET/POST /api/plugins`, `PATCH/DELETE /api/plugins/{id}`, `POST /api/plugins/{id}/update`, `GET/PUT /api/plugins/{id}/data`, `POST /api/plugins/{id}/playtime`. See [Activities](../using/activities.md#activities-from-others) and [Building activity plugins](../contributing/plugins.md). |
| Temp check | `GET/PUT /api/members/{id}/temp-check?date=` (today by default): a person's daily questions and answers (`{ settings, sleep, feelings, goal, goalSkipped, answered, custom, private }`). `PUT` changes only the fields sent; `feelings` not on their list join `custom`, and `custom` replaces it. Display keys may (today only; a member's own device only for them). `sleep`, `feelings`, `custom` and `followup` are withheld (`private: true`, `null`) from a shared wall screen, another member's device and a connected app without `aiHealthAccess`; a connected app can't set them either (403). `followup` (`{ outcome, helped, hindered, next }`, the evening goal check) is today only; `followupOpen` says it's showing. `drained` (`full`, `ok`, `low`, `empty` or `skip`, the energy battery's evening question) is today only, their own device or an admin key, and withheld like sleep; `drainedOpen` says it's showing. See [Temp check](../using/snapshot.md#temp-check). |
| Medications | `GET/POST /api/medications`, `PATCH/DELETE /api/medications/{id}`, `DELETE /api/medications` (all data), `GET /api/medications/due`, `POST /api/medications/{id}/doses`, `GET /api/members/{id}/medications?days=`. 404 while `settings.medications` is off. Adding and changing: admin keys. Shared walls get due doses (names only with `medicationNamesOnWalls`) and mark them; a member's own device only theirs; connected apps 403 without `aiHealthAccess`. Settings `medications` and `medicationNamesOnWalls` can't be changed by a connected app. See [Medications](../using/medications.md#api). |
| Journal | `GET /api/members/{id}/journal?to=&days=`, `POST /api/members/{id}/journal`, `PATCH/DELETE /api/members/{id}/journal/{entryId}`: a person's days (Temp check and goal checks) and their own entries. Their own device (display key they own) and admin keys only; 403 for shared walls, other members' devices and connected apps without `aiHealthAccess`. See [Journal](../using/journal.md). |
| Insights | `GET /api/members/{id}/insights?range=4w\|3m\|1y`: a person's per-day series (sleep, feelings, goal set and how it went, journal entry counts and moods, chores, points, activity minutes, books finished, timed events and the latest event end), plain summaries and, after 21 days with check-ins, connections with their counts and confidence. Computed on request, nothing stored. Their own device and admin keys only; 403 for shared walls, other members' devices and connected apps without `aiHealthAccess`. See [Insights](../using/insights.md). |
| Energy battery | `GET /api/members/{id}/battery`: a person's rough daily energy for the last 7 days and 3 days ahead (`{ on, today, days: [{ date, forecast, start, drain, level, reasons, lowBefore, felt }], warnings }`), from sleep and feelings against events, chore points and goals, adjusted by their evening `drained` answers, with every reason. `on` is false unless `tempCheck.battery` is on. Computed on request, nothing stored. Their own device and admin keys only; 403 for shared walls, other members' devices and connected apps without `aiHealthAccess`. See [Energy battery](../using/battery.md). |
| Daily check-in | `POST /api/members/{id}/check-in`: once per member per household day; display keys may (a member's own device only for them). See [Daily check-in](../using/snapshot.md#daily-check-in). |
| Snapshot & weather | `GET /api/snapshot?member=&range=day\|week`, `GET /api/board?days=`, `GET /api/weather`, `GET /api/geocode?q=`, `GET /api/tidbits` |
| Keys & pairing | `GET/POST /api/keys`, `PATCH/DELETE /api/keys/{id}`, `POST /api/pair`, `/api/pair/approve`, `/api/pair/poll` |
| Passkeys & recovery | `/api/passkeys*`, `/api/sessions/logout`, `GET/POST /api/recovery-codes`, `POST /api/recovery/login` |
| Connected apps | `GET /api/authorizations`, `GET /api/authorizations/request`, `POST /api/authorizations/approve`, `PATCH /api/authorizations/{id}`, `DELETE /api/authorizations/{id}` |
| Webhooks | `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/{id}`, `POST /api/webhooks/{id}/rotate` |
| Push | `GET /api/push/vapid-public-key`, `/api/push/subscriptions*`, `POST /api/push/test/{id}`, `POST /api/notify`, `GET /api/notifications`, `DELETE /api/notifications[/{id}]`, `PUT/DELETE /api/live-activities/tokens` (the iPhone app's Live Activity tokens, for its own device) |
| Rewards | `GET/POST /api/rewards`, `PATCH/DELETE /api/rewards/{id}`, `POST /api/rewards/{id}/redeem`, `GET /api/rewards/redemptions`, `POST /api/rewards/redemptions/{id}/approve`, `/decline`, `/given`, `PUT /api/members/{id}/reward-goal`. Display keys list, redeem and set a goal (a member's own device only for them); the rest is admin. See [Rewards](../using/rewards.md#export-api-and-integrations) |
| Stickers | `GET /api/members/{id}/points`, `GET /api/stickers/packs`, `POST /api/stickers/packs/{packId}/buy`, `GET/POST /api/stickers/scrapbook/{memberId}`, `PATCH/DELETE /api/stickers/scrapbook/{memberId}/{id}` |
| Photos | `GET/POST /api/photos` (POST body: the raw image), `GET /api/photos/quota`, `PATCH/DELETE /api/photos/{id}`, `GET /api/photos/{id}/image`, `GET /api/photos/export.zip`, `POST /api/photos/import` (body: the zip) |
| Notes | `GET/POST /api/notes`, `PATCH/DELETE /api/notes/{id}` |
| Data | `GET /api/export`, `POST /api/import`, `GET /api/host-events` |

## Member stats

`GET /api/members/{id}/stats?period=week` returns what a member's profile shows, built from data Kinwall already keeps. Periods are household days (the family's timezone and week start): `today`, `week` (default), `month`, `year`, or `all` (from the day they were added, or their first chore if earlier).

| Field | What it is |
|---|---|
| `from`, `to`, `joined` | The period's first day and today, and the day they were added (`YYYY-MM-DD`). |
| `choresDone`, `pointsEarned` | Approved chore completions in the period, and the points earned from them plus daily check-ins. Waiting-for-approval ticks don't count; a chore deleted after it was done still does. |
| `checkIns` | [Daily check-ins](../using/snapshot.md#daily-check-in) in the period. |
| `previous` | `{ from, to, choresDone, pointsEarned }` for the same stretch just before (yesterday, last week to the same weekday, last month or last year to the same date), or `null` for `all`. |
| `pointsSpent` | `{ stickers, rewards }` in the period; rewards net of refunds. |
| `streak` | `{ current, best }`. The same rule as the leaderboard streak, grace days included. `best` looks back over all history. |
| `chart` | `[{ key, count }]`: chores done per day for the whole `week` or `month`, or per month (`year` covers January to December, `all` from the first month). Days still ahead are 0. Empty for `today`. |
| `busiestWeekday`, `favoriteChore` | The weekday (0 = Sunday) with the most chores done, and the chore done most, in the period. |
| `books` | `{ finished, pages, minutesListened, shelfScope, shelf, reading }`: books and audiobooks finished in the period, the books' pages and the audiobooks' minutes; the shelf (each with `pages` or `minutes`) is this year's finished books (every one for `all`); books in progress with a percent. Only reading tracker entries; health entries never appear. |
| `stickers` | `{ packsOwned, packsTotal, placed }`. |
| `activities` | `[{ pluginId, name, emoji, seconds }]`: time played in each activity in the period. |
| `badges` | `[{ id, emoji, title, earned }]`: the fixed set of milestone badges, earned from all-time totals. |
| `birthday` | `{ date, daysUntil, turning }` (`turning` is `null` without a birth year), or `null`. |

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

# Import a meal-kit recipe and plan it for Monday dinner (admin key; importing again updates it).
# Add "calendarId" to plan to also put the dinner on that calendar.
# A step is text (several lines become bullets) or {"text","bullets","imageUrl","title","timers":[{"name","minutes"}]}.
curl -X POST https://kinwall.example/api/recipes/import \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"source":"hellofresh","externalId":"abc","name":"Creamy Chicken","servings":2,"ingredients":[{"text":"1.5 tablespoon Sour Cream","pantry":false},"Salt"],"steps":["Cook.",{"text":"Serve","bullets":["Plate the rice.","Top with chicken."]}],"plan":{"date":"2026-10-05","slot":"dinner"}}'
```

## Syncing events from an automation

`PUT /api/calendars/{id}/events/sync` (admin key, local calendars only) lets an automation such as Home Assistant keep a set of events on a calendar: send every event it currently has from one `source`, and Kinwall adds the new ones, updates the changed ones and deletes the ones missing from the list. Returns `{ created, updated, deleted }`; sending the same list again changes nothing.

- Each event is `{ externalId, title, start, end, allDay, notes?, location? }`, matched by (calendar, `source`, `externalId`). Timed events take any ISO date-time (stored in UTC); all-day events take `YYYY-MM-DD` with an exclusive end.
- With `from` and `to` (`YYYY-MM-DD`), only events of that source starting in that window are deleted when missing, so past ones stay.
- Only events from the same `source` are ever changed. Events made in Kinwall, and events from other sources, are left alone.
- Synced events are ordinary events: people can tag, edit or delete them, but the next sync puts the title, time, notes and location back from the source (and brings back a deleted one if the source still has it).

```bash
curl -X PUT https://kinwall.example/api/calendars/<id>/events/sync \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"source":"ha:hellofresh","from":"2026-09-27","to":"2026-11-08","events":[{"externalId":"delivery-123","title":"📦 HelloFresh delivery","start":"2026-10-07T08:00:00-04:00","end":"2026-10-07T20:00:00-04:00","allDay":false,"notes":"Tacos, Pasta\n2 of 3 meals picked"}]}'
```

## Calling from a browser

CORS is off by default (same origin only). To allow browser-based automations on other origins, set `CORS_ORIGINS` to a comma-separated list.
## Household contacts

The Contacts Directory is available through `GET /api/contacts`, `POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`, contact-category CRUD at `/api/contact-categories`, `POST /api/contacts/import/preview`, `POST /api/contacts/import`, and `POST /api/contacts/merge`. List filters include `search`, `kind`, `category`, `favorite`, `emergency`, `wallVisible`, `memberId`, and `visibility`. Admin keys see every contact. Display keys see what the contact's `visibility` allows for that device (see [Who can see a contact](../using/contacts.md#who-can-see-a-contact)) and can't change contacts. Import preview takes `vcard` (raw vCard text) or `contacts` (drafts) and saves nothing.
