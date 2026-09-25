# Kinwall

An open-source, self-hosted family wall calendar and chore chart, built for a wall-mounted iPad.

![Week view on a wall-mounted iPad](docs/screenshots/ipad-week.png)

<p align="center">
  <img src="docs/screenshots/phone-3day.png" width="19%" alt="3-day view on a phone" />
  <img src="docs/screenshots/phone-schedule.png" width="19%" alt="Schedule on a phone" />
  <img src="docs/screenshots/phone-event.png" width="19%" alt="Event details" />
  <img src="docs/screenshots/phone-groceries.png" width="19%" alt="Shopping list grouped by category" />
  <img src="docs/screenshots/phone-chores-dark.png" width="19%" alt="Chores in dark mode" />
</p>

- **One calendar for the family**: Google, Outlook/Microsoft 365, iCloud (CalDAV) and any ICS subscription URL, merged and color-coded per family member. Two-way for Google, Microsoft and CalDAV.
- **Categories**: custom event categories (🎂 Birthdays, 🏥 Appointments, ...) whose color overrides the member color, with keyword auto-matching against the event title, a per-calendar default, and a multi-select filter on the calendar.
- **Chores**: recurring or one-off, per person or "anyone", with points and a satisfying tap-to-complete.
  - Late completion credit (`lateCompletionCredit`, default 50%): a chore ticked off for a past day still earns that share of its points.
  - Streak grace days (`streakGraceDays`, 0-3, default 1): a 🔥 streak survives that many missed days in any 7.
  - Leaderboard on/off (`leaderboardEnabled`, default on): hide the leaderboard and rank badges for families that prefer no competition.
- **Leave-by time**: give an event its travel time and it shows when to leave; reminders can count back from the leave-by time instead of the start. Kept in Kinwall only, never written to Google/Outlook.
- **Lists**: shopping, todo and reusable lists, grouped by store or category, with items that remember where they go, can be assigned to a member, and drag to reorder.
  Items can be linked to a calendar event: the event's sheet shows its tasks (tick them off or add more), and the list row shows the event.
