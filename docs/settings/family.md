# Settings → Family

## Members

Everyone who shows up on the wall. Each member has:

* **Name**
* **Color**: from the palette or a custom color. It colors their events, chore column and avatar.
* **Avatar**: an emoji from the row, any emoji, or a 1–2 letter initial.
* **Birthday** (optional): a date. Turn on **I don't know the year** to keep just the month and day. It shows 🎂 in everyone's [snapshot](../using/snapshot.md) that day, with the age they turn when the year is known. API: `birthday` as `YYYY-MM-DD`, or `--MM-DD` without a year, or `null`.
* **Their chores need a parent's OK** (off by default): chores they tick on a wall screen or their own device wait for a parent to approve before the points count. A chore's own setting wins. See [Parent approval](../using/chores.md#parent-approval). API: `needsApproval`.

* **Transition reminders** (admin only, off by default): see [below](#transition-reminders).

**Add member** and editing are admin only. On a display, the list is read-only. Deleting a member ("Their chores and tags are unassigned") removes them from calendars, chores and event tags. It doesn't delete those items.

`GET /api/members` also returns each member's `pointsToday`, `pointsWeek` and `transitionReminders`.

### Transition reminders

Extra heads-ups before a person's events, sent as notifications to that person's own devices. Helpful for anyone who finds switching activities hard (ADHD, autism, or just a busy kid). Turn on **Transition reminders** in their editor, then pick:

* **When**: **30 min**, **15 min**, **10 min**, **5 min**, or **Add…** your own (1 to 120 minutes before; up to 8 times in all). Turning it on starts at 10 and 5.
* **Repeat as it gets close**: also remind every 5, 10 or 15 minutes near the end, for example every 5 minutes during the last 30. (A wall screen's own on-screen warnings can repeat every minute; see Time cues.)
* **Count down to leaving** (on by default): when an event has travel time, the reminders count to the time to leave instead of the start.

The notification reads "Soccer practice in 10 minutes" (then "Starts at 4:00 PM"), or "Leave for Soccer practice in 5 minutes" (then "Leave by 3:40 PM · starts 4:00 PM"). Each one replaces the last on the lock screen, and tapping it opens the event.

Who gets them:

* **Their events**: timed events tagged with them, plus events with nobody tagged (those are everyone's). All-day events are skipped.
* **Their devices**: phones and tablets that belong to them (the device's owner under [Settings → Access](access.md) is this person) with [notifications](../using/notifications.md) and **Event reminders** turned on. Shared devices and the wall don't get them; use [Transition warnings](this-display.md#time-cues) for a screen everyone sees.
* **Never during quiet hours.** If a regular event reminder reaches the same device in the same minute, only that one is sent. When a check runs a little late (every 5 minutes on Cloudflare, about 2 on Docker), only the latest reminder goes out and it says the real time left.
* They are in addition to regular event reminders and aren't added to the family's notification feed.

API: `transitionReminders` on `GET /api/members` and in `PATCH /api/members/{id}` (admin key), as `{ "on": true, "minutes": [10, 5], "repeat": { "every": 5, "within": 30 }, "leaveBy": true }`. `repeat` may be `null`. The MCP tool `update_member` takes the same object. It's included in [exports](../your-data/export-import.md).

## Categories

Add, edit, reorder (↑ / ↓) and delete event categories. Both admin and display devices can do this. See [Categories & auto-categorizing](../using/categories.md).

## Chores

Also on this tab, admin only:

| Setting | Options | Default |
|---|---|---|
| **Late completion credit** | 0%, 25%, 50%, 75%, 100% | 50% |
| **Streak grace** | 0–3 missed days per rolling week | 1 |
| **Leaderboard** | on/off — hides the chore leaderboard and rank badges | On |
| **Sticker shop** | on/off — hides the sticker book in Activities and refuses purchases when off | On |
| **Sticker prices** | Free, 50%, 100%, 150% — scales every pack's price | 100% |

See [Chores](../using/chores.md) for how these play out day to day.
