# Settings → Access

*Admin only.* This tab is hidden on displays. It's everything about who and what can reach your Kinwall.

When you have only one way in, a banner at the top suggests a second parent device (**Parent devices**) or **Recovery codes**. **Not now** hides it for 30 days on that device.

## This device

On a parent's phone or computer: **Whose device is this?** picks a grown-up, or **No one in particular**. A device that belongs to someone opens their [private journal](../using/journal.md#private-journals) (Alex's journal also offers **This is Alex's device**), and is their own device everywhere else too: opening Kinwall on it starts their day for ["When I start my day" medicines](../using/medications.md), "Anyone" chores completed through the API without a name count for them, and their personal reminders (medicines, event heads-ups) go to it. It still acts for everyone, like any parent device. Connected apps (like Claude) are never anyone's own device. Signed in with a passkey, the passkey remembers it for later sign-ins too; in the Kinwall app it's the same as the app's "Whose device is this?". A full-access device can only belong to a grown-up. The setup admin key and a sign-in with a recovery code (or the hosted service's support sign-in) can't belong to anyone. Every change is logged in [Security activity](#security-activity) ("Alex's phone now belongs to Alex"), and that person's own devices get a 🔒 note in their [notifications](../using/notifications.md#notification-feed).

## Paired devices

Wall screens and kids' tablets or phones, paired with a code. Each has a display key: the calendar, chores and lists, but not settings. On chores, a display ticks them off and undoes that; adding, editing and deleting chores needs a parent device. **Add a wall screen or kid's device** opens a sheet asking for the 6-digit **Code** shown on the screen, a **Name** and **What is this device?**, then **Add it**:

* **🖼️ Wall screen (whole family)**: shared by everyone. The screen turns on **Use as a wall screen** by itself.
* **A kid's device** (pick the kid): shows only that kid's things.

A paired device is never a grown-up's (anyone marked a grown-up in [Settings → Family](family.md)): whoever approves a code would otherwise get a device that opens that grown-up's [private journal](../using/journal.md#private-journals). Grown-ups sign in on their own phone or computer with a passkey, then pick themselves under [This device](#this-device). Scanning the screen's QR code with your phone works too. The list is grouped the same way: **Wall screens**, **Kids' devices**, and **Not set yet** for displays paired before owners existed. A device paired as a grown-up's before this rule shows under **⚠️ Needs a fix**: it keeps working and stays pinned to that grown-up, but no longer opens their private journal. Make it a wall screen or a kid's device, or remove it and sign in there with a passkey. Nothing was removed or changed for you. A device that belongs to one member shows only their events, chores and lists, and credits "Anyone" chores done there to them. The device itself can't change this; each one in the list has a picker to change it here. Removing a device signs it out. A phone's widgets and Apple Watch aren't paired devices: they show indented under the phone, app sign-in or [API key](#api-keys) that made them, and removing or disconnecting that signs them out too, so none are left behind. Ones whose phone isn't listed (most were made before Kinwall kept track of their phone) show at the bottom under **Widgets and Watch**; they keep working, and you can remove any you don't recognize (the phone makes new ones when it signs in again). Parents' own phones and computers are under [Parent devices](#parent-devices), keys for scripts under [API Keys](#api-keys) and apps under [Connected apps](#connected-apps). A device that belongs to a member opens that member's [private journal](../using/journal.md#private-journals), so pairing one for someone, or changing whose it is, is logged in [Security activity](#security-activity) and adds a 🔒 note to that member's own devices ("Maya's tablet now belongs to Maya. A kid's device."). See [Put it on the wall](../getting-started/put-it-on-the-wall.md).

What a display can change on the calendar:

* A **kid's device** (one that belongs to a member) can add, change and delete events only on calendars that are for that member (**Members** in **Settings → Calendars → Edit calendar**). Everyone else's events are read-only there, and without a calendar of their own the kid can't add events. Its widgets and Apple Watch follow the same rule.
* A **Shared** wall screen can change events on any calendar.
* Either way, a calendar with **Wall screens and kids' devices can edit** turned off is read-only on every display. Parents' devices are never limited.

See [Who can change events](../using/events.md#who-can-change-events).

## Notifications

Every device that has turned on push, with when it was added and when it last received a notification. You can remove devices here. **Send a message** (Title, Message, To, **Send now**) pushes a one-off message. See [Notifications](../using/notifications.md#sending-a-message-now).

## Parent devices

Phones and computers that sign in with a passkey. Parents (admins) can change everything. **Add a passkey on this phone or computer**, **Use a security key or another device**, **Add another parent's phone or computer** (a QR code to scan there), rename, remove, and **Sign out**. See [Sign-in & security](../using/sign-in-and-security.md#passkeys).

## Recovery codes

"*N* of 8 left", **Generate recovery codes** or **Generate new codes**. See [Sign-in & security](../using/sign-in-and-security.md#recovery-codes).

## Connected apps

Apps connected through OAuth sign-in, such as a Claude connector pointed at `https://<your-kinwall>/mcp` or the Kinwall app on a phone. Each shows **Full access** or **Everyday access**, when it was connected and when it was last used. Delete one to disconnect it ("It will need to be approved again to use Kinwall"). A connected app can't make itself keys, passkeys or recovery codes, so disconnecting it ends its access. The Kinwall app is the exception: it's a parent's or kid's own device. See [MCP server](../integrations/mcp.md#what-connected-apps-cant-do).

The Kinwall app also has a picker for whose device it is: **Anyone (whole family)** or one member, chosen on the consent screen ("Whose device is this?") and changeable here. What it does depends on the access:

* **Everyday access** (a kid's phone): like a paired display, the app shows only that kid's events, chores and lists. Like a paired device, it's a kid's or shared, never a grown-up's.
* **Full access** (a parent's phone): nothing is locked. The family filter starts on everyone and every member stays selectable. The owner is used for personal defaults, such as who notes are posted as and whose sticker book opens first, and it opens that grown-up's [private journal](../using/journal.md#private-journals) (only a grown-up's: a kid's journal never opens as private on a full-access phone).

The widgets and Apple Watch key the app makes from that sign-in follow it on a kid's device (everyday access), so they show only that child. On a parent's phone (full access) they're **Shared** and show the whole family, without opening anyone's private journal. They're listed under the app, as a line per key (**🧩 Widgets on iPhone**, **⌚ Apple Watch**), each with a remove button in case a phone is lost; disconnecting the app removes them too. An app signed in before this option shows **Anyone** until you pick someone. The phone you are using is marked **This device** and shows whose it is; change it from another parent device. Other connected apps (Claude and other MCP clients) have no owner.

### Let connected apps see health entries

Off by default. While it's off, Claude and other connected apps can't read or change the [Health](../using/trackers.md#health-) tracker: over MCP, whatever key it uses, and with a connected app's sign-in on the REST API, health entries are left out of lists and exports, and asking for one, adding, editing or deleting one is refused. Turn it on to let them work with health entries the way a parent's device does. Only a parent's own device can change it, never a connected app. Kinwall's own phone app and API keys you created below count as the family's own devices on the REST API and aren't affected. See [MCP server](../integrations/mcp.md#health-entries).

## API Keys

Admin keys for scripts and automations. **New admin key** shows the key once, with **Copy key**. Each key has a picker for who it belongs to: **Anyone (whole family)** or a grown-up, whose [private journal](../using/journal.md#private-journals) it then opens ([Security activity](#security-activity) says so, and so does a 🔒 note on their own devices). Display keys are managed under **Paired devices** instead. See [REST API](../integrations/rest-api.md).

## Webhooks

**New webhook**: a **URL** and the **Events** to send (chips for the event types), then **Add webhook**. Its signing secret is shown once, with **Copy**. **Rotate secret** replaces it (the new one is also shown once); delete from the list. See [Webhooks](../integrations/webhooks.md).

## Security activity

The family's security log, on parent devices only: passkeys added, renamed or removed, sign-ins and sign-outs, recovery codes made or used, devices paired, whose device something is, API and widgets keys, connected apps, the quiet-hours PIN and private journal changes. Each line says what happened, who did it and when ("Passkey "iPhone" added by 🦊 Alex · Tue 4:12 PM"); **Show more** loads older ones. Kept a year, up to 500, and it can't be cleared. A new passkey and a recovery-code sign-in also push to parents' phones. See [Sign-in & security](../using/sign-in-and-security.md#security-activity).

## Your data

* **Download export**: everything your family entered, as one JSON file.
* **Import from a Kinwall export**: merges a file back in, after a confirmation that lists what it contains.
* **Manage or delete this family**: only when your host set `HOST_PORTAL_URL`.
* **Deleting your family's data**: without `HOST_PORTAL_URL` (self-hosted), parents' devices see how to delete the family where Kinwall runs (Docker, Cloudflare or Home Assistant), with a link to [Deleting everything](../your-data/deleting-everything.md).

See [Export & import](../your-data/export-import.md).

## Hosting activity

This section appears only when someone hosts Kinwall for you *and* has acted on your family's instance, for example a restore, a migration or a deletion notice. It lists each action, how long ago it happened and any detail. Kinwall itself never writes these entries, so self-hosters never see this section. API: `GET /api/host-events` (the last 100).
