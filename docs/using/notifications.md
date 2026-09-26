# Notifications

Kinwall sends standard **Web Push** notifications, signed with its own VAPID keys, straight to each browser or installed app. No app-store app or third-party push service is involved. The settings are **per device**: each phone picks what it wants.

## Turning them on

On the device that should get notifications, go to **Settings → General → Notifications** and tap **Turn on notifications**. Allow the browser prompt, then choose:

| Option | Default | What you get |
|---|---|---|
| **Event reminders** | on | A notification at each event's reminder time. |
| **Daily summary** + time | off, 07:30 | "Today": event and chore counts, the first event titles, and open linked tasks. |
| **Chore reminder** + time | off, 08:00 | "*N* chores left today", listing the first three. Sent only if something is still open. |
| **List updates** | off | "List updated — *Groceries* has new items". At most one per list every 10 minutes. |
| **Which family members?** | Everyone | Only events and chores for these people. A device following nobody gets everything. |

**Send test** sends "Notifications are on 🎉" to this device. **Turn off** unsubscribes it. Times use the household timezone.

## Event reminders

* A reminder fires at the event's reminder offset: its own reminder, or the household **Default reminder**. See [Events → Reminders](events.md#reminders).
* The notification's **title is the event name** (with its category emoji). The body is "In 30 minutes · 4:00 PM", then 📍 location, 👥 who, 🗓 calendar and a short note. Long-press to see all of it.
* With travel time and **remind before leave**, the first line reads "Leave by … for … · starts …".
* Tapping the notification opens that event in the calendar.
* A tick that was missed still fires once, within 10 minutes. Each reminder is sent only once per device.

## Daily summary

At the chosen time: "3 events · 2 chores — Soccer practice, Dentist…". If any of today's events have open [linked tasks](lists.md#linking-items-to-events), a "To do for today's events" section follows, with up to three tasks per event. Urgent tasks come first, marked ‼️, then high-[priority](lists.md#priority) ones, marked ⭐. If any list items are due today, a short "Due today: …" line follows (up to three, then "+N more").

## "Kinwall" under the title

iOS shows the sending app's name under each notification, so a reminder reads as the event title with "from Kinwall" beneath it. That's why the title is the event name and not "Kinwall". A notification whose payload carries no title falls back to "Kinwall".

## Sending a message now

On an admin device, **Settings → Access → Notifications** lists every subscribed device ("added …, delivered …" or "never delivered"). You can remove a device there. Below the list, **Send a message** takes a **Title**, a **Message** and **To** (members, or Everyone), then **Send now**. The message also lands in everyone's [notification feed](#notification-feed). The API equivalent is `POST /api/notify {title, body, memberIds?, url?}` (admin only), and the MCP tool is `send_notification`.

## Notification feed

Every notification Kinwall sends is also kept in the app, whether or not any device has push turned on. Tap the **bell** next to the family avatars in the header, on the wall and on phones. The red badge counts what's new since this device last opened the feed (shown as "9+" past nine).

* The **Notifications** sheet lists them newest first, grouped **Today**, **Yesterday**, then by date. Each shows an icon for its kind (🔔 reminder, ☀️ daily summary, ✅ chore reminder, 🛒 list update, 💬 message), the title, the first two lines, how long ago, and who it was for.
* Tapping one with a link opens it, just like tapping the push: a reminder opens its event, a chore reminder opens Chores.
* **Read state is per device**, like the other "on this device" settings. Opening the feed clears the badge; **Mark all read** clears the unread highlight in the list. A device's first visit starts caught up.
* The feed keeps the **household** copy: a reminder is listed once, not once per phone. The daily summary and chore reminder are listed once a day at their default times (07:30 and 08:00), or earlier if a device has picked an earlier time. They cover the whole family, since the wall isn't following anyone in particular.
* Admins get a **Send a message** button at the bottom of the sheet, the same form as in Settings → Access.
* Admins can also **remove** a notification (the × beside it) or **Clear all** from the top of the sheet. The feed is the household's one copy, so this clears it on every device; displays can only mark things read. The same via the API: `DELETE /api/notifications/:id` and `DELETE /api/notifications` (admin key).
* Display keys can read the feed. Entries older than 90 days are removed.
* The API is `GET /api/notifications?limit=50&before=<ISO time>` (newest first), and the MCP tool is `list_notifications`.

## Platform notes

* **iPhone / iPad**: needs **iOS 16.4 or later** and Kinwall **added to the Home Screen** (Share → Add to Home Screen), opened from there. Safari tabs can't receive push at all. Settings says so when it detects Safari.
* **Android**: works in Chrome, Firefox or Samsung Internet, installed or not. The status-bar icon is a single-color badge.
* **Desktop**: any browser with Push API support.
* A device whose push subscription has expired (the push service answers 404/410) is removed automatically. Turn notifications on again on that device.

## How often it checks

Reminders, summaries and nudges are scheduled independently of calendar sync: every 5 minutes on Cloudflare Workers (cron) and every 2 minutes on Docker. List updates are sent right away. If notifications aren't arriving, see [Troubleshooting](../self-hosting/troubleshooting.md#push-notifications-not-arriving).
