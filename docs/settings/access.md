# Settings → Access

*Admin only.* This tab is hidden on displays. It's everything about who and what can reach your Kinwall.

When you have only one way in, a banner at the top suggests **Passkeys** or **Recovery codes**. **Not now** hides it for 30 days on that device.

## Displays

Paired wall screens, each with its display key. **Add a display** opens a sheet asking for the 6-digit **Code** shown on the screen and a **Name**, then **Pair display**. Scanning the display's QR code with your phone works too. Removing a display signs it out. See [Put it on the wall](../getting-started/put-it-on-the-wall.md).

## Notifications

Every device that has turned on push, with when it was added and when it last received a notification. You can remove devices here. **Send a message** (Title, Message, To, **Send now**) pushes a one-off message. See [Notifications](../using/notifications.md#sending-a-message-now).

## Passkeys

Add a passkey on this device, **Use a security key or another device**, **Add a passkey on another device** (QR), rename, remove, and **Sign out**. See [Sign-in & security](../using/sign-in-and-security.md#passkeys).

## Recovery codes

"*N* of 8 left", **Generate recovery codes** or **Generate new codes**. See [Sign-in & security](../using/sign-in-and-security.md#recovery-codes).

## Connected apps

Apps connected through OAuth sign-in, such as a Claude connector pointed at `https://<your-kinwall>/mcp`. Each shows **Full access** or **Everyday access**, when it was connected and when it was last used. Delete one to disconnect it ("It will need to be approved again to use Kinwall"). See [MCP server](../integrations/mcp.md).

## API Keys

Admin keys for scripts and automations. **New admin key** shows the key once, with **Copy key**. Display keys are managed under **Displays** instead. See [REST API](../integrations/rest-api.md).

## Webhooks

**New webhook**: a **URL** and the **Events** to send (chips for all 13 event types), then **Add webhook**. Its signing secret is shown once, with **Copy**. **Rotate secret** replaces it (the new one is also shown once); delete from the list. See [Webhooks](../integrations/webhooks.md).

## Your data

* **Download export**: everything your family entered, as one JSON file.
* **Import from a Kinwall export**: merges a file back in, after a confirmation that lists what it contains.
* **Manage or delete this family**: only when your host set `HOST_PORTAL_URL`.

See [Export & import](../your-data/export-import.md).

## Hosting activity

This section appears only when someone hosts Kinwall for you *and* has acted on your family's instance, for example a restore, a migration or a deletion notice. It lists each action, how long ago it happened and any detail. Kinwall itself never writes these entries, so self-hosters never see this section. API: `GET /api/host-events` (the last 100).
