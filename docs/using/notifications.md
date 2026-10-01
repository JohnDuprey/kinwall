# Notifications

Kinwall sends standard **Web Push** notifications, signed with its own VAPID keys, straight to each browser or installed app. No app-store app or third-party push service is involved. The settings are **per device**: each phone picks what it wants.

## Turning them on

On the device that should get notifications, go to **Settings → General → Notifications** and tap **Turn on notifications**. Allow the browser prompt, then choose:

| Option | Default | What you get |
|---|---|---|
| **Event reminders** | on | A notification at each event's reminder time. On a device that belongs to someone, also their [transition reminders](#transition-reminders), if they have them. |
| **Daily summary** + time | off, 07:30 | "Today": event and chore counts, the first event titles, and open linked tasks. |
| **Chore reminder** + time | off, 08:00 | "*N* chores left today", listing the first three. Sent only if something is still open. |
| **List updates** | off | "List updated — *Groceries* has new items". At most one per list every 10 minutes. |
| **Which family members?** | Everyone | Only events and chores for these people. A device following nobody gets everything. A kid's own device doesn't have this: it follows only that kid (and everything for the whole family), and says so. |

**Send test** sends "Notifications are on 🎉" to this device. **Turn off** unsubscribes it. Times use the household timezone.

## Event reminders

* A reminder fires at the event's reminder offset: its own reminder, or the household **Default reminder**. See [Events → Reminders](events.md#reminders).
* The notification's **title is the event name** (with its category emoji). The body is "In 30 minutes · 4:00 PM", then 📍 location, 👥 who, 🗓 calendar and a short note. Long-press to see all of it.
* With travel time and **remind before leave**, the first line reads "Leave by … for … · starts …".
* Tapping the notification opens that event in the calendar.
* A tick that was missed still fires once, within 10 minutes. Each reminder is sent only once per device.

## Energy battery heads-up

