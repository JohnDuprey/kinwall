# Sign-in & security

Kinwall has no usernames or passwords. Every request carries a **key**, and each key has a scope.

| Scope | Who has it | Can |
|---|---|---|
| **admin** | passkey sessions, recovery-code sessions, admin API keys, `ADMIN_API_KEY`, "Full access" connected apps | Everything. |
| **display** | paired wall displays, "Everyday access" connected apps | Read the household; create, edit and delete events, chores, categories and lists; change household settings; manage its own push subscription. It **can't** touch members, calendar accounts or calendar setup, keys, displays, passkeys, webhooks, export/import or notifications to other devices. |

## The sign-in screen

A device without a key shows **Welcome home 👋** with these options:

* **Sign in with passkey**: Face ID, Touch ID, your screen lock or a security key. This gives a **30-day admin session**.
* **Set up as a wall display**: starts pairing. See [Put it on the wall](../getting-started/put-it-on-the-wall.md).
* **Enter a key manually**: paste any API key.
* **Use a recovery code**: see below.

Passkey sign-in attempts are rate-limited to 20 per 10 minutes per address.

## Passkeys

**Settings → Access → Passkeys**:

* **Add a passkey on this device**: uses this phone or computer's built-in authenticator.
* **Use a security key or another device**: a hardware key (USB/NFC/Bluetooth) or a phone nearby over the hybrid flow. Passkeys created this way are labelled "Security key".
* **Add a passkey on another device**: shows a QR code with a one-time token, valid for 15 minutes, that lets another device register exactly one passkey.
* Rename a passkey, or remove it. Removing a passkey also signs out every session created with it. Removing the last one warns you first.
* **Sign out** ends this device's passkey session.

Passkeys are bound to your domain (the *rpID*). By default that's the host of `PUBLIC_URL`. Multi-family hosts can share one rpID across subdomains with `WEBAUTHN_RP_ID`. See [Configuration](../self-hosting/configuration.md).

## Recovery codes

Recovery codes are your way back in if every passkey device is lost.

* The setup wizard, or **Settings → Access → Recovery codes → Generate recovery codes**, creates **8 one-time codes** (format `XXXX-XXXX-XXXX`). They're shown once, with **Copy all** and **Download .txt**.
* The section shows "*N* of 8 left". **Generate new codes** replaces the set, and the old codes stop working at once.
* On the sign-in screen, **Use a recovery code** signs you in for **30 days**, so you can add a new passkey.
* Only hashes are stored. Attempts are limited to 10 per hour per address and 30 per hour overall.

While you have only one passkey or no unused recovery codes, **Access** shows a banner: "Add a second way in — a second passkey or recovery codes — so losing one device doesn't lock the family out." **Not now** hides it on that device for 30 days.

## Admin API keys

**Settings → Access → API Keys → New admin key**: give it a name. The key is shown **once**, with **Copy key**. Only a SHA-256 hash is stored, and the list shows each key's name and scope. Delete a key and anything using it stops working immediately.

`ADMIN_API_KEY` (an environment variable or secret) is always an admin key. It also works as the first-run setup code.

## Display keys

Pairing a display creates a **display** key named after the display. It's listed under **Settings → Access → Displays**. Removing it there signs the display out. You can also create display keys with `POST /api/keys` for a read-mostly automation.

## Sessions and tokens

| Kind | Lifetime |
|---|---|
| Passkey or recovery-code session | 30 days |
| OAuth access token (connected apps / MCP) | 1 hour, refreshed with a 90-day rotating refresh token |
| API key | Until deleted |

For what's encrypted and how data is stored, see [Privacy & what's encrypted](../your-data/privacy.md).

## Exposing Kinwall to the internet

* **Workers**: you can put Cloudflare Access in front of the UI as a second layer (free for up to 50 users), with a service-token bypass for `/api/*`.
* **Docker**: prefer Cloudflare Tunnel or Tailscale over port forwarding.
* **Home Assistant add-on**: it uses ingress, so there's no open port.
