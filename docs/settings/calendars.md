# Settings → Calendars

*Admin only.* This tab is hidden on displays.

## Calendars

Each calendar row shows its color, name, kind and status: "Synced *time*", "Never synced", "Local calendar", or the last error. Row actions:

* **Sync now**: synced calendars only.
* **Reconnect**: for an imported ICS calendar that has no URL. See [Reconnecting after import](../calendars/reconnecting-after-import.md).
* **Remove**: "Remove this calendar and its events from Kinwall?" Nothing is deleted from the original calendar.
* Tap the row to open **Edit calendar**:
  * **Name** and **Color**.
  * **Members**: whose calendar it is. Its events are tagged with these members unless tagged otherwise.
  * **Default category**: "Applied to events here with no keyword match or their own category."
  * **Enabled**: when off, the calendar stops syncing and its events are hidden.

Add buttons:

| Button | Does |
|---|---|
| **+ Local calendar** | A Kinwall-only calendar (**Add local calendar**: a name; it gets the next unused color, and you can change the rest in **Edit calendar**). |
| **+ ICS URL** | [ICS feed](../calendars/ics-feeds.md). |
| **+ CalDAV** | [iCloud & CalDAV](../calendars/icloud-caldav.md). |
| **Connect Google** | [Google](../calendars/google.md). Greyed out until a Google client is configured. |
| **Connect Outlook** | [Microsoft / Outlook](../calendars/microsoft.md). Greyed out until configured. |

After connecting an account, **Calendars for *account*** lists its calendars. Pick members, then **Add calendar** on each one you want.

## Calendar providers

* **Public URL**: the base URL used for OAuth redirect URIs and the passkey domain, for example `https://cal.home.example`. The server warns about a bare IP address or plain `http` on a non-localhost host. If `PUBLIC_URL` is set in the environment, this shows "Set via PUBLIC_URL" and is locked.
* **Google** and **Microsoft** cards: **Client ID**, **Client secret** (leave blank to keep the saved one), **Tenant** (Microsoft), **Redirect URI** with copy, setup steps, **Save**, **Remove** and **Test sign-in**. Credentials that come from environment variables show "Provided by your host" and are read-only.

Client secrets are encrypted at rest and never returned. See [Configuration](../self-hosting/configuration.md) for precedence rules.
