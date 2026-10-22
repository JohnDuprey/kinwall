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
| `ALLOW_PRIVATE_FEED_URLS` | — | `1` lets ICS and CalDAV URLs, and recipe links (cards, photos and pages to import), point at private/LAN addresses, as an IP or as a name that resolves to one (on Node, Kinwall otherwise checks the address it connects to). Webhooks are unaffected. See [Private / LAN feeds](../calendars/private-feeds.md). |
| `ALLOW_PRIVATE_WEBHOOK_URLS` | — (`1` under the Home Assistant add-on) | `1` lets webhooks target private/LAN receivers, as an IP or as a name that resolves to one, e.g. Home Assistant on the same network. Calendar feeds and recipe links are unaffected. |
| `REQUIRE_PASSKEY_SETUP` | — | `1` makes the setup wizard's passkey step required (no recovery-code fallback when the browser can't make one), for hosts where there's no `ADMIN_API_KEY` or server log to fall back on. A claimed instance with no passkey yet reopens the wizard at that step. `GET /api/setup` reports `passkeyRequired` and `hasPasskey`. |
| `HOST_PORTAL_URL` | — | For hosts running Kinwall for other families: a page where a family can manage or delete their instance. It's linked from **Settings → Access → Your data**. |
| `PLUGIN_CATALOG_URL` | `https://app.kinwall.family/plugins/catalog.json` | Where the list of reviewed activity plugins comes from (fetched hourly). See [Building activity plugins](../contributing/plugins.md#getting-reviewed). |
| `PLUGINS_CATALOG_ONLY` | — | `1` allows only reviewed plugins: no other repositories and no uploads. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID`, `APNS_SANDBOX` | — | Apple push for native alerts and the iPhone app's Live Activities. See [below](#live-activities-apple-push). |
| `PORT` | `8080` | Docker/Node only. |
| `DATA_DIR` | `./data` (`/data` in the image and the Home Assistant add-on) | Docker/Node only. Holds `kinwall.sqlite` and `encryption.key`. |
| `TZ` | system | Docker/Node: the fallback timezone until the household sets one. |
| `PHOTO_FOLDER` | — | Docker/Node only. A folder of pictures (for example `/photos`, mounted read-only) that the Night screen and the Board can show. See [Photo folder](#photo-folder). |

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

### Photo folder

Point `PHOTO_FOLDER` at a folder of pictures you already keep on the server or a network share, and wall screens can show them in the [Night screen slideshow](../using/night.md#screensaver) and on the Board's picture card, without copying them into Kinwall. In Docker, mount the folder read-only:

```yaml
    volumes: ["./data:/data", "/mnt/nas/photos:/photos:ro"]
    environment:
      PHOTO_FOLDER: /photos
```

* Subfolders count. Folders whose names start with `.`, `@` or `#` (thumbnails and recycle bins that NAS boxes add, like `@eaDir`) are skipped.
* JPEG, PNG, WebP, GIF and AVIF pictures are shown. HEIC, RAW and videos are skipped, since most browsers can't show them.
* The name of the folder a picture is in shows as its caption, so a folder called `2024 Beach day` captions its pictures "2024 Beach day". Pictures at the top of the folder have no caption.
* Kinwall only reads the folder, about once an hour, so new pictures show up within the hour. Each picture is sent to the screen as it is, at full size.
* Every signed-in device of the family can see these pictures, wall screens included, so only point it at pictures you're happy to have on the wall.

### Live Activities (Apple push)

The Kinwall app for iPhone shows a person's next leave-by or start-prep time as a Live Activity. While the app is open it starts one itself. For the phone to get one while the app is closed, and to have it end right when the event starts, the server pushes it through Apple. That's off, and does nothing, until all four of these are set:

* `APNS_KEY_ID`: the key's ID, from an Apple Developer account's **Certificates, Identifiers & Profiles → Keys** (a key with **Apple Push Notifications service** turned on).
* `APNS_TEAM_ID`: the account's team ID.
* `APNS_KEY`: the key's `.p8` file, its whole contents (a secret: `wrangler secret put APNS_KEY` on Workers).
* `APNS_BUNDLE_ID`: the app's bundle ID, `family.kinwall.app` for the Kinwall app.
* `APNS_SANDBOX` (optional): `1` for apps installed from Xcode, which use Apple's development server.

The app registers its tokens with `PUT /api/live-activities/tokens`, for its own device. They're stored encrypted, never shown or logged, and deleted when the device is removed under Settings → Access or signs out. A push goes only to the person's own phone (its owner is them), from their first [transition reminder](../settings/family.md#transition-reminders) until the event starts, and not during the family's [night hours](../using/night.md#reminders-at-night) while reminders are held.

Apple only accepts HTTP/2. Docker and Node send with Node's HTTP/2 client. A deployed Cloudflare Worker sends with a plain `fetch`, which reaches Apple over HTTP/2 from Cloudflare's edge; local `wrangler dev` on macOS can't, so test pushes on a deployed Worker. A host can also pass its own sender as `APNS_SEND` (optional; see [Embedding the server](../contributing/embedding.md)).

**Self-hosted servers and the Kinwall app:** a self-hosted server cannot send to the official app with an unrelated developer team's key. The [push gateway](#push-gateway) uses credentials scoped to each device, without distributing the publisher's Apple signing key.

### Todoist, Google Tasks and Microsoft To Do

[To-do apps](../using/todo-apps.md) need no variables of their own. Todoist uses each family's own API token, kept encrypted with `ENCRYPTION_KEY`. Google Tasks uses the Google client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` or the UI) with the **Google Tasks API** enabled and the `https://www.googleapis.com/auth/tasks` scope on its consent screen ([Google](../calendars/google.md#google-tasks)). Microsoft To Do uses the Microsoft app with the delegated `Tasks.ReadWrite` permission added ([Microsoft](../calendars/microsoft.md#microsoft-to-do)). Lists sync on the calendar sync interval (`SYNC_INTERVAL_MINUTES`) and a few seconds after a change in Kinwall.

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

Ordinary native alerts use the same APNs credentials as Live Activities, with the app's normal
bundle topic. These credentials must belong to the team signing that app; a self-hosted server
cannot send to the official Kinwall app using an unrelated developer team's key. Never distribute
the official private key to self-hosted servers or bundle it in the app. Without matching
credentials or a verified gateway registration, native local reminders remain available.

### Push gateway

The server can forward native alerts and Live Activities to `https://push.kinwall.family` using
a credential issued for a specific phone token, server origin and push type. Configure `PUBLIC_URL`
or save your server's public address in **Settings → Calendars → Calendar providers** to identify
your Kinwall server. The environment variable takes precedence over the saved address.
Gateway delivery activates when the app registers its device
credential. No gateway address or separate enable switch is needed. The server needs no Apple signing key. It makes outbound
HTTPS requests only; the home server does not need a public inbound endpoint.
Credentials are sent only to this fixed gateway; the server refuses gateway redirects.

The official production iOS app verifies its installation with Apple App Attest before obtaining
a device credential. It keeps the credential in secure device storage, renews it before expiry
when the app refreshes, and revokes it on sign-out or a server change. Builds without App Attest
keep local reminders. A phone keeps its local medicine reminders until registration succeeds;
expired gateway registrations allow local scheduling again on the next reminder refresh. Direct APNs
takes precedence when its credentials are configured.

Device credentials are verified and stored encrypted. Expired or rejected credentials require
registration again; temporary delivery failures leave the registration intact. Failed medicine
alerts get at most two further attempts over ten minutes. Pending text is encrypted and discarded
when its dose log, schedule, recipient or privacy settings change. A timeout can still cause a
duplicate alert if Apple accepted the first request; registration does not guarantee delivery.

The gateway and Apple can read notification text. Medicine names remain off unless explicitly
enabled for that device. The gateway does not make the home server reachable when tapping a
notification, and remote delivery still depends on the server and gateway being available.
