# Insights

Insights turn a person's check-ins into patterns they can see: how they've been sleeping, which feelings come up most, how their goals went, next to what Kinwall already knows (chores done, activity time, books finished, how busy their calendar was). Once there are a few weeks of check-ins, Insights point out connections like "Goals were met more often after good sleep (7 of 9 vs 2 of 8)".

It's built on [Temp check](snapshot.md#temp-check) answers, the [evening goal check](snapshot.md#evening-goal-check) and [journal](journal.md) moods, so it's as private as the journal.

## Opening Insights

* **📈 Insights** at the top of their [journal](journal.md).
* **Open insights** on their [profile](profiles.md) (on their own device and parents' devices only).
* **Settings → Family**, in the person's **Temp check** settings (parents), **Open insights**.

Pick **Last 4 weeks**, **Last 3 months** or **Last year** at the top.

## The page

* **🔋 Battery**, with the [energy battery](battery.md) on: the last week and the 3 days ahead, with what went into each day and any heads-up.
* **In short**: plain sentences for the range (below).
* **Connections**: patterns once there's enough to go on (below), or how many days there are so far.
* **Sleep**: each night's answer from Terrible to Great, as a line across the range. Nights without an answer leave a gap.
* **Feelings**: how many days each feeling came up, most common first, and each week's count for the top four.
* **Goals** per week: met, partly, not this time, and goals with no check yet, out of 7 days.
* **Chores done** and **Activity time** per week, when there are any.
* **Busy days**: timed events each day, with a mark under evenings that ended after 8 PM.

Charts are drawn to scale in the person's color and work in light and dark mode. Nothing needs a hover: every number is on the page or read out by screen readers. Feelings are never colored as good or bad.

## What goes into it

Everything is counted by the family's day, in the family's time zone ([Settings → General](../settings/general.md)).

* **Sleep** and **feelings** from Temp check.
* **Goals**: set (not skipped), and how they went: Yes, Partly or Not today. The goal's words and the notes aren't used.
* **Journal**: how many entries and their mood emoji. The words are never read.
* **Chores** done and approved for them, and their points.
* **Activity time** in [activities](activities.md), and **books finished** from [Trackers](trackers.md).
* **Busy days**: timed events on their calendars and the family's shared ones, by the day they start. All-day events (birthdays, school holidays) don't count. The latest end time of the day's events marks a **late event** when it's after 8 PM.

## Summaries

Plain sentences for the range, only for what has data: "Checked in on 20 of 28 days", "Slept well or great on 12 of 20 nights", "Met 8 of 11 goals, and partly met 2 more", "Did 34 chores for 120 points", "Spent 3 h 20 min on activities", "Finished 2 books", "3 or more events on 6 days (busiest: 5)" (or "Busiest day had 2 events" when none had 3), "Wrote 5 journal entries".

## Connections

Early data is mostly noise, so Insights stay quiet at first and only point something out when it's there to see.

* **Not before 3 weeks.** Connections are looked for only once there are at least **21 days with a check-in** in the range. Until then the page says "Keep checking in: patterns show up after about 3 weeks (12 days so far)."
* **Two kinds of days, one question.** Each connection splits the days into two groups and compares how often something happened in each:

  | Connection | Days compared | What's counted |
  |---|---|---|
  | Sleep and goals | slept well or great vs other days (days with a goal check) | goal met (Yes) |
  | Late events and sleep | the night after an event ending after 8 PM vs other nights | slept well or great |
  | Late events and feeling tired | the day after an event ending after 8 PM vs other days (days with feelings) | felt tired |
  | Busy days and goals | 3 or more timed events vs fewer (days with a goal check) | goal met (Yes) |
  | Chores and mood | at least one chore done vs none (days with feelings) | felt great or good |

* **Enough days on both sides:** at least **5 days** in each group.
* **A real difference:** the two rates must be at least **20 percentage points** apart (rounded).
* **Always the counts, never "because".** The sentence says what happened more or less often, and shows both counts: "Felt tired more often the day after a late event (5 of 7 vs 3 of 17)". It doesn't say one thing causes the other.
* **How sure:** **Clear pattern** with at least 10 days in each group and a difference of 30 points or more; otherwise **Early sign**.

When there are 3 weeks of check-ins but nothing passes these checks, the page says there are no clear connections yet. Nothing here is written or read by AI: it's the same arithmetic every time.

## Who can see it

* **The person's own device** and **parents' devices**. For kids, parents can see it too.
* **Never a shared wall screen** or another person's device, and no link to it shows there.
* **Claude and other connected apps** can't see it unless a parent turns on **Let connected apps see health entries**. There's no MCP tool for it.

Insights are worked out each time the page opens and never saved, so there's nothing new stored, logged or exported. See [Privacy](../your-data/privacy.md#insights).

## API

`GET /api/members/{id}/insights?range=4w|3m|1y` (4 weeks by default; 3 months is 13 weeks and 1 year 52 weeks, all ending today) returns `{ memberId, range, from, to, days, summary, topFeelings, connections }`:

* `days`: one per day, oldest first: `{ date, checkedIn, sleep, feelings, goalSet, goalOutcome, journalEntries, journalMoods, chores, points, activityMinutes, booksFinished, events, lastEventEnd }`. `lastEventEnd` is `HH:MM` in household time (`24:00` when an event runs past midnight).
* `summary`: `[{ id, text }]`. `topFeelings`: `[{ feeling, days }]`.
* `connections`: `{ ready, daysWithCheckIns, needed, list: [{ id, text, detail, confidence, a, b }] }`, where `a` and `b` are `{ hit, n }` for the two groups and `confidence` is `early` or `clear`.
* 403 for a shared wall screen, another member's device and a connected app without `aiHealthAccess`.
