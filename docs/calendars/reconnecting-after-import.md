# Reconnecting after import

An [import](../your-data/export-import.md) brings back every calendar's **name, color, members and default category**, plus the member, category and travel-time tags on its events, including tags set for a whole series of a recurring event. What it can't bring back is **logins**: the export contains no passwords or OAuth tokens.

## How calendars come back

| Kind | After import |
|---|---|
| Local | Complete, with all events. |
| ICS | **Connected**: the feed URL is in the export, and it syncs straight away (if the URL passes the [private-address check](private-feeds.md)). |
| ICS without a usable URL | A placeholder with a **Reconnect** button. Paste the feed URL. |
| Google, Microsoft, CalDAV | A **placeholder**: kept, shown in Settings, not syncing. It shows "Reconnect this calendar to resume syncing". |

## Reconnecting a Google, Outlook or CalDAV calendar

1. **Settings → Calendars → Connect Google / Connect Outlook / + CalDAV**, signing in to the same account.
2. The **Calendars for *account*** picker marks matching calendars **will reconnect** and ticks them for you. Tap **Add N calendars**.
3. Kinwall re-attaches the placeholder (matched by account kind and remote calendar ID), keeps its settings, and fetches events again. Your tags are re-applied because they're keyed by the provider's event IDs.

Through the API: `POST /api/calendars` with the same `kind` and `remoteId` re-attaches a placeholder, and `PATCH /api/calendars/{id} {url}` does the same for ICS. Calendars carry `needsReconnect: true` until then.

Passkeys and webhooks aren't imported. Set them up again on the new instance.
