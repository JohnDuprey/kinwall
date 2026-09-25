# iCloud & CalDAV

CalDAV calendars (iCloud, Fastmail, Nextcloud, Radicale, Baïkal…) sync **two-way** with a username and password. No OAuth app is needed.

## Connect

**Settings → Calendars → + CalDAV** opens **Connect CalDAV**:

| Field | iCloud |
|---|---|
| **Account name** | e.g. "iCloud" |
| **Server URL** | `https://caldav.icloud.com` |
| **Username** | your Apple Account email |
| **App password** | an [app-specific password](https://support.apple.com/102654) |

After **Connect**, the calendar picker opens: tick the calendars you want, assign members, and tap **Add N calendars**. The setup wizard offers the same form under **🍎 iCloud (CalDAV)**, where **Next** becomes **Add N and continue**.

## Things to know

* The password is encrypted at rest and never returned by the API.
* Apple app-specific passwords can't be limited to calendars. If you only need to read, a public iCloud calendar link as an [ICS feed](ics-feeds.md) exposes less.
* Reminders on CalDAV events are read from the server and can't be edited in Kinwall.
* A CalDAV server on your LAN (`192.168.x.x`) is blocked unless you set `ALLOW_PRIVATE_FEED_URLS=1`. See [Private / LAN feeds](private-feeds.md).