- **Accessible**: keyboard and screen-reader support, 4.5:1 contrast in every theme, text scaling and reduced motion; see [docs/accessibility.md](docs/accessibility.md).
- **Touch-first UI**: week, day, month and schedule views (week becomes a 3-day view on phones), swipe to page, big targets, and it returns to today after 2 minutes idle.
- **API-first**: everything the UI does is in the REST API (OpenAPI docs at `/docs`), with signed webhooks for automations. Home Assistant integration: [kinwall-homeassistant](https://github.com/JohnDuprey/kinwall-homeassistant).
- **Runs anywhere**: Cloudflare Workers free tier, Docker (amd64/arm64), or the Home Assistant add-on.
- **Push notifications**: event reminders, a daily summary, chore nudges and list updates, per device — Settings → Notifications. iPhone needs iOS 16.4+ and Kinwall added to the Home Screen first (Safari tabs can't receive push). Android works in Chrome, Firefox or Samsung Internet, installed or not.

<details>
<summary>More screenshots</summary>

| | |
|---|---|
| ![Month view](docs/screenshots/ipad-month.png) | ![Chores with leaderboard and streaks](docs/screenshots/ipad-chores.png) |
| ![Lists](docs/screenshots/ipad-lists.png) | ![Dark mode](docs/screenshots/ipad-week-dark.png) |

</details>

## Try it with demo data

`scripts/seed-demo.mjs` fills a fresh instance with a fictional family: members, a month of events, categories, chores with a week of history, and lists. It only runs against an instance with no members yet.

```bash
KINWALL_URL=http://localhost:8080 KINWALL_KEY=<admin key> node scripts/seed-demo.mjs
```

## Deploy

| Option | Cost | Best for |
|---|---|---|
| [Cloudflare Workers](#cloudflare-workers) | free tier | no hardware, HTTPS out of the box, easy Google/Microsoft sign-in |
| [Docker](#docker) | free | home server, NAS, Raspberry Pi, any VPS |
| [Home Assistant add-on](https://github.com/JohnDuprey/kinwall-homeassistant) | free | you already run Home Assistant |

### Docker

```bash
docker run -d --name kinwall -p 8080:8080 -v ./data:/data \
  -e PUBLIC_URL=http://<your-server>:8080 ghcr.io/johnduprey/kinwall
docker logs kinwall   # first boot prints your admin API key
```

Or use [`docker-compose.yml`](docker-compose.yml). All state lives in `/data`: the SQLite database plus `encryption.key`. **Back up both.** Losing the key makes stored calendar credentials unrecoverable.

### Cloudflare Workers

From a clone of the repo, with Node 24:

```bash
node scripts/setup-cloudflare.mjs
```

It walks you through everything and is safe to re-run (to add a custom domain later, or after pulling updates):

1. Logs you in to Cloudflare (`wrangler login` opens a browser) and picks the account.
2. Finds or creates a D1 database named `kinwall` in the location nearest you (guessed from your timezone) and writes its ID into `wrangler.toml`.
3. Optionally serves Kinwall on a custom domain on a zone in your account instead of `workers.dev`.
4. Deploys (building the UI), then sets the secrets: `ENCRYPTION_KEY` (paste one or let it generate one), `ADMIN_API_KEY` (a permanent admin key that also works as the first-run setup code; it's printed once and not saved anywhere), and `PUBLIC_URL`.
5. Calls `/api/health`, which makes the Worker apply its database migrations, and prints your URL and admin key.

Keep a copy of `ENCRYPTION_KEY`: losing it means re-connecting every calendar account. Existing secrets are kept unless you choose to replace them. `--dry-run` prints what it would do without changing anything; `--yes` runs without prompts (for CI), taking `KINWALL_DOMAIN`, `KINWALL_D1_LOCATION` (`enam`, `wnam`, `weur`, `eeur`, `apac`, `oc`), `KINWALL_ENCRYPTION_KEY` and `KINWALL_ADMIN_API_KEY` from the environment, and `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in place of a login. The script edits your local `wrangler.toml`; those account-specific lines don't belong in a pull request.

The free tier is 100k requests/day, and each request or cron run gets 10 ms of CPU. Sync stays inside that limit: feeds that haven't changed are skipped by fingerprint, and Google/Microsoft/CalDAV sync in 31-day slices. If a very large ICS feed hits the CPU limit, move to Workers Paid ($5/mo).

<details>
<summary>Manual setup: from the Cloudflare dashboard (git-connected), or with wrangler by hand</summary>

**From GitHub:** fork the repo, then in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository** and pick your fork. Keep the default root directory `/` and deploy command `npx wrangler deploy`. The UI build runs from `wrangler.toml`, and the Worker applies its own database migrations.
2. **Settings → Build → Build command:** `sh scripts/cloudflare-config.sh`. It writes your account's settings, taken from **Build variables** on the same page, into the build's copy of `wrangler.toml`, so nothing account-specific is committed:
   - `D1_DATABASE_ID`: create a D1 database named `kinwall` under Storage & Databases, choosing the **Location** nearest you (or `npx wrangler d1 create kinwall --location enam`), and paste its ID. If you leave it out, the first deploy creates one automatically, but it lands near Cloudflare's build servers rather than near you (every query then crosses that distance), and dashboard edits such as adding a secret create Worker versions that can lose track of an auto-created database.
   - `CUSTOM_DOMAIN` (optional): e.g. `kinwall.example.com` on a zone in your account. It's served as a custom domain and `workers.dev` is turned off. Set domains this way, not only in the dashboard: each deploy applies `wrangler.toml`, which would remove a dashboard-only domain.
3. **Settings → Variables and Secrets**, as type *Secret*: `ENCRYPTION_KEY` (value from `openssl rand -base64 32`) and optionally `ADMIN_API_KEY` (any long random string, which also works as the first-run setup code).
4. Open your URL. Without `ADMIN_API_KEY`, the setup code is printed in the Worker's logs on the first visit.

**With wrangler by hand:**

```bash
npx wrangler d1 create kinwall --location enam   # then add database_name/database_id under [[d1_databases]] in wrangler.toml
npx wrangler deploy                              # from the repo root: builds the UI and deploys
npx wrangler secret put ENCRYPTION_KEY           # value: openssl rand -base64 32
npx wrangler secret put ADMIN_API_KEY            # optional; also works as the setup code
```

Set the public URL in **Settings → Calendars → Calendar providers** (or as a `PUBLIC_URL` secret or `[vars]` entry) to your `*.workers.dev` URL or custom domain.

</details>

**Deploying on releases instead of every push.** The dashboard's git integration builds on every push to the production branch. To ship only on releases, either point it at a `release` branch (**Settings → Build → Branch control**, non-production builds off) or leave the repo unconnected and use [`.github/workflows/cloudflare.yml`](.github/workflows/cloudflare.yml): it deploys on `v*` tags (the same tags that publish the Docker image) once you set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, the `D1_DATABASE_ID` (and optional `CUSTOM_DOMAIN`) variables, and `CLOUDFLARE_DEPLOY=true`.

**Demo build.** `npm run build:demo` in `web/` produces a static site (`web/dist-demo`) that runs entirely in the browser on sample data — no server, no database, nothing saved, every visitor gets a fresh copy. [`.github/workflows/demo.yml`](.github/workflows/demo.yml) publishes it to a Cloudflare Pages project on `v*` tags when the `DEMO_PAGES_PROJECT` variable is set.

## Put it on the wall

1. On the iPad, open `https://<your-kinwall>` in Safari and tap **Set up as a wall display**. It shows a pairing code and QR code: scan it with your phone (approve with your passkey) or enter the code under Settings → Access → Add a display on an admin device.
2. Tap Share, then **Add to Home Screen**, and launch it from there (full screen).
3. iPad Settings: set Display → Auto-Lock to Never and turn on Guided Access (Accessibility) to lock the iPad to Kinwall.

On a display, Settings shows Household, Appearance, This display (navigation position, unpair) and Categories. Admin functions (members, calendar accounts, displays, passkeys, API keys, webhooks) don't appear; use an admin device for those.

**Quiet hours:** Settings → General → Appearance → Quiet hours (displays) sets a nightly window (`quietFrom`/`quietTo`, HH:MM) during which paired wall displays show only a dim, slowly drifting clock instead of the calendar. Tap the screen to wake it; it goes back to the clock after five minutes without a touch. Phones and admin devices are never dimmed.

## Notifications

Settings → Notifications, on any device: **Turn on notifications**, then choose event reminders, a
daily summary (with a time), a chore reminder (with a time), list updates, and which family members
to follow. Each event can set its own reminder (Settings has a household default for events with
none); the event detail sheet shows it as "🔔 30 min before", and for Google/Outlook events it's
written through to the provider so their own apps honor it too. Tapping a reminder notification
opens that event. The daily summary also lists open tasks linked to today's events
("To do for today's events", up to three per event). An admin device's Settings → Access → Notifications lists every subscribed
device and can send a one-off message to any of them right now.

iPhone needs **iOS 16.4+** and Kinwall added to the Home Screen (Share → Add to Home Screen) —
Safari tabs can't receive push notifications at all, and Settings explains this if it detects Safari.

## Connect calendars

Google and Microsoft OAuth credentials can be set up entirely in the UI now — no env vars or
restart needed. Go to **Settings → Calendars → Calendar providers** (admin only): set a Public URL (used to
build the redirect URI — prefilled from the page's own origin), then open the Google or Microsoft
card, paste in a client ID/secret, and hit Save. Each card shows the exact redirect URI (with a
copy button) and a short numbered setup guide for that provider's console. The first-run setup
wizard offers the same form inline if you get to the calendars step before configuring a provider.

Environment variables (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`/`MS_CLIENT_SECRET`/`MS_TENANT`,
`PUBLIC_URL`) still work — handy for a fleet-managed or Home Assistant add-on install. `PUBLIC_URL`
always wins over the UI value; for the provider credentials a household's own UI-configured app wins
and the env vars are the fallback. When a provider comes from env vars, its card shows "Provided by
your host" and is read-only in the UI.

| Source | How |
|---|---|
| Any ICS URL | Settings → Calendars → + ICS URL. Works with Google's "secret address in iCal format", Outlook's published calendars, school/sports feeds. Read-only. |
| Google | Settings → Calendar providers → Google (see above), or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Either way, create an OAuth client (Web application) in Google Cloud Console with the redirect URI shown on the card. Google requires HTTPS or `localhost` redirect URIs, so a bare LAN IP won't work. Use Workers, a domain with HTTPS, or complete sign-in from `http://localhost:8080` on the server itself. |
| Microsoft / Outlook | Settings → Calendar providers → Microsoft (see above), or set `MS_CLIENT_ID` / `MS_CLIENT_SECRET` (and `MS_TENANT` if not `common`). Register an app in Entra ID with the redirect URI shown on the card and delegated permissions `Calendars.ReadWrite`, `User.Read`, `offline_access`. |
| iCloud / CalDAV | Settings → Calendars → CalDAV. For iCloud use `https://caldav.icloud.com` and an [app-specific password](https://support.apple.com/102654). Note: Apple app-specific passwords can't be limited to calendars. If you only need to read, use a public ICS link instead. |

## API & automation

- Interactive docs: `/docs`. OpenAPI spec: `/openapi.json` (import it into n8n, Power Automate, Postman).
- Auth: `Authorization: Bearer <key>`. Keys are `admin` (everything) or `display` (household settings and member edits, full read+write on events and chores; no accounts, keys, webhooks, passkeys, displays, calendar management, or adding/removing members).
- Change detection: `GET /api/rev` returns a counter that increments on every write.
- Chore leaderboard: `GET /api/leaderboard?period=today|week|month` (default week) returns each member's points, completions and current streak for the period, ranked with tie handling.
- Webhooks: `POST /api/webhooks {url, events, secret}` sends `{type, data, at}` with header `X-Kinwall-Signature: sha256=<HMAC of body>`. Event types: `member.changed`, `calendar.changed`, `calendar.synced`, `events.changed`, `chore.changed`, `chore.completed`, `chore.uncompleted`, `list.changed`, `list.item.changed`, `category.changed`, `settings.changed`, `display.paired`.
- Push notifications: `POST /api/notify {title, body, memberIds?, url?}` (admin only) sends a message right now to every device following any of `memberIds` (omit it to reach every device).

```bash
# Mark a chore done from any automation
curl -X POST https://kinwall.example/api/chores/<id>/complete \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"date":"2026-09-24"}'
```

## MCP

Kinwall exposes an [MCP](https://modelcontextprotocol.io) server at `POST/GET/DELETE /mcp` (Streamable HTTP), so an AI assistant can answer "what's on Saturday?", add events, complete chores, or check the leaderboard - using the same bearer keys and scopes as the REST API. Tools cover events, chores, lists, categories, members and notifications (each tagged read-only / write / delete, so clients can set permissions per group). Family members, lists and categories can be referenced by name (e.g. `"member": "Max"`) instead of an id.

Two ways to authenticate:
- **OAuth (sign-in)** - for clients that can't send a header, like **Claude connectors** (Settings → Connectors → Add custom connector → `https://<host>/mcp`). You approve the app on Kinwall's consent screen with your passkey, choosing *Full* or *Everyday* access; connected apps are listed (and revocable) under Settings → Access.
- **Bearer key** - any API key in an `Authorization` header, as below.

**Claude Code:**

```bash
claude mcp add --transport http kinwall https://<host>/mcp --header "Authorization: Bearer <key>"
```

**Claude Desktop / generic MCP clients** (`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "kinwall": {
      "url": "https://<host>/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

Use a **display** key for a read-mostly assistant (it can still add/complete events and chores, just not manage accounts, keys or webhooks); use an **admin** key only if the assistant needs to add members or manage calendars/webhooks.

## Configuration

| Variable | Default | |
|---|---|---|
| `PUBLIC_URL` | | Base URL used for OAuth redirects and the passkey rpID. Also settable in Settings → Calendar providers; the env var always wins |
| `WEBAUTHN_RP_ID` | hostname of `PUBLIC_URL` | Passkey rpID override, for multi-tenant hosts serving families on subdomains (e.g. `example.com` for `smiths.example.com`). The instance's origin must be that host or a subdomain of it |
| `ADMIN_API_KEY` | | Bootstrap admin key. If unset (Docker), one is generated and logged on first boot |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` | generated into `DATA_DIR` | 32 random bytes, base64. Required on Workers |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in. Also settable in Settings → Calendar providers, which wins over these when set; for hosts running many families behind one OAuth app |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | `common` | Microsoft sign-in. Also settable in Settings → Calendar providers, which wins over these when set; for hosts running many families behind one OAuth app |
| `OAUTH_REDIRECT_URI` | | One fixed redirect URI on the host's domain (e.g. `https://app.example/oauth/callback`) used with the env credentials above, for hosts running many families behind one OAuth app; the host routes callbacks by `state` (see SPEC "Embedding the server") |
| `SYNC_INTERVAL_MINUTES` | `10` | Docker only; Workers uses the cron in `wrangler.toml` |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | generated, stored encrypted | Web Push signing keys. Optional — a key pair is generated on first use and kept encrypted in settings; set all three to pin your own |
| `CORS_ORIGINS` | | Comma-separated origins allowed to call the API from a browser |
| `ALLOW_PRIVATE_FEED_URLS` | | Set to `1` to let ICS/CalDAV URLs point at private/LAN addresses (e.g. Radicale or Baïkal at `192.168.x.x`). Warning: anyone with an admin key can then make the server fetch internal URLs. Webhooks stay public-only |
| `HOST_PORTAL_URL` | | For hosts running Kinwall for other families: a page you serve where a family can manage or delete their instance, linked from Settings → Access → Your data |
| `PORT`, `DATA_DIR` | `8080`, `./data` | Docker/Node only |

## Your data

Settings → Access → Your data downloads everything your family entered as one JSON file (no passwords or calendar logins), and imports such a file into another Kinwall, merging by id. An import restores settings, members, categories, chores, lists, your local calendars with their events, and every synced calendar's colour, members and default category plus the member and category tags you put on its events. Synced calendars come in disconnected: reconnect each once (connect the Google/Outlook/CalDAV account again and add the same calendar, or give an ICS calendar its feed URL) and its events are re-fetched with your settings and tags intact. Passkeys and webhooks need setting up again.

## Security

- Calendar credentials (OAuth refresh tokens, CalDAV passwords, secret ICS URLs) and webhook secrets are encrypted at rest (AES-256-GCM) and never returned by the API.
- API keys are stored as SHA-256 hashes and shown once. Revoke a lost iPad's key in Settings.
- Recovery codes: setup (or Settings → Access) gives you 8 one-time codes. If every passkey device is lost, **Use a recovery code** on the sign-in screen signs you in for 30 days so you can add a new passkey. Codes are stored as hashes, each works once, generating a new set cancels the old one, and sign-in attempts are rate-limited (10 per hour per address, 30 per hour overall).
- OAuth uses PKCE and single-use state, and only asks Google for the calendar scopes it needs.
- Event text from external calendars is rendered as plain text. A strict Content-Security-Policy is set on all responses.
- Exposing it to the internet: on Workers, put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of the UI (free for ≤ 50 users) with a service-token bypass for `/api/*`. On Docker, prefer Cloudflare Tunnel or Tailscale over port forwarding. The Home Assistant add-on uses ingress, so there is no open port.

## Development

```bash
cd server && npm ci && npm run dev          # API on :8080 (Node, SQLite in ./data)
cd web && npm ci && npm run dev             # UI on :5173, proxies /api; reachable from an iPad on your LAN
VITE_MOCK=1 npm run dev                     # UI with in-memory fake data, no server needed
cd server && npm run dev:worker             # same API on the Workers runtime with local D1
                                            # (put ENCRYPTION_KEY in a .dev.vars file at the repo root)
cd server && npm test && npm run typecheck
```

Architecture and API contract: [SPEC.md](SPEC.md). Server code is TypeScript that Node 24 runs directly (no build step). The same Hono app runs on Workers with D1, or on Node, where a small adapter makes `node:sqlite` look like D1.

## Built with Claude

Kinwall is built by John Duprey with [Claude Code](https://claude.com/claude-code).

## Support the project

Kinwall is free and self-hostable. If it's on your wall, [sponsoring on GitHub](https://github.com/sponsors/JohnDuprey) helps keep it that way.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
