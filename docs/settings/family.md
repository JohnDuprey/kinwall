# Settings → Family

## Members

Everyone who shows up on the wall. When two people's colors would look alike, to someone with color blindness or at a glance, a note under the list says so: "Sam and Maya may look alike to someone with red-green color blindness." It shows both colors and a suggested one, and **Use the suggestion** (not on a wall display) changes the second person's color to it. See [Color vision](../accessibility.md#color-vision).

Each member has:

* **Name**
* **Color**: from the palette or a custom color. It colors their events, chore column and avatar. If the color would look like someone else's, a note under the swatches says so ("May look like Sam's color to someone with red-green color blindness") and offers a palette color that stands out.
* **Avatar**: an emoji from the row, any emoji, or a 1–2 letter initial.
* **Grown-up** (admin only, off by default): parents and other adults. Their chores never wait for a parent's OK, so the sheet hides **Their chores need a parent's OK** while it's on. API: `grownUp`; setting it to `true` turns `needsApproval` off, and `needsApproval: true` is ignored for a grown-up. Existing members whose birthday has a year making them 18 or older became grown-ups when this setting arrived.
* **Birthday** (optional): a date. Turn on **I don't know the year** to keep just the month and day. It shows 🎂 in everyone's [snapshot](../using/snapshot.md) that day, with the age they turn when the year is known. API: `birthday` as `YYYY-MM-DD`, or `--MM-DD` without a year, or `null`.
* **Their chores need a parent's OK** (admin only, off by default, not shown for a grown-up): chores they tick on a wall screen or their own device wait for a parent to approve before the points count. A chore's own setting wins. See [Parent approval](../using/chores.md#parent-approval). API: `needsApproval`.

* **Transition reminders** (admin only, off by default): see [below](#transition-reminders).
* **Temp check** (admin only, off by default): daily questions at the end of their day. See [below](#temp-check).

**Add member** and editing are admin only. On a display, the list is read-only. Deleting a member ("Their chores and tags are unassigned") removes them from calendars, chores and event tags. It doesn't delete those items.

`GET /api/members` also returns each member's `pointsToday`, `pointsWeek` and `transitionReminders`.

### Transition reminders

Extra heads-ups before a person's events, sent as notifications to that person's own devices. Helpful for anyone who finds switching activities hard (ADHD, autism, or just a busy kid). Turn on **Transition reminders** in their editor, then pick:

* **When**: **60 min**, **30 min**, **15 min**, **10 min**, **5 min**, or **Add…** your own (1 to 120 minutes before; up to 8 times in all). Turning it on starts at 30 minutes, plus every 5 minutes during the last 15: heads-ups at 30, 15, 10 and 5.
* **Repeat as it gets close**: also remind every 5, 10 or 15 minutes near the end, for example every 5 minutes during the last 15. Times the repeat already covers are grayed out. (A wall screen's own on-screen warnings can repeat every minute; see Time cues.)
* **Count down to leaving** (on by default): when an event has travel time, the reminders count to the time to leave instead of the start.

A meal's event always counts to the time to start prep, and only its cook gets them when it has one ("Chef time in 10 min! Dinner · Tuesday Tacos 🍳" over "Start prep by 5:20 PM · starts 6:00 PM"; see [Meals](../using/meals.md#the-calendar)).

The headline changes from one reminder to the next, so it doesn't fade into the background, and it gets more direct as time runs out: "Soccer practice in 30 min: find your shoes 🚗", then "10 min to leave for Soccer practice. Shoes on? 👟", then "Leave now for Soccer practice! 🎒". It's always kind (kids read these), sometimes uses the person's name, and always says what and when. The same event gets the same lines for the same person on the same day, and two in a row are never the same. Under it, the plain facts: "Starts at 4:00 PM", or "Leave by 3:40 PM · starts 4:00 PM". Each one replaces the last on the lock screen, and tapping it opens the event.

Who gets them:

* **Their events**: timed events tagged with them, plus events with nobody tagged (those are everyone's). All-day events are skipped.
* **Their devices**: phones and tablets that belong to them (the device's owner under [Settings → Access](access.md) is this person) with [notifications](../using/notifications.md) and **Event reminders** turned on. Shared devices and the wall don't get them; use [Transition warnings](this-display.md#time-cues) for a screen everyone sees.
* **Never during quiet hours.** If a regular event reminder reaches the same device in the same minute, only that one is sent. When a check runs a little late (every 5 minutes on Cloudflare, about 2 on Docker), only the latest reminder goes out and it says the real time left.
* They are in addition to regular event reminders and aren't added to the family's notification feed.

In the Kinwall app for iPhone, the next leave-by or start-prep time is also a Live Activity on the person's own phone, from their first transition reminder until the event starts: "Soccer practice · leave in 18 min" with a countdown, switching to "Leave now" when it's time. The headline varies like the reminders do, but never with minutes in it (the countdown has those); with **Low stimulation** on for that phone it's one plain line ("Leave for Soccer practice at 3:40 PM"). While the app is open it starts from the app itself; with the app closed, it needs Apple push on the server (see [Live Activities](../self-hosting/configuration.md#live-activities-apple-push)).

API: `transitionReminders` on `GET /api/members` and in `PATCH /api/members/{id}` (admin key), as `{ "on": true, "minutes": [10, 5], "repeat": { "every": 5, "within": 30 }, "leaveBy": true }`. `repeat` may be `null`. The MCP tool `update_member` takes the same object. It's included in [exports](../your-data/export-import.md).

### Temp check

Daily questions at the end of the person's [day](../using/snapshot.md#temp-check). Turn on **Temp check**, then choose which questions they get (all on to start):

* **How did you sleep?**
* **How are you feeling?**
* **Goal for today**, and **Show the goal on the Board** (on by default).
* **Evening goal check** (off by default, with the goal on): "Did you finish your goal?" at the time in **Ask at** (noon to 11:30 PM in half hours, 9:00 PM to start), on their own devices and at the bottom of their day. See [Evening goal check](../using/snapshot.md#evening-goal-check).
* **Energy battery** (off by default): a rough daily guess at their energy from sleep, feelings and how full their days are, on their day and their Insights, with a heads-up push to their own devices the evening before a heavy day. It also asks **How drained do you feel?** at their evening time (**Ask at**, 9:00 PM to start), with or without a goal that day, and adjusts itself to the answers. See [Energy battery](../using/battery.md).
* **Keep answers in the journal** (on by default): their notes (what helped, what got in the way, next time) go in their [journal](../using/journal.md). Off: only Yes, Partly or Not today is kept, and the notes aren't asked.

Once it's saved on, **Open insights** goes to their [Insights](../using/insights.md): patterns in their check-ins over time.

Words they added with **Other…** are listed as **Maya's own feelings**; pick one under **Remove…** to take it off their list (answers they already gave keep it).

API: `tempCheck` on `GET /api/members` and `PATCH /api/members/{id}` (admin key), as `{ "on": true, "sleep": true, "feelings": true, "goal": true, "showGoal": true, "evening": false, "eveningTime": "21:00", "journal": true, "battery": false }` (`eveningTime` is household time on the hour or half hour). Members also carry `todayGoal`, today's goal or `null`. Their own feelings list is `custom` on `/api/members/{id}/temp-check`. Both are in [exports](../your-data/export-import.md).

## Categories

Add, edit, reorder (↑ / ↓) and delete event categories. Both admin and display devices can do this. See [Categories & auto-categorizing](../using/categories.md).

## Chores

Also on this tab, admin only:

| Setting | Options | Default |
|---|---|---|
| **Late completion credit** | 0%, 25%, 50%, 75%, 100% | 50% |
| **Streak grace** | 0–3 missed days per rolling week | 1 |
| **Daily check-in points** | Off, 1, 2, 3, 5, 10 — what reading your day to the end earns, once a day ([daily check-in](../using/snapshot.md#daily-check-in)) | Off |
| **Leaderboard** | on/off — hides the chore leaderboard and rank badges | On |
| **Sticker shop** | on/off — hides the sticker book in Activities and refuses purchases when off | On |
| **Sticker prices** | Free, 50%, 100%, 150% — scales every pack's price | 100% |

See [Chores](../using/chores.md) for how these play out day to day.

## Meals

When the Meals feature is on, this tab has the family's usual meal times: **Breakfast** 7:30 AM, **Lunch** 12:00 PM, **Dinner** 6:00 PM and **Snack** 3:00 PM unless you change them. A meal without its own time goes on the calendar at its usual time, and the meal sheet shows it under the **Time** field. Changing a usual time doesn't move events already on the calendar. API: `mealTimes` in `GET` / `PATCH /api/settings`, as `{ "breakfast": "07:30", "lunch": "12:00", "dinner": "18:00", "snack": "15:00" }` (send all four). See [Meals](../using/meals.md#the-calendar).
