# Settings → Calendars

*Admin only.* This tab is hidden on displays.

## Calendars

**Default calendar for new events** is at the top: where new events go unless someone picks another calendar. It's what the event sheet's **Calendar** starts on, and what the phones' share sheets, the **Add to Kinwall** action, the API and AI assistants use when no calendar is named. Tap it to pick from the calendars you can add events to, or **Automatic**, which shows the calendar Kinwall picks:

1. The family's own Kinwall (local) calendar, not one an automation fills in (like the Home Assistant meal kit blueprint's calendar).
2. Otherwise the first writable calendar by name that isn't filled in by an automation, such as a shared Google calendar.
3. Otherwise any writable calendar.

A picked calendar that's removed, turned off or becomes read-only falls back to **Automatic** until you pick another. Only parents' devices can change it.

Each calendar row shows its color, name, kind and status: "Synced *time*", "Never synced", "Local calendar", or the last error. Row actions:

* **Sync now**: synced calendars only.
* **Reconnect**: for an imported ICS calendar that has no URL. See [Reconnecting after import](../calendars/reconnecting-after-import.md).
* **Reconnect**: for a Google or Outlook calendar whose sign-in was turned down. The row says so in plain words, for example "Google stopped letting Kinwall see Maya's calendar. Reconnect it to start syncing again.", with the account to sign in as. On a kid's Google calendar it adds "If Maya's Google account is supervised with Family Link, a parent may need to approve Kinwall there too." **Reconnect** starts the same sign-in as **Connect Google**; sign in as that account and its calendars sync again right away, with their settings kept. See [When a calendar stops syncing](../calendars/sync.md#when-a-calendar-stops-syncing).
* **Remove**: "Remove this calendar and its events from Kinwall?" Nothing is deleted from the original calendar.
* Tap the row to open **Edit calendar**:
  * **Name** and **Color**.
  * **Members**: whose calendar it is. Its events are tagged with these members unless tagged otherwise. A kid's device can change only events on calendars that are for them.
  * **Default category**: "Applied to events here with no keyword match or their own category."
  * **Filter**: which of its events the family sees: **All events**, only events that match, or all except them, by words in the title, all-day or timed, and category, with presets like **School: days off & half days** and a preview of the next 3 months. See [Calendar filters](../using/calendar.md#calendar-filters).
  * **Hidden events**: events a parent hid one by one (or by series), with **Show again** on each. See [Hiding events](../using/calendar.md#hiding-events).
  * **Enabled**: when off, the calendar stops syncing and its events are hidden.
  * **Wall screens and kids' devices can edit**: on to start with. When off, only parents' devices add, change or delete its events; wall screens and kids' devices show them read-only. A kid's device only ever changes calendars that are for them. Read-only calendars (ICS feed links and read-only shared calendars) don't show this switch; they say they're read-only instead, and you can still filter them and hide events. See [Who can change events](../using/events.md#who-can-change-events).
  * **Calendar ID** at the bottom, for automations that name a calendar, like the Home Assistant meal kit blueprint's **Add dinners to calendar**.

Add buttons:

| Button | Does |
|---|---|
| **+ Local calendar** | A Kinwall-only calendar (**Add local calendar**: a name; it gets the next unused color, and you can change the rest in **Edit calendar**). |
| **+ ICS URL** | [ICS feed](../calendars/ics-feeds.md). |
| **+ CalDAV** | [iCloud & CalDAV](../calendars/icloud-caldav.md). |
| **Connect Google** | [Google](../calendars/google.md). Grayed out until a Google client is configured. |
| **Connect Outlook** | [Microsoft / Outlook](../calendars/microsoft.md). Grayed out until configured. |

After connecting an account, **Calendars for *account*** lists its calendars. Pick members, then **Add calendar** on each one you want.

Synced calendars bring each event's free/busy ("Show as") along from Google, Outlook, CalDAV and ICS, and write it back where the calendar is writable. There's no per-calendar setting: mark single events free in their edit sheet. See [Free or busy](../using/events.md#free-or-busy).

## Calendar providers

* **Public URL**: the base URL used for OAuth redirect URIs and the passkey domain, for example `https://cal.home.example`. The server warns about a bare IP address or plain `http` on a non-localhost host. If `PUBLIC_URL` is set in the environment, this shows "Set via PUBLIC_URL" and is locked.
* **Google** and **Microsoft** cards: **Client ID**, **Client secret** (leave blank to keep the saved one), **Tenant** (Microsoft), **Redirect URI** with copy, setup steps, **Save**, **Remove** and **Test sign-in**. Credentials that come from environment variables show "Provided by your host" and are read-only.

Client secrets are encrypted at rest and never returned. See [Configuration](../self-hosting/configuration.md) for precedence rules.
