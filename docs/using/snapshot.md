# Daily & weekly snapshot

Tap a family member's avatar in the header (on a phone, tap the family button, then the person) to see **their day** at a glance. Switch to **Week** at the top for the next 7 days.

## Day

* **Greeting**: "Good morning, Maya" (afternoon from 12:00, evening from 17:00, household time). On their birthday it's "Happy birthday, Maya! 🎉". The first time a device opens someone's day, it adds "☀️ Here's your day".
* **Weather**: now (temperature and conditions), today's high and low, and the chance of rain. Only shown once a [weather location](../settings/general.md#household) is set.
* **Today**: their events plus everyone's (untagged) events, with times and 🚗 leave-by times.
* **Chores**: theirs plus **Anyone** chores due today, with how many are left. Tap one to tick it off.
* **To do**: [list items](lists.md) assigned to them that are due today, overdue, or marked High or Urgent (with a **! High** or **‼ Urgent** badge).
* **Birthdays 🎂**: family members' birthdays (from [Settings → Family](../settings/family.md)) and events in a category named "Birthdays".
* **Meals**: the family's [meals](meals.md) today, with times. Tap one to open it over their day, like tapping it in Meals.
* **Reading 📚**: the books they're in the middle of in [Trackers](trackers.md), with how far along they are ("Charlotte's Web — 45%"; 🎧 and time listened for an audiobook). Tap one to open Trackers.
* **Tomorrow at a glance**: tomorrow's weather, birthdays, events, items due and meals.

With the [energy battery](battery.md) on for them, a **🔋 Battery** card sits near the top on their own device and parents' devices (never a shared wall): how much energy they're likely to have left this evening, what went into it, and a heads-up if today or tomorrow looks full.

Every section has a friendly empty state ("Nothing on the calendar — enjoy it.").

## Daily check-in

