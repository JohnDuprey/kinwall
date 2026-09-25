# Configuration

Kinwall is configured with environment variables. On Docker and Node they're process environment variables. On Workers they're `[vars]` in `wrangler.toml` plus `wrangler secret put` for secrets. Kinwall never reads `process.env` outside the Node entry point, so an embedding host builds the same set itself. See [Embedding the server](../contributing/embedding.md).

## Server variables

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | — | The base URL, e.g. `https://cal.home.example`. Used for OAuth redirect URIs and as the passkey domain. It can also be set in **Settings → Calendars → Calendar providers**; the variable always wins. |
| `WEBAUTHN_RP_ID` | host of `PUBLIC_URL` | Passkey rpID override, for multi-tenant hosts that serve families on subdomains (e.g. `example.com` for `smiths.example.com`). The instance's origin must be that host or one of its subdomains. |
| `ADMIN_API_KEY` | — | A permanent admin key that also works as the first-run setup code. Without it, the setup code is printed to the log. |
| `ENCRYPTION_KEY` | generated into `DATA_DIR/encryption.key` (Docker) | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts credentials and secrets. **Required on Workers.** |
| `ENCRYPTION_KEY_FILE` | — | Docker/Node: read the key from this file instead (e.g. a Docker secret). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Google OAuth client. A client configured in the UI wins over these. |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | — | Microsoft OAuth app. A UI-configured app wins over these. |
| `MS_TENANT` | `common` | Microsoft tenant. |
| `OAUTH_REDIRECT_URI` | — | For hosts running many families behind one shared OAuth app: one fixed redirect URI on the host's domain, used with the environment credentials. The host routes callbacks by `state`. See [Embedding the server](../contributing/embedding.md#shared-oauth-apps). |
| `SYNC_INTERVAL_MINUTES` | `10` | How stale a calendar must be before it syncs again. On Docker it's also the sync loop period. On Workers the cron runs every 5 minutes and uses this as the threshold. |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | generated, stored encrypted | Web Push signing keys. A key pair is created the first time it's needed. Set all three to pin your own. |
| `CORS_ORIGINS` | — | Comma-separated origins allowed to call the API from a browser. CORS is off otherwise. |
| `ALLOW_PRIVATE_FEED_URLS` | — | `1` lets ICS and CalDAV URLs point at private/LAN addresses. See [Private / LAN feeds](../calendars/private-feeds.md). |
| `ALLOW_PRIVATE_WEBHOOK_URLS` | — (`1` under the Home Assistant add-on) | `1` lets webhooks target private/LAN receivers, e.g. Home Assistant on the same network. |
| `REQUIRE_PASSKEY_SETUP` | — | `1` makes the setup wizard's passkey step required (no **Skip**), for hosts where there's no `ADMIN_API_KEY` or server log to fall back on. A claimed instance with no passkey yet reopens the wizard at that step. `GET /api/setup` reports `passkeyRequired` and `hasPasskey`. |
| `HOST_PORTAL_URL` | — | For hosts running Kinwall for other families: a page where a family can manage or delete their instance. It's linked from **Settings → Access → Your data**. |
| `PORT` | `8080` | Docker/Node only. |
| `DATA_DIR` | `./data` (`/data` in the image and the Home Assistant add-on) | Docker/Node only. Holds `kinwall.sqlite` and `encryption.key`. |
| `TZ` | system | Docker/Node: the fallback timezone until the household sets one. |

### Precedence for provider settings

* `PUBLIC_URL` from the environment **always wins**, and the UI field is locked.
* For Google and Microsoft, a household's **own UI-configured app wins as a unit**. The environment credentials are the fallback, typically a host's shared app. When only the environment configures a provider, its card shows "Provided by your host" and the API returns `409` on changes.

## Build and deploy variables

| Variable | Used by | Purpose |
|---|---|---|
| `D1_DATABASE_ID`, `D1_DATABASE_NAME`, `CUSTOM_DOMAIN` | `scripts/cloudflare-config.sh` (dashboard builds, the tag workflow) | Written into the build's `wrangler.toml`. |
| `KINWALL_DOMAIN`, `KINWALL_D1_LOCATION`, `KINWALL_ENCRYPTION_KEY`, `KINWALL_ADMIN_API_KEY` | `scripts/setup-cloudflare.mjs --yes` | Answers to the script's prompts. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | setup script, GitHub workflows | Cloudflare auth without an interactive login. |
| `CLOUDFLARE_DEPLOY`, `DEMO_PAGES_PROJECT` | GitHub repository variables | Turn on the tag deploy and the demo deploy. |
| `VITE_MOCK=1` | `web/` build | [Demo build](demo-build.md) with in-browser sample data. |
| `KINWALL_URL`, `KINWALL_KEY` | `scripts/seed-demo.mjs` | Target instance and admin key for seeding demo data. |

## Home Assistant add-on options

The add-on maps its options onto these variables. See [Home Assistant add-on](../getting-started/home-assistant-add-on.md).