For someone with the [energy battery](battery.md) on, their own phones and tablets get one calm push from 7:00 PM the evening before a day that looks likely to run them low: **🔋 Heads-up for tomorrow** with "Tomorrow looks full: 5 events and a late evening. Maybe plan a rest or move something?". Held at [night](night.md#reminders-at-night) (it waits until the night hours end, and goes out that morning), never about sleep or feelings, and not in the family's feed. At their evening time, on a day without a goal to check on, they also get **How drained do you feel? 🔋** (see [How drained do you feel?](battery.md#how-drained-do-you-feel)); on a day with one, it's part of the goal check's push.

## Last night's check-in

When someone's evening check (the goal check or **How drained do you feel?**) is still unanswered in the morning, their own phones and tablets get one push from 7:00 AM: **Last night's check-in is still open 🌙**, "Finish it or skip it." It waits for the [night hours](night.md) to end, stops at noon, never says what they answered or their goal, and isn't in the family's feed. None once they finished it, skipped it or answered their morning Temp check. See [Last night's check-in](snapshot.md#last-nights-check-in).

## Transition reminders

A family member can also get **transition reminders**: calm heads-ups at the times a parent picks (for example 30 minutes before, plus every 5 minutes during the last 15), sent only to devices that belong to them. The headline changes each time, avoids the person's last 10, fits the event ("Leave at 3:40 PM for Soccer practice. Water bottle? 🥅") and gets more direct as time runs out ("Okay, leave now for Soccer practice! 🎒"), and a meal's event counts to starting prep instead. Events shown as [free](events.md#free-or-busy) get none (their own reminders still fire). They're held during the [night hours](night.md#reminders-at-night) (unless the family turns that off), a reminder that would land in the same minute as a regular one isn't doubled, and each replaces the last on the lock screen. Set them in [Settings → Family](../settings/family.md#transition-reminders).

## Daily summary

At the chosen time: "3 events · 2 chores — Soccer practice, Dentist…". If any of today's events have open [linked tasks](lists.md#linking-items-to-events), a "To do for today's events" section follows, with up to three tasks per event. Urgent tasks come first, marked ‼️, then high-[priority](lists.md#priority) ones, marked ⭐. If any list items are due today, a short "Due today: …" line follows (up to three, then "+N more").

## "Kinwall" under the title

iOS shows the sending app's name under each notification, so a reminder reads as the event title with "from Kinwall" beneath it. That's why the title is the event name and not "Kinwall". A notification whose payload carries no title falls back to "Kinwall".

## Sending a message now

On an admin device, **Settings → Access → Notifications** lists every subscribed device ("added …, delivered …" or "never delivered"). You can remove a device there. Below the list, **Send a message** takes a **Title**, a **Message** and **To** (members, or Everyone), then **Send now**. The message also lands in everyone's [notification feed](#notification-feed). The API equivalent is `POST /api/notify {title, body, memberIds?, url?}` (admin only), and the MCP tool is `send_notification`. Turning off **Family messages** in [Settings → General → Features](../settings/general.md#features) hides **Send a message** everywhere and makes `POST /api/notify` answer 403. Turning off **Chores & points** or **Lists** there also hides the **Chore reminder** or **List updates** setting and stops those notifications.

## Notification feed

Every notification Kinwall sends is also kept in the app, whether or not any device has push turned on. Tap the **bell** next to the family avatars in the header, on the wall and on phones. The red badge counts what's new since this device last opened the feed (shown as "9+" past nine).

* The **Notifications** sheet lists them newest first, grouped **Today**, **Yesterday**, then by date. Each shows an icon for its kind (🔔 reminder, ☀️ daily summary, ✅ chore reminder, 🛒 list update, 💬 message, 🎯 [evening goal check](snapshot.md#evening-goal-check), 💊 [medication reminder](medications.md), shown only on parent devices, shared walls and that person's own devices, 🔒 a privacy note, only on the devices of the person it's about: a device now belongs to them, or their [private journal](journal.md#private-journals) was turned on or off or allowed), the title, the first two lines, how long ago, and who it was for.
* Tapping one with a link opens it, just like tapping the push: a reminder opens its event, a chore reminder opens Chores, and a list update opens that list.
* **Read state is per device**, like the other "on this device" settings. Opening the feed clears the badge; **Mark all read** clears the unread highlight in the list. A device's first visit starts caught up.
* The feed keeps the **household** copy: a reminder is listed once, not once per phone. The daily summary and chore reminder are listed once a day at their default times (07:30 and 08:00), or earlier if a device has picked an earlier time. They cover the whole family, since the wall isn't following anyone in particular.
* Admins get a **Send a message** button at the top of the sheet, next to **Mark all read** and **Clear all**; it opens the same form as in Settings → Access.
* Admins can also **remove** a notification (the × beside it) or **Clear all** from the top of the sheet. The feed is the household's one copy, so this clears it on every device; displays can only mark things read. 🔒 Privacy notes can't be removed: they stay their 90 days, so a change of whose device something is can't happen quietly. Parents' record of these, and of passkeys, sign-ins, keys and connected apps, is [Security activity](sign-in-and-security.md#security-activity), not the feed. The same via the API: `DELETE /api/notifications/:id` and `DELETE /api/notifications` (admin key).
* Display keys can read the feed. Entries older than 90 days are removed.
* **On a kid's own device** (paired as a kid's under [Settings → Access](../settings/access.md)) the feed shows what's for the whole family and what's for that kid, nothing else: no messages, reminders or 🔒 privacy notes meant for someone else, no household daily summary (it lists the grown-ups' plans too), and none of the parent-facing "Leo's 8:00 AM medicine hasn't been marked yet" notes, not even about them.
* **On a wall screen** the feed is the family's, minus those parent-facing medicine notes, any message meant only for grown-ups and 🔒 privacy notes. Parent devices see everything except other people's 🔒 privacy notes.
* The API is `GET /api/notifications?limit=50&before=<ISO time>` (newest first), and the MCP tool is `list_notifications`.

## Live Activities (Kinwall app for iPhone)

In the Kinwall app for iPhone, some things also show on the Lock Screen and in the Dynamic Island while they're happening: a [cooking timer](meals.md#start-cooking), a [shopping trip](lists.md#shopping-mode), and the next leave-by or start-prep time for the person the phone belongs to. There's no Kinwall setting for them:

* A cooking timer or a shopping trip shows when you start one.
* A leave-by or start-prep countdown follows the reminders: it shows only on a phone that belongs to someone who has [transition reminders](../settings/family.md#transition-reminders) on, and with the app's notifications allowed. It starts at their first transition reminder and ends when the event starts.
* To turn them all off, go to iPhone **Settings → Kinwall → Live Activities**. The Notifications section in the app's Settings says whether they're on.
* In the Kinwall app for Android they show as ongoing notifications instead. Turn them off in Android **Settings → Apps → Kinwall → Notifications**; the Notifications section says whether they're on.
* On Android, medicine reminders can come through Do Not Disturb: see [Medications → Reminders](medications.md#reminders).

## Platform notes

* **iPhone / iPad**: needs **iOS 16.4 or later** and Kinwall **added to the Home Screen** (Share → Add to Home Screen), opened from there. Safari tabs can't receive push at all. Settings says so when it detects Safari, and the **Add Kinwall to your Home Screen** card shows how (see [Put it on the wall](../getting-started/put-it-on-the-wall.md)).
* **Android**: works in Chrome, Firefox or Samsung Internet, installed or not. The status-bar icon is a single-color badge.
* **Desktop**: any browser with Push API support.
* A device whose push subscription has expired (the push service answers 404/410) is removed automatically. Turn notifications on again on that device.

## How often it checks

Reminders, summaries and nudges are scheduled independently of calendar sync: every 5 minutes on Cloudflare Workers (cron) and every 2 minutes on Docker. List updates are sent right away. If notifications aren't arriving, see [Troubleshooting](../self-hosting/troubleshooting.md#push-notifications-not-arriving).