When a parent turns on **Daily check-in points** in [Settings → Family](../settings/family.md#chores), the bottom of someone's day has an **I'm all caught up ✓ · +3 points** button. It wakes up once they've scrolled to the end (right away if the whole day fits on the screen). Tapping it earns the points with a little confetti, and the button becomes **Checked in today ✓**.

* Once per person per day, in the family's time zone. Checking in again the same day earns nothing.
* Only on the **Day** view, and only while **Chores & points** is on. Off (the default) hides it.
* It works wherever their day opens: on the wall, their own device or a parent's. A device that belongs to one person can only check in for them.
* A link to `#/calendar?checkin=<member id>` (the check-in widget in the phone app uses it) opens their day scrolled to the **Temp check**, or to the evening goal check from their evening time, or to this button when they have no Temp check. It follows the same rules as tapping them at the top of the calendar: a device that belongs to someone else just opens the calendar.
* The points are theirs to spend, like chore points, and count as **Points earned** on their [profile](profiles.md), which also counts their check-ins. The [leaderboard](chores.md) ranks chore points only, so checking in never moves anyone up or down.

API: `POST /api/members/{id}/check-in` returns `{ date, points, awarded, balance }` (`awarded` is 0 when they already checked in today; 400 while check-ins are off). The snapshot has `checkedIn` and `checkInPoints`. A new check-in sends the `checkin.completed` [webhook](../integrations/webhooks.md). Check-ins are in [exports](../your-data/export-import.md).

## Temp check

A few quick questions at the end of someone's day, above the check-in. A parent turns it on per person in [Settings → Family](../settings/family.md#temp-check) (off by default) and picks which questions they get:

* **How did you sleep last night?** Five big buttons: 😄 Great, 🙂 Good, 😐 OK, 😕 Poorly, 😫 Terrible.
* **How are you feeling today?** Pick any: great, good, fine, ok, bad, awful, tired, sore. **Other…** adds their own word; it becomes one of their choices from then on, so it's there next time.
* **Goal for today**: a short line (up to 140 characters), with **Save goal** or **Skip**.

Each answer saves as soon as it's tapped. Once every question has an answer, the card says **Thanks, Maya ✓** with **Change** to update an answer later that day. Only on today's **Day** view.

Who sees what:

* **Their own device and parents' devices** show their answers (😄 Slept great · Feeling good, tired · 🎯 Finish my book report).
* **A shared wall screen** lets them answer, but once they have it shows only **Answered ✓**, never how they slept or felt. **Change** starts the questions fresh there.
* **The goal** is for the family: it stays up all day on the [Board](calendar.md#board-view) in the **Today** card (for people with **Show the goal on the Board** on; when you pick one person in the family filter it shows only theirs, and a kid's own device leaves out the grown-ups' goals) and as a line above the calendar when it shows just that person (pinned, filtered, or on their own device).
* Sleep and feelings are health data: encrypted on the server and kept from Claude and other connected apps. See [Privacy](../your-data/privacy.md#temp-check).

### Evening goal check

With **Evening goal check** on (in the person's [Temp check settings](../settings/family.md#temp-check)), a day they set a goal ends with a follow-up. At the time they chose (9:00 PM to start), if they haven't answered yet:

* their own phones and tablets get a push: **Did you finish your goal? 🎯** with the goal. Tapping it opens their [journal](journal.md), where the check waits at the top. The bell's feed gets the same line. It comes through during the [night hours](night.md) too.
* a **🎯 Goal check** card shows at the bottom of their **Day** view until midnight. After that it becomes [last night's check-in](#last-nights-check-in).

With the [energy battery](battery.md#how-drained-do-you-feel) on, the same card also asks **How drained do you feel?** (Full, OK, Low, Empty or Skip), still with one push. On a day without a goal it asks just that, as a **🔋 Evening check** card at the same time, only on their own device and parents' devices.

Three big buttons: 🎉 **Yes**, 🌗 **Partly**, 🌱 **Not today**. The answer saves on the tap. Then, if their journal keeps notes, three optional lines: **What helped?**, **What got in the way?** and **Next time I'll…**, with **Save** or **No notes**. The card thanks them ("Nice work, Maya ✓", or something kind for Partly and Not today) and **Change** lets them answer again until midnight, or the next morning while [last night's check-in](#last-nights-check-in) is open. There's one prompt per person per day, and none on days they skipped the goal.

Who sees it: like sleep and feelings. Their own device and parents' devices show the answer and notes; a shared wall screen can take the answer but then shows only **Answered ✓**; another person's device can't answer for them. Answers and notes are encrypted on the server and kept from connected apps unless a parent allows it. See [Privacy](../your-data/privacy.md#temp-check).

### Last night's check-in

Late evenings run past midnight (a parent's evening check at 11:00 PM, say), so the evening check doesn't vanish when the date changes. After midnight it stays open as **🌙 Last night's check-in**, with that day's date, until the first of:

* **noon** the next day,
* their **morning Temp check** (answering sleep, feelings or the goal for the new day starts it; opening the app doesn't), or
* **Skip last night**, which closes it for good.

It shows at the top of their journal and in their **Day** view above the morning questions. While something is unanswered it asks **Finish last night's check-in?** (with **Skip last night**); once answered, **Change** still works until it closes. Answers are saved to the evening's own day, so the journal, [Insights](insights.md) and the [energy battery](battery.md) count them there, and answering it isn't this morning's Temp check. Who can see and answer it, and private journals, work as above.

If it's still unanswered in the morning, their own phones and tablets get one push from 7:00 AM: **Last night's check-in is still open 🌙**, "Finish it or skip it." Held at [night](night.md#reminders-at-night) (it waits until the night hours end, and not after noon), never what they answered or their goal, not in the family's feed, and never after they finished, skipped or did their morning Temp check.

API: `GET /api/members/{id}/temp-check?date=` and `PUT /api/members/{id}/temp-check?date=` (today by default; body `{ sleep, feelings, goal, goalSkipped, custom, followup, drained, lastNightSkipped }`, only what's sent changes). `followup` is `{ outcome: "yes" | "partly" | "no", helped, hindered, next }` (notes up to 500 characters each), today only, or yesterday while last night's check-in is open; the response has `followup`, `followupOpen` and `answered.followup`. `drained` (`full`, `ok`, `low`, `empty` or `skip`) is the energy battery's question, with the same days, `drainedOpen` and `answered.drained`. Today's response has `lastNight`: `{ date, pending }` while last night's check-in is open (`pending`: something is unanswered), else `null`. `lastNightSkipped: true` with `?date=` last night closes it. Anything else outside that window answers 403. `private: true` means sleep and feelings are withheld from this device (`answered` still says which questions have answers). See the [REST API](../integrations/rest-api.md).

## Week

A row for each of the next 7 days with its weather emoji and high/low, then that day's birthdays, events and items due, and a short chores line (tap it to open Chores). Undated Important/Urgent items and overdue ones show first under **Keep in mind**.

## Taps

* An event opens it in the calendar. An item opens its list.
* A chore ticks off right there (tap again to undo). An **Anyone** chore done from someone's day counts for them, and once it's done it says who got the points ("Done by Sam"). If the chore has a checklist with open items, the checklist opens first. See [Chores](chores.md#checklists).
* **Profile** (next to their name) opens their [profile](profiles.md).
* **Show only Maya on the calendar** (at the bottom) filters the calendar and chores to that person. Their avatar keeps its ring while the filter is on. Not shown on a display pinned to one member.
* On a phone, the family sheet does this directly: tap a person to show only them, and tap them again to show the whole family.
* An idle wall closes the snapshot with everything else.

## Assigning items to someone

A list item's **Assign to** field decides whose snapshot it appears in. Items with nobody assigned don't show in anyone's snapshot.

## Board (everyone)

`GET /api/board?days=` (default 7, max 14) returns the same kind of feed for the whole household instead of one member: every member's events plus untagged ones, open list items due within the range (or overdue) or high/urgent priority regardless of due date, today's chores grouped per member (with an "anyone" group), birthdays and [meals](meals.md) in the range. It's the data behind the calendar's [Board view](calendar.md#board-view). The MCP tool [`get_board`](../integrations/mcp.md) returns the same data.

## For assistants

`GET /api/snapshot?member=<id>&range=day|week` (admin and display keys) and the MCP tool [`get_snapshot`](../integrations/mcp.md) return the same data.

## Not yet

* Getting your own snapshot as the morning push notification. <!-- TODO: per-device "Daily snapshot" push pref (needs notify.ts) --> The [daily summary](notifications.md#daily-summary) is still the household one, filtered by the device's members.
