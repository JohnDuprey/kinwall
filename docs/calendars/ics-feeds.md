# ICS feeds

Any `https://` (or `webcal://`) iCalendar URL can be subscribed to **read-only**: school and sports schedules, holidays, Google's "secret address in iCal format", Outlook's published calendars, and public iCloud calendars.

## Add one

**Settings → Calendars → + ICS URL** opens **Add ICS calendar**: a **Name** and the **ICS URL**. The setup wizard offers the same thing as **🔗 Subscribe to a link**.

## Behaviour

* Events are read-only: no Edit or Delete. You can still tag **members**, set a **category** and add **travel time**. Those stay in Kinwall. See [Writable vs read-only](writable-vs-read-only.md).
* The feed URL is treated as a secret. It's encrypted at rest and never returned by the API. It *is* included in your own [export](../your-data/export-import.md), so an import reconnects the feed.
* If the feed hasn't changed since the last sync, Kinwall recognises it by fingerprint and skips it, which keeps CPU use low.
* Reminders (VALARMs) in the feed are used as the event's reminders.
* Redirects are followed, but each hop is checked again. Private and LAN addresses are refused unless you set `ALLOW_PRIVATE_FEED_URLS=1`. See [Private / LAN feeds](private-feeds.md).

On the Cloudflare free tier, a very large feed can exceed the 10 ms CPU limit. See [Cloudflare specifics](../self-hosting/cloudflare.md).
