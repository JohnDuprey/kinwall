# Configuration

> New to this? Start with [the easy guide](../getting-started/self-host-quick-start.md).

Kinwall is configured with environment variables. On Docker and Node they're process environment variables. On Workers they're `[vars]` in `wrangler.toml` plus `wrangler secret put` for secrets. Kinwall never reads `process.env` outside the Node entry point, so an embedding host builds the same set itself. See [Embedding the server](../contributing/embedding.md).

## Server variables

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | — | The base URL, e.g. `https://cal.home.example`. Used for OAuth redirect URIs and as the passkey domain (without it, passkeys use the address the request came in on; in the Home Assistant app, the Home Assistant address the browser is on). It can also be set in **Settings → Calendars → Calendar providers**; the variable always wins. |
| `WEBAUTHN_RP_ID` | host of `PUBLIC_URL` | Passkey rpID override, for multi-tenant hosts that serve families on subdomains (e.g. `example.com` for `smiths.example.com`). The instance's origin must be that host or one of its subdomains. |
| `ADMIN_API_KEY` | — | A permanent admin key that also works as the first-run setup code. Without it, the setup code is printed to the log. |
| `ENCRYPTION_KEY` | generated into `DATA_DIR/encryption.key` (Docker) | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts credentials, secrets and [health entries](../your-data/privacy.md#health-entries). **Required on Workers**: without it, saving a health entry fails instead of storing it unencrypted. Keep it with your backups: a lost key can't be recovered, and changing it isn't supported yet. |
| `ENCRYPTION_KEY_FILE` | — | Docker/Node: read the key from this file instead (e.g. a Docker secret). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Google OAuth client. A client configured in the UI wins over these. |
| `GOOGLE_PHOTOS_ENABLED` | — | `1` to offer Google Photos at all. Off by default: it needs Google's Photos partner program. See [Google Photos](#google-photos). |
| `GOOGLE_PHOTOS_CLIENT_ID`, `GOOGLE_PHOTOS_CLIENT_SECRET` | — | Optional: a **TVs and Limited Input devices** OAuth client for Google Photos, used instead of the Google Calendar client when set. See [Google Photos](#google-photos). |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | — | Microsoft OAuth app. A UI-configured app wins over these. |
| `MS_TENANT` | `common` | Microsoft tenant. |
| `OAUTH_REDIRECT_URI` | — | For hosts running many families behind one shared OAuth app: one fixed redirect URI on the host's domain, used with the environment credentials. The host routes callbacks by `state`. See [Embedding the server](../contributing/embedding.md#shared-oauth-apps). |
| `SYNC_INTERVAL_MINUTES` | `10` | How stale a calendar must be before it syncs again. On Docker it's also the sync loop period. On Workers the cron runs every 5 minutes and uses this as the threshold. |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | generated, stored encrypted | Web Push signing keys. A key pair is created the first time it's needed. Set all three to pin your own. |
| `CORS_ORIGINS` | — | Comma-separated origins allowed to call the API from a browser. CORS is off otherwise. |
| `TRUST_PROXY` | — | `1` when one reverse proxy (Caddy, nginx, Traefik, Cloudflare Tunnel) sits in front and is the only way to reach the server: per-address limits (setup code, recovery and passkey sign-in, app registration, shared recipe pages) then use the last `X-Forwarded-For` entry, the one your proxy added. Without it Kinwall uses the connection's own address and ignores `X-Forwarded-For` and `CF-Connecting-IP`, so behind a proxy everyone shares one address (and one limit). **Don't set it when the port is reachable directly:** a client could send any `X-Forwarded-For` and dodge the limits. Not needed under the Home Assistant add-on's ingress, where all ingress traffic counts as one address. |
| `ALLOW_PRIVATE_FEED_URLS` | — | `1` lets ICS and CalDAV URLs, and recipe links (cards, photos and pages to import), point at private/LAN addresses. See [Private / LAN feeds](../calendars/private-feeds.md). |
| `ALLOW_PRIVATE_WEBHOOK_URLS` | — (`1` under the Home Assistant add-on) | `1` lets webhooks target private/LAN receivers, e.g. Home Assistant on the same network. |
| `REQUIRE_PASSKEY_SETUP` | — | `1` makes the setup wizard's passkey step required (no recovery-code fallback when the browser can't make one), for hosts where there's no `ADMIN_API_KEY` or server log to fall back on. A claimed instance with no passkey yet reopens the wizard at that step. `GET /api/setup` reports `passkeyRequired` and `hasPasskey`. |
| `HOST_PORTAL_URL` | — | For hosts running Kinwall for other families: a page where a family can manage or delete their instance. It's linked from **Settings → Access → Your data**. |
| `PLUGIN_CATALOG_URL` | `https://app.kinwall.family/plugins/catalog.json` | Where the list of reviewed activity plugins comes from (fetched hourly). See [Building activity plugins](../contributing/plugins.md#getting-reviewed). |
| `PLUGINS_CATALOG_ONLY` | — | `1` allows only reviewed plugins: no other repositories and no uploads. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID`, `APNS_SANDBOX` | — | Apple push for the iPhone app's Live Activities. See [below](#live-activities-apple-push). |
| `PORT` | `8080` | Docker/Node only. |
| `DATA_DIR` | `./data` (`/data` in the image and the Home Assistant add-on) | Docker/Node only. Holds `kinwall.sqlite` and `encryption.key`. |
| `TZ` | system | Docker/Node: the fallback timezone until the household sets one. |

### Google Photos

> **Off by default.** Google's Photos Ambient API only works for projects accepted into Google's [Photos partner program](https://developers.google.com/photos/partner-program/overview); without that, creating the family's Photos device fails with 403 PERMISSION_DENIED. Set `GOOGLE_PHOTOS_ENABLED=1` only with a partner-approved project.

[Google Photos on the Night screen](../using/photos.md#google-photos) uses Google's Photos Ambient API, which is made for photo frames and TVs. It can connect two ways. Try the first; use the second if Google refuses it.

**1. With your Google Calendar client (the default).** Kinwall uses the same web OAuth client as [Google Calendar](../calendars/google.md) (set in **Settings → Calendars**, or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and its redirect URI, so there's nothing new to register. It asks for the Photos permission on its own, separate from Calendar's.

1. In the [Google Cloud console](https://console.cloud.google.com/), in the project with your Google Calendar client, go to **APIs & Services → Library**, find **Photos Ambient API** and **Enable** it.
2. Under **Data access** (the OAuth consent screen's scopes), add `https://www.googleapis.com/auth/photosambient.mediaitems`, plus `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` (Kinwall shows which Google account is connected).

Google's documentation describes only the TV sign-in below for this API, so whether it accepts a web client can't be known ahead of time: only trying it tells. If it doesn't, the Night sheet says "Google didn't allow Photos with this app" (Google refused the permission for this client, or refused to set up the Photos device). Then use option 2. With either option, the same message means the project isn't a Photos partner yet (Google answers 403 PERMISSION_DENIED when creating the device, which the server log shows as `google photos refused at device`).

**2. With a TV client.** Google's documented way: a **TVs and Limited Input devices** client, where the parent enters a code at `google.com/device` (on a phone, or by scanning the sheet's QR code). No redirect URI is involved.

1. Enable the **Photos Ambient API** and add the scope, as above.
2. Under **APIs & Services → Credentials**, **Create credentials → OAuth client ID**, application type **TVs and Limited Input devices**. Copy its client ID and secret.
3. Set `GOOGLE_PHOTOS_CLIENT_ID` and `GOOGLE_PHOTOS_CLIENT_SECRET` (on Workers, `wrangler secret put` both) and restart. When they're set, new connections use this client instead of the Calendar one.

Things to know:

* **Keep the client.** Google ties the family's Photos device to the client that created it, and Kinwall refreshes the sign-in with that same client. Switching clients (or between the two options) means connecting Google Photos again.
* **Access isn't guaranteed.** The Ambient API is meant for photo-frame and TV makers. Whether Google enables it for a small personal project is unknown; if the API isn't listed or connecting fails, it isn't available to that project.
* **Verification.** `photosambient.mediaitems` is a sensitive scope. Until Google verifies the app for it, people connecting see "Google hasn't verified this app" and must choose **Advanced → Go to … (unsafe)** to continue, and an app in **Testing** only works for the test users you add (and its sign-ins expire after 7 days). An unverified app published to production is limited to about 100 users of sensitive scopes. Just your own family is well within that. Verification is requested on the consent screen's **Verification center** page.
* Google limits each family's Photos device to 240 photo-list requests a day. Kinwall asks for the list at most about once an hour, and only while a screen is showing Google Photos.

### Live Activities (Apple push)

The Kinwall app for iPhone shows a person's next leave-by or start-prep time as a Live Activity. While the app is open it starts one itself. For the phone to get one while the app is closed, and to have it end right when the event starts, the server pushes it through Apple. That's off, and does nothing, until all four of these are set:

* `APNS_KEY_ID`: the key's ID, from an Apple Developer account's **Certificates, Identifiers & Profiles → Keys** (a key with **Apple Push Notifications service** turned on).
* `APNS_TEAM_ID`: the account's team ID.
* `APNS_KEY`: the key's `.p8` file, its whole contents (a secret: `wrangler secret put APNS_KEY` on Workers).
* `APNS_BUNDLE_ID`: the app's bundle ID, `family.kinwall.app` for the Kinwall app.
* `APNS_SANDBOX` (optional): `1` for apps installed from Xcode, which use Apple's development server.

The app registers its tokens with `PUT /api/live-activities/tokens`, for its own device. They're stored encrypted, never shown or logged, and deleted when the device is removed under Settings → Access or signs out. A push goes only to the person's own phone (its owner is them), from their first [transition reminder](../settings/family.md#transition-reminders) until the event starts, and not during the family's [night hours](../using/night.md#reminders-at-night) while reminders are held.

Apple only accepts HTTP/2. Docker and Node send with Node's HTTP/2 client. A deployed Cloudflare Worker sends with a plain `fetch`, which reaches Apple over HTTP/2 from Cloudflare's edge; local `wrangler dev` on macOS can't, so test pushes on a deployed Worker. A host can also pass its own sender as `APNS_SEND` (optional; see [Embedding the server](../contributing/embedding.md)).

**Self-hosted servers and the Kinwall app:** only the app's publisher can sign pushes for the official Kinwall app (the `.p8` key belongs to that developer account), so a self-hosted server can't send Live Activity pushes to it with keys of its own. The plan is a push gateway at push.kinwall.family (itself a Worker) that relays them for self-hosted servers. It doesn't exist yet; until then, the app starts leave-by activities itself while it's open.

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
