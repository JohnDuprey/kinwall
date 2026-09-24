# Kinwall

An open-source, self-hosted family wall calendar and chore chart, built for a wall-mounted iPad.

- **One calendar for the family**: Google, Outlook/Microsoft 365, iCloud (CalDAV) and any ICS subscription URL, merged and color-coded per family member. Two-way for Google, Microsoft and CalDAV.
- **Chores**: recurring or one-off, per person or "anyone", with points and a satisfying tap-to-complete.
- **Touch-first UI**: week, day, month and schedule views, swipe to page, big targets, and it returns to today after 2 minutes idle.
- **API-first**: everything the UI does is in the REST API (OpenAPI docs at `/docs`), with signed webhooks for automations. Home Assistant integration: [kinwall-homeassistant](https://github.com/JohnDuprey/kinwall-homeassistant).
- **Runs anywhere**: Cloudflare Workers free tier, Docker (amd64/arm64), or the Home Assistant add-on.

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

**From GitHub (recommended):** fork the repo, then in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository** and pick your fork. Keep the default root directory `/` and deploy command `npx wrangler deploy`. The UI build runs from `wrangler.toml`, and the Worker applies its own database migrations.
2. **Settings → Build → Build command:** `sh scripts/cloudflare-config.sh`. It writes your account's settings, taken from **Build variables** on the same page, into the build's copy of `wrangler.toml`, so nothing account-specific is committed:
   - `D1_DATABASE_ID`: create a D1 database named `kinwall` under Storage & Databases, choosing the **Location** nearest you (or `npx wrangler d1 create kinwall --location enam`), and paste its ID. If you leave it out, the first deploy creates one automatically, but it lands near Cloudflare's build servers rather than near you (every query then crosses that distance), and dashboard edits such as adding a secret create Worker versions that can lose track of an auto-created database.
   - `CUSTOM_DOMAIN` (optional): e.g. `kinwall.example.com` on a zone in your account. It's served as a custom domain and `workers.dev` is turned off. Set domains this way, not only in the dashboard: each deploy applies `wrangler.toml`, which would remove a dashboard-only domain.
3. **Settings → Variables and Secrets**, as type *Secret*: `ENCRYPTION_KEY` (value from `openssl rand -base64 32`) and optionally `ADMIN_API_KEY` (any long random string, which also works as the first-run setup code).
4. Open your URL. Without `ADMIN_API_KEY`, the setup code is printed in the Worker's logs on the first visit.

**From the CLI:**

```bash
npx wrangler secret put ENCRYPTION_KEY    # value: openssl rand -base64 32
npx wrangler secret put ADMIN_API_KEY     # optional; also works as the setup code
npx wrangler deploy                       # from the repo root: builds, creates the database, deploys
```

Set the public URL in **Settings → Calendar providers** (or `PUBLIC_URL` in `wrangler.toml` `[vars]`) to your `*.workers.dev` URL or custom domain. The free tier is 100k requests/day, and each request or cron run gets 10 ms of CPU. Sync stays inside that limit: feeds that haven't changed are skipped by fingerprint, and Google/Microsoft/CalDAV sync in 31-day slices. If a very large ICS feed hits the CPU limit, move to Workers Paid ($5/mo).

## Put it on the wall

1. On the iPad, open `https://<your-kinwall>` in Safari. It shows a pairing code and QR code: scan it with your phone (approve with your passkey) or enter the code under Settings → Displays on an admin device.
2. Tap Share, then **Add to Home Screen**, and launch it from there (full screen).
3. iPad Settings: set Display → Auto-Lock to Never and turn on Guided Access (Accessibility) to lock the iPad to Kinwall.

On a display, Settings shows Household, Appearance, This display (navigation position, unpair) and Members (edit only). Admin functions (calendar accounts, displays, passkeys, API keys, webhooks, adding or removing members) don't appear; use an admin device for those.

## Connect calendars

Google and Microsoft OAuth credentials can be set up entirely in the UI now — no env vars or
restart needed. Go to **Settings → Calendar providers** (admin only): set a Public URL (used to
build the redirect URI — prefilled from the page's own origin), then open the Google or Microsoft
card, paste in a client ID/secret, and hit Save. Each card shows the exact redirect URI (with a
copy button) and a short numbered setup guide for that provider's console. The first-run setup
wizard offers the same form inline if you get to the calendars step before configuring a provider.

Environment variables (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`/`MS_CLIENT_SECRET`/`MS_TENANT`,
`PUBLIC_URL`) still work and always win over the UI-configured values — handy for a fleet-managed
or Home Assistant add-on install. When a provider is set via env var, its card shows "Configured
by server" and is read-only in the UI.

| Source | How |
|---|---|
| Any ICS URL | Settings → Calendars → Add ICS. Works with Google's "secret address in iCal format", Outlook's published calendars, school/sports feeds. Read-only. |
| Google | Settings → Calendar providers → Google (see above), or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Either way, create an OAuth client (Web application) in Google Cloud Console with the redirect URI shown on the card. Google requires HTTPS or `localhost` redirect URIs, so a bare LAN IP won't work. Use Workers, a domain with HTTPS, or complete sign-in from `http://localhost:8080` on the server itself. |
| Microsoft / Outlook | Settings → Calendar providers → Microsoft (see above), or set `MS_CLIENT_ID` / `MS_CLIENT_SECRET` (and `MS_TENANT` if not `common`). Register an app in Entra ID with the redirect URI shown on the card and delegated permissions `Calendars.ReadWrite`, `User.Read`, `offline_access`. |
| iCloud / CalDAV | Settings → Calendars → CalDAV. For iCloud use `https://caldav.icloud.com` and an [app-specific password](https://support.apple.com/102654). Note: Apple app-specific passwords can't be limited to calendars. If you only need to read, use a public ICS link instead. |

## API & automation

- Interactive docs: `/docs`. OpenAPI spec: `/openapi.json` (import it into n8n, Power Automate, Postman).
- Auth: `Authorization: Bearer <key>`. Keys are `admin` (everything) or `display` (household settings and member edits, full read+write on events and chores; no accounts, keys, webhooks, passkeys, displays, calendar management, or adding/removing members).
- Change detection: `GET /api/rev` returns a counter that increments on every write.
- Chore leaderboard: `GET /api/leaderboard?period=today|week|month` (default week) returns each member's points, completions and current streak for the period, ranked with tie handling.
- Webhooks: `POST /api/webhooks {url, events, secret}` sends `{type, data, at}` with header `X-Kinwall-Signature: sha256=<HMAC of body>`. Event types: `member.changed`, `calendar.changed`, `calendar.synced`, `events.changed`, `chore.changed`, `chore.completed`, `chore.uncompleted`, `settings.changed`.

```bash
# Mark a chore done from any automation
curl -X POST https://kinwall.example/api/chores/<id>/complete \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"date":"2026-09-24"}'
```

## MCP

Kinwall exposes an [MCP](https://modelcontextprotocol.io) server at `POST/GET/DELETE /mcp` (Streamable HTTP), so an AI assistant can answer "what's on Saturday?", add events, complete chores, or check the leaderboard - using the same bearer keys and scopes as the REST API. Tools: `get_household`, `list_events`, `create_event`, `update_event`, `delete_event`, `list_chores`, `complete_chore`, `uncomplete_chore`, `create_chore`, `get_leaderboard`, `add_member`. Family members can be referenced by name (e.g. `"member": "Max"`) instead of an id.

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
| `ADMIN_API_KEY` | | Bootstrap admin key. If unset (Docker), one is generated and logged on first boot |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` | generated into `DATA_DIR` | 32 random bytes, base64. Required on Workers |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in. Also settable in Settings → Calendar providers; the env vars always win |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | `common` | Microsoft sign-in. Also settable in Settings → Calendar providers; the env vars always win |
| `SYNC_INTERVAL_MINUTES` | `10` | Docker only; Workers uses the cron in `wrangler.toml` |
| `CORS_ORIGINS` | | Comma-separated origins allowed to call the API from a browser |
| `PORT`, `DATA_DIR` | `8080`, `./data` | Docker/Node only |

## Security

- Calendar credentials (OAuth refresh tokens, CalDAV passwords, secret ICS URLs) and webhook secrets are encrypted at rest (AES-256-GCM) and never returned by the API.
- API keys are stored as SHA-256 hashes and shown once. Revoke a lost iPad's key in Settings.
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

## License

MIT
