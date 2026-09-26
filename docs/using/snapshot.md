# Daily & weekly snapshot

Tap a family member's avatar in the header (on a phone, tap the family button, then **Their day** next to the person) to see **their day** at a glance. Switch to **Week** at the top for the next 7 days.

## Day

* **Greeting**: "Good morning, Maya" (afternoon from 12:00, evening from 17:00, household time). On their birthday it's "Happy birthday, Maya! 🎉". The first time a device opens someone's day, it adds "☀️ Here's your day".
* **Weather**: now (temperature and conditions), today's high and low, and the chance of rain. Only shown once a [weather location](../settings/general.md#household) is set.
* **Today**: their events plus everyone's (untagged) events, with times and 🚗 leave-by times.
* **Chores**: theirs plus **Anyone** chores due today, with how many are left. Tap one to tick it off.
* **To do**: [list items](lists.md) assigned to them that are due today, overdue, or marked Important or Urgent (with priority dots).
* **Birthdays 🎂**: family members' birthdays (from [Settings → Family](../settings/family.md)) and events in a category named "Birthdays".
* **Tomorrow at a glance**: tomorrow's weather, birthdays, events and items due.

Every section has a friendly empty state ("Nothing on the calendar — enjoy it.").

## Week

A row for each of the next 7 days with its weather emoji and high/low, then that day's birthdays, events and items due, and a short chores line (tap it to open Chores). Undated Important/Urgent items and overdue ones show first under **Keep in mind**.

## Taps

* An event opens it in the calendar. An item opens its list.
* A chore ticks off right there (tap again to undo). An **Anyone** chore done from someone's day counts for them. If the chore has a checklist with open items, the checklist opens first. See [Chores](chores.md#checklists).
* **Show only Maya on the calendar** (at the bottom) filters the calendar and chores to that person. Their avatar keeps its ring while the filter is on. Not shown on a display pinned to one member.
* On a phone, the family sheet does this directly: tap a person to show only them, and tap them again to show the whole family.
* An idle wall closes the snapshot with everything else.

## Assigning items to someone

A list item's **Assign to** field decides whose snapshot it appears in. Items with nobody assigned don't show in anyone's snapshot.

## Board (everyone)

`GET /api/board?days=` (default 7, max 14) returns the same kind of feed for the whole household instead of one member: every member's events plus untagged ones, open list items due within the range (or overdue) or high/urgent priority regardless of due date, today's chores grouped per member (with an "anyone" group), and birthdays in the range. It's the data behind the calendar's [Board view](calendar.md#board-view). The MCP tool [`get_board`](../integrations/mcp.md) returns the same data.

## For assistants

`GET /api/snapshot?member=<id>&range=day|week` (admin and display keys) and the MCP tool [`get_snapshot`](../integrations/mcp.md) return the same data.

## Not yet

* Getting your own snapshot as the morning push notification. <!-- TODO: per-device "Daily snapshot" push pref (needs notify.ts) --> The [daily summary](notifications.md#daily-summary) is still the household one, filtered by the device's members.
