# Sign-in & security

Kinwall has no usernames or passwords. Every request carries a **key**, and each key has a scope.

| Scope | Who has it | Can |
|---|---|---|
| **admin** | passkey sessions, recovery-code sessions, admin API keys, `ADMIN_API_KEY`, "Full access" connected apps | Everything. A connected app (Claude and other MCP clients) can't manage sign-ins, keys, passkeys, recovery codes, pairings or other connected apps; see [what connected apps can't do](../integrations/mcp.md#what-connected-apps-cant-do). |
| **display** | paired wall displays, "Everyday access" connected apps | Read the household; create, edit and delete events (on calendars that allow it); make lists and work on their items, and sort or group a list (renaming, archiving, deleting and reordering lists, and changing event categories, are for full access); complete chores (not add, edit or delete them); save a new color scheme to the family list; manage its own push subscription. It can't change the family's settings. It **can't** touch members, calendar accounts or calendar setup, keys, displays, passkeys, webhooks, export/import or notifications to other devices. |

### Whose device a key is

Paired displays and the Kinwall app's sign-in also record whose device it is: **Anyone (whole family)** or one member. A parent picks it when pairing a display (**What is this device?**: a wall screen or a kid's device) or on the app's consent screen (**Whose device is this?**), and can change it under [Settings → Access](../settings/access.md). The device itself can't. A paired device or an everyday-access sign-in is never a grown-up's, so approving a code never opens a grown-up's private journal.

* On a **display** key (a wall screen, a kid's device, an "Everyday access" app, and the app's widgets and watch), a member owner pins the view to that member, and **Shared** keeps it on the whole family. Either way the device can't pick its own filter.
* The app's widgets and Apple Watch get their own everyday-access keys, made by the phone's sign-in. They follow that phone: a kid's phone's widgets show only that kid, a parent's phone's widgets show the whole family (and never open anyone's private journal). Signing out, removing the phone or disconnecting its sign-in signs them out too.
* On an **admin** key (a parent's phone with "Full access"), the owner never locks anything. It only sets personal defaults, and the family filter works as on any parent device.

## The sign-in screen

A device without a key shows **Welcome home 👋** with these options:

* **Sign in as a parent**: with your passkey (Face ID, Touch ID, your screen lock or a security key). This makes it a parent device, with a **30-day admin session**.
* **Set up a wall screen or kid's device**: starts pairing; a parent approves it with a code. See [Put it on the wall](../getting-started/put-it-on-the-wall.md).
* **Enter a key manually**: paste any API key.
* **Use a recovery code**: see below.

Passkey sign-in attempts are rate-limited to 20 per 10 minutes per address.

## Passkeys

**Settings → Access → Passkeys**:

* **Add a passkey on this device**: uses this phone or computer's built-in authenticator.
* **Use a security key or another device**: a hardware key (USB/NFC/Bluetooth) or a phone nearby over the hybrid flow. Passkeys created this way are labeled "Security key".
* **Add a passkey on another device**: shows a QR code with a one-time token, valid for 15 minutes, that lets another device register exactly one passkey.
* Rename a passkey, or remove it. Removing a passkey also signs out every session created with it. Removing the last one warns you first.
* **Sign out** ends this device's passkey session.
* A passkey can belong to a grown-up: set it from a device signed in with it (**Settings → Access → This device**). Every later sign-in with it then opens that person's [private journal](journal.md#private-journals).

Passkeys are bound to your domain (the *rpID*). That's the host of `PUBLIC_URL` when it's set, otherwise the address you opened Kinwall at. Multi-family hosts can share one rpID across subdomains with `WEBAUTHN_RP_ID`. See [Configuration](../self-hosting/configuration.md).

Passkeys need https (or `localhost`) and a name rather than an IP address: on `http://192.168.1.20:8080` the browser offers none, so sign in with a recovery code or an admin key there. A passkey made at one address doesn't work at another, so if you open Kinwall at more than one (say, at home and through a remote address), add a passkey from each, or set `PUBLIC_URL` and always use that one. When the address doesn't match, Kinwall says which one passkeys are set up for. In the [Home Assistant app](../getting-started/home-assistant-add-on.md), passkeys follow the Home Assistant address you're on.

## Recovery codes

Recovery codes are your way back in if every passkey device is lost.

* The setup wizard, or **Settings → Access → Recovery codes → Generate recovery codes**, creates **8 one-time codes** (format `XXXX-XXXX-XXXX`). They're shown once, with **Copy all** and **Download .txt**.
* The section shows "*N* of 8 left". **Generate new codes** replaces the set, and the old codes stop working at once.
* On the sign-in screen, **Use a recovery code** signs you in for **30 days**, so you can add a new passkey.
* A recovery-code sign-in belongs to no one, so it never opens a [private journal](journal.md#private-journals).
* Only hashes are stored. Attempts are limited to 10 per hour per address and 30 per hour overall.

While you have only one passkey and no unused recovery codes, **Access** shows a banner: "Add a second way in — a second passkey or recovery codes — so losing one device doesn't lock the family out." **Not now** hides it on that device for 30 days.

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

## Security activity

**Settings → Access → Security activity** lists the latest 20 security events in plain words, newest first, with **Show more** for older ones: "Passkey "iPhone" added by 🦊 Alex · Tue 4:12 PM", "Recovery code used to sign in (7 left)", ""Kitchen wall" paired as a wall screen by Sam". It shows only on parent devices; wall screens and kids' devices never see it, and neither do connected apps.

It records:

* 🔑 passkeys added, renamed and removed, 👋 sign-ins with a passkey and 🚪 sign-outs;
* 🔐 recovery codes made, and a recovery code used to sign in (with how many are left);
* 📱 devices paired, and whose device something now is ("Alex's phone now belongs to Alex");
* 🗝️ API keys made and removed (removing a paired device too), and 🧩 a phone's widgets keys added and signed out;
* 🔌 connected apps approved and disconnected, including when Kinwall disconnected one because its sign-in was used twice;
* 🔢 the [quiet-hours PIN](night.md) set, changed or removed, and 📓 [private journal](journal.md#private-journals) changes.

Each line says who did it when that's known: the person whose device it was, or a device's or app's name. A recovery-code sign-in and the setup admin key belong to no one, so they show without a name.

Keys, tokens, codes, PINs and passkey IDs are never stored in it, only the names you gave things. Events are kept for a year, up to the newest 500, and can't be cleared. They're not in the [export](../your-data/export-import.md), webhooks or MCP. API: `GET /api/security-events` (see [REST API](../integrations/rest-api.md#security-activity)).

Security events don't go into the family's [notifications](notifications.md#notification-feed), with two exceptions that go to parents' phones as a push, since you'd want to know right away:

* **🔑 New passkey**: a new way to sign in as a parent. If it wasn't you, remove it.
* **🔐 Recovery code used to sign in**: the usual sign of someone getting in without a passkey.

And when a device now belongs to someone, or their private journal changes, that person's own devices still get a 🔒 note in their bell, since it's about who can read their journal (a kid can't see Security activity).

## Exposing Kinwall to the internet

* **Workers**: you can put Cloudflare Access in front of the UI as a second layer (free for up to 50 users), with a service-token bypass for `/api/*`.
* **Docker**: prefer Cloudflare Tunnel or Tailscale over port forwarding.
* **Home Assistant add-on**: it uses ingress, so there's no open port.
