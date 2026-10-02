# Settings → Family

## Members

Everyone who shows up on the wall. When two people's colors would look alike, to someone with color blindness or at a glance, a note under the list says so: "Sam and Maya may look alike to someone with red-green color blindness." It shows both colors and a suggested one, and **Use the suggestion** (not on a wall display) changes the second person's color to it. See [Color vision](../accessibility.md#color-vision).

Each member has:

* **Name**
* **Color**: from the palette or a custom color. It colors their events, chore column and avatar. If the color would look like someone else's, a note under the swatches says so ("May look like Sam's color to someone with red-green color blindness") and offers a palette color that stands out.
* **Avatar**: an emoji from the row, any emoji, or a 1–2 letter initial. A kid can also change their own on their own device, from their [profile](../using/profiles.md#opening-a-profile).
* **Grown-up** (admin only, off by default): parents and other adults. Their chores never wait for a parent's OK, so the sheet hides **Their chores need a parent's OK** while it's on. API: `grownUp`; setting it to `true` turns `needsApproval` off, and `needsApproval: true` is ignored for a grown-up. Existing members whose birthday has a year making them 18 or older became grown-ups when this setting arrived. Changing it for someone is logged in [Security activity](access.md#security-activity), leaves them a 🔒 note and is pushed to parents' phones, because it decides who reads their [journal](../using/journal.md#private-journals). Once a grown-up has a private journal entry or a phone or computer of their own with full access, only they can turn it off, on that device; otherwise saving shows "Alex has a private journal, so only Alex can change this, from their own phone or computer." and nothing changes. Turned off, their journal follows a kid's defaults, and what they wrote in private as a grown-up stays shut until they're a grown-up again. Connected apps (the API with an app's token, MCP) can't change it.
* **Birthday** (optional): a date. Turn on **I don't know the year** to keep just the month and day. It shows 🎂 in everyone's [snapshot](../using/snapshot.md) that day, with the age they turn when the year is known. API: `birthday` as `YYYY-MM-DD`, or `--MM-DD` without a year, or `null`.
* **Their chores need a parent's OK** (admin only, off by default, not shown for a grown-up): chores they tick on a wall screen or their own device wait for a parent to approve before the points count. A chore's own setting wins. See [Parent approval](../using/chores.md#parent-approval). API: `needsApproval`.

* **Transition reminders** (admin only, off by default): see [below](#transition-reminders).
* **Temp check** (admin only, off by default): daily questions at the end of their day. See [below](#temp-check).
* **Featured in Newscast** and **Can post in Newscast** (admin only, both on by default): see [below](#newscast).

**Add member** and editing are admin only. On a display, the list is read-only. Deleting a member ("Their chores and tags are unassigned") removes them from calendars, chores and event tags. It doesn't delete those items.

`GET /api/members` also returns each member's `pointsToday`, `pointsWeek` and `transitionReminders`.

### Transition reminders

Extra heads-ups before a person's events, sent as notifications to that person's own devices. Helpful for anyone who finds switching activities hard (ADHD, autism, or just a busy kid). Turn on **Transition reminders** in their editor, then pick:

* **When**: **60 min**, **30 min**, **15 min**, **10 min**, **5 min**, or **Add…** your own (1 to 120 minutes before; up to 8 times in all). Turning it on starts at 30 minutes, plus every 5 minutes during the last 15: heads-ups at 30, 15, 10 and 5.
* **Repeat as it gets close**: also remind every 5, 10 or 15 minutes near the end, for example every 5 minutes during the last 15. Times the repeat already covers are grayed out. (A wall screen's own on-screen warnings can repeat every minute; see Time cues.)
* **Count down to leaving** (on by default): when an event has travel time, the reminders count to the time to leave instead of the start.

A meal's event always counts to the time to start prep, and only its cook gets them when it has one ("Quick one: Tuesday Tacos prep in 15 min. Wash your hands ⏲️" over "Start prep by 5:20 PM · starts 6:00 PM"; the headline uses the meal's name, and with a recipe the hint can be its first step, like "Brown the beef"; see [Meals](../using/meals.md#the-calendar)).

The headline changes from one reminder to the next, so it doesn't fade into the background, and it gets more direct as time runs out: "Leave at 3:40 PM for Soccer practice. Water bottle? 🥅", then "Psst, leave at 3:40 PM for Soccer practice. Shin guards? ⚽", then "Okay, leave now for Soccer practice! 🎒". Each one is put together from parts (an opener like "Heads up:" or the person's name, the what and when, a hint and an emoji), so there are hundreds of ways to say it, and a daily event like the school bus doesn't cycle through them in a week. The hint fits the event, from its category or title: cleats and shin guards for soccer, "Instrument packed?" for music lessons, "Backpack and lunch?" for school, "Insurance card?" for the doctor or dentist, "Gift wrapped?" for a party, and "Find your shoes" or "Grab your bag" otherwise. It's always kind (kids read these) and always says what and when. Kinwall remembers each person's last 10 headlines (which parts, never the words) and picks one that isn't among them, with a different opener than the last. Under it, the plain facts: "Starts at 4:00 PM", or "Leave by 3:40 PM · starts 4:00 PM". Each one replaces the last on the lock screen, and tapping it opens the event.

Who gets them:

* **Their events**: timed events tagged with them, plus events with nobody tagged (those are everyone's). All-day events are skipped.
* **Their devices**: phones and tablets that belong to them (the device's owner under [Settings → Access](access.md) is this person) with [notifications](../using/notifications.md) and **Event reminders** turned on. Shared devices and the wall don't get them; use [Transition warnings](this-display.md#time-cues) for a screen everyone sees.
* **Held at night** (unless the family turns that off under [Night](general.md#night)). If a regular event reminder reaches the same device in the same minute, only that one is sent. When a check runs a little late (every 5 minutes on Cloudflare, about 2 on Docker), only the latest reminder goes out and it says the real time left.
* They are in addition to regular event reminders and aren't added to the family's notification feed.

In the Kinwall app for iPhone, the next leave-by or start-prep time is also a Live Activity on the person's own phone, from their first transition reminder until the event starts: "Soccer practice · leave in 18 min" with a countdown, switching to "Leave now" when it's time. The headline varies like the reminders do (the phone remembers its last 10), holds while its stage lasts, and never has minutes in it (the countdown has those); with **Low stimulation** on for that phone it's one plain line ("Leave for Soccer practice at 3:40 PM"). While the app is open it starts from the app itself; with the app closed, it needs Apple push on the server (see [Live Activities](../self-hosting/configuration.md#live-activities-apple-push)).

API: `transitionReminders` on `GET /api/members` and in `PATCH /api/members/{id}` (admin key), as `{ "on": true, "minutes": [10, 5], "repeat": { "every": 5, "within": 30 }, "leaveBy": true }`. `repeat` may be `null`. The MCP tool `update_member` takes the same object. It's included in [exports](../your-data/export-import.md).

### Temp check

Daily questions at the end of the person's [day](../using/snapshot.md#temp-check). Shown while **Check-ins & journal** is on in [Features](general.md#features). Turn on **Temp check**, then choose which questions they get (all on to start):

* **How did you sleep?**
* **How are you feeling?**
* **Goal for today**, and **Show the goal on the Board** (on by default).
* **Evening goal check** (off by default, with the goal on): "Did you finish your goal?" at the time in **Ask at** (noon to 11:30 PM in half hours, 9:00 PM to start), on their own devices and at the bottom of their day. See [Evening goal check](../using/snapshot.md#evening-goal-check).
* **Energy battery** (off by default): a rough daily guess at their energy from sleep, feelings and how full their days are, on their day and their Insights, with a heads-up push to their own devices the evening before a heavy day. It also asks **How drained do you feel?** at their evening time (**Ask at**, 9:00 PM to start), with or without a goal that day, and adjusts itself to the answers. See [Energy battery](../using/battery.md).
* **Keep answers in the journal** (on by default): their notes (what helped, what got in the way, next time) go in their [journal](../using/journal.md). Off: only Yes, Partly or Not today is kept, and the notes aren't asked.

Once it's saved on, **Open insights** goes to their [Insights](../using/insights.md): patterns in their check-ins over time.

Words they added with **Other…** are listed as **Maya's own feelings**; pick one under **Remove…** to take it off their list (answers they already gave keep it).

API: `tempCheck` on `GET /api/members` and `PATCH /api/members/{id}` (admin key), as `{ "on": true, "sleep": true, "feelings": true, "goal": true, "showGoal": true, "evening": false, "eveningTime": "21:00", "journal": true, "battery": false }` (`eveningTime` is household time on the hour or half hour). Members also carry `todayGoal`, today's goal or `null`. Their own feelings list is `custom` on `/api/members/{id}/temp-check`. Both are in [exports](../your-data/export-import.md).

### Private journal

Kids only (grown-ups' journals are private by default, and they decide for themselves on their own device). **Let Maya keep a private journal** (off by default) lets Maya turn **Private journal** on from her own device. Then her new entries' words, and that day's goal check notes, open only on her own devices: parent devices see the mood and **🔒 Private entry**. It saves right away, is logged in [Security activity](access.md#security-activity), and adds a 🔒 note to Maya's own [notifications](../using/notifications.md#notification-feed). Turning it off makes her new entries readable on parent devices again; entries she wrote while it was private stay private. See [Private journals](../using/journal.md#private-journals).

API: `privateJournal` on `GET /api/members` as `{ "on": false, "allowed": true }`; change it with `PUT /api/members/{id}/journal/privacy` and `{ "allowed": true }` (a parent's device) or `{ "private": true }` (a device that belongs to them). It's not in [exports](../your-data/export-import.md).

### Newscast

Two switches per person, saved right away (not shown while [Newscast](../using/newscast.md) is turned off in Features):

* **Featured in Newscast**: off leaves all of their chores, rewards, photos, drawings, books, memories and birthday out of Newscast, on every device. Their own announcements still show.
* **Can post in Newscast**: off pauses their posting for now. Their share card says "Leo is taking a break from posting for now. A parent can turn it back on in Settings." They still see Newscast and react. A parent can also do this from one of their posts (**⋯ → Pause posting for Leo**, and **Let Leo post again**).

API: `newscastNotFeatured` and `newscastPostingPaused`, lists of member ids, on `GET` / `PATCH /api/settings` (admin keys; a `PATCH` sends the whole list). Both are in [exports](../your-data/export-import.md).

## Categories

Add, edit, reorder (↑ / ↓) and delete event categories. Admin only; on a display, the list is read-only. See [Categories & auto-categorizing](../using/categories.md).

## Chores

Also on this tab, admin only:

| Setting | Options | Default |
|---|---|---|
| **Late completion credit** | 0%, 25%, 50%, 75%, 100% | 50% |
| **Streak grace** | 0–3 missed days per rolling week | 1 |
| **Daily check-in points** | Off, 1, 2, 3, 5, 10 — what reading your day to the end earns, once a day ([daily check-in](../using/snapshot.md#daily-check-in)); hidden while **Check-ins & journal** is off | Off |
| **Leaderboard** | on/off — hides the chore leaderboard and rank badges | On |
| **Rewards** | on/off — kids spend points on rewards you set, with your OK; off hides [Rewards](../using/rewards.md) and refuses requests (`rewardsEnabled`) | On |
| **Sticker shop** | on/off — hides the sticker book in Activities and refuses purchases when off | On |
| **Sticker prices** | Free, 50%, 100%, 150% — scales every pack's price | 100% |

See [Chores](../using/chores.md) for how these play out day to day.

## Meals

When the Meals feature is on, this tab has the family's usual meal times: **Breakfast** 7:30 AM, **Lunch** 12:00 PM, **Dinner** 6:00 PM and **Snack** 3:00 PM unless you change them. A meal without its own time goes on the calendar at its usual time, and the meal sheet shows it under the **Time** field. Changing a usual time doesn't move events already on the calendar. API: `mealTimes` in `GET` / `PATCH /api/settings`, as `{ "breakfast": "07:30", "lunch": "12:00", "dinner": "18:00", "snack": "15:00" }` (send all four). See [Meals](../using/meals.md#the-calendar).
