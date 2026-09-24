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

```bash
cd server && npm ci && (cd ../web && npm ci && npm run build)
npx wrangler d1 create kinwall            # paste the database_id into wrangler.toml
npx wrangler secret put ENCRYPTION_KEY    # value: openssl rand -base64 32
npx wrangler secret put ADMIN_API_KEY     # value: fc_ + a long random string
npm run deploy                            # applies migrations + deploys
```

Set `PUBLIC_URL` in `wrangler.toml` `[vars]` to your `*.workers.dev` URL or custom domain. The free tier is 100k requests/day, and each request or cron run gets 10 ms of CPU. Sync stays inside that limit: feeds that haven't changed are skipped by fingerprint, and Google/Microsoft/CalDAV sync in 31-day slices. If a very large ICS feed hits the CPU limit, move to Workers Paid ($5/mo).

## Put it on the wall

1. Open Settings, create a **display** API key, and open `https://<your-kinwall>/?key=<display key>` on the iPad. The key is saved on the device and removed from the URL.
2. Tap Share, then **Add to Home Screen**, and launch it from there (full screen).
3. iPad Settings: set Display → Auto-Lock to Never and turn on Guided Access (Accessibility) to lock the iPad to Kinwall.

A display key's Settings tab shows only a minimal "This display" card (paired-as, nav position, unpair) — no admin sections render at all. Manage members, calendars, accounts, API keys and webhooks from an admin device.

## Connect calendars

| Source | How |
|---|---|
| Any ICS URL | Settings → Calendars → Add ICS. Works with Google's "secret address in iCal format", Outlook's published calendars, school/sports feeds. Read-only. |
| Google | Create an OAuth client (Web application) in Google Cloud Console with redirect URI `<PUBLIC_URL>/api/oauth/google/callback`, then set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Google requires HTTPS or `localhost` redirect URIs, so a bare LAN IP won't work. Use Workers, a domain with HTTPS, or complete sign-in from `http://localhost:8080` on the server itself. |
| Microsoft / Outlook | Register an app in Entra ID with redirect URI `<PUBLIC_URL>/api/oauth/microsoft/callback` and delegated permissions `Calendars.ReadWrite`, `User.Read`, `offline_access`. Then set `MS_CLIENT_ID` / `MS_CLIENT_SECRET` (and `MS_TENANT` if not `common`). |
| iCloud / CalDAV | Settings → Calendars → CalDAV. For iCloud use `https://caldav.icloud.com` and an [app-specific password](https://support.apple.com/102654). Note: Apple app-specific passwords can't be limited to calendars. If you only need to read, use a public ICS link instead. |

## API & automation

- Interactive docs: `/docs`. OpenAPI spec: `/openapi.json` (import it into n8n, Power Automate, Postman).
- Auth: `Authorization: Bearer <key>`. Keys are `admin` (everything) or `display` (read household settings/members/calendars, full read+write on events and chores; no accounts, keys, webhooks, member/calendar management, or settings changes).
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
| `PUBLIC_URL` | | Base URL used for OAuth redirects |
| `ADMIN_API_KEY` | | Bootstrap admin key. If unset (Docker), one is generated and logged on first boot |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE` | generated into `DATA_DIR` | 32 random bytes, base64. Required on Workers |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | `common` | Microsoft sign-in |
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
                                            # (first: npx wrangler d1 migrations apply kinwall --local, and put ENCRYPTION_KEY in .dev.vars)
cd server && npm test && npm run typecheck
```

Architecture and API contract: [SPEC.md](SPEC.md). Server code is TypeScript that Node 24 runs directly (no build step). The same Hono app runs on Workers with D1, or on Node, where a small adapter makes `node:sqlite` look like D1.

## License

MIT
