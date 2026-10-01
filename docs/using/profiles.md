# Profiles

Everyone in the family has a profile: a page about what they've been up to. Chores done, points earned and spent, their streak, books read, the sticker book, time in activities, milestone badges and their birthday. It's built from what Kinwall already keeps, so there's nothing new to fill in.

A profile is about one person. It never ranks brothers and sisters or puts their numbers side by side; the only comparison is with their own earlier days ("▲ 4 more than last week"). Health entries from [Trackers](trackers.md) never show on it.

## Opening a profile

* **Chores**: tap someone's pill on the leaderboard.
* **Header**: tap a person's avatar (on a phone, the family button, then the person), then **Profile** at the top of their day.
* **Me**: a device that belongs to one person (set under [Settings → Access](../settings/access.md)) gets **Me** in the menu, right after Chores. It opens their own profile.
* On a tablet or wall screen, the row of people at the top switches between profiles.

Everyone in the family can see everyone's profile, on every device. An idle wall screen goes back to the calendar as usual.

**Your own avatar**: on a kid's own device, tap the avatar (it has a ✏️) on their own profile to pick a new emoji or initial, then **Save**. That's the only thing a kid can change about themselves; the name, color and everything else stay under [Settings → Family](../settings/family.md) on a parent's device. Wall screens can't change avatars.

## What's on it

Pick **Today**, **Week**, **Month**, **Year** or **All time** at the top. Days follow the family's time zone and the week starts on the day set in [Settings → General](../settings/general.md).

* **Chores done**, compared with the same stretch before: yesterday, last week up to the same weekday, last month or last year up to the same date. All time says when they joined.
* **Points earned** in the period, from chores and [daily check-ins](snapshot.md#daily-check-in).
* **Check-ins** ☀️: how many days they checked in during the period. Shown while daily check-ins are on (or once they have some).
* **Books finished** in the period (audiobooks count), with their pages and time listened.
* **Streak** 🔥 and **best ever**. It's the same streak as the [leaderboard](chores.md), grace days included, so the two numbers always match. The best streak looks back over all their history.
* **Chores done** chart: per day for a week or month, per month for a year or all time, with their busiest weekday and favorite chore. **Today** lists today's chores instead.
* **Points**: earned, spent on stickers, spent on rewards (refunds taken off), and the [reward](rewards.md) they're saving for. Tap the goal to open their rewards.
* **Bookshelf**: the books they finished this year as colored spines (every book on **All time**), with pages, time listened for audiobooks, average stars, a five-star favorite and the books they're reading now. From [Trackers](trackers.md) (reading).
* **Activities**: time played in each [activity](activities.md) in the period.
* **Badges**: see below.
* **Sticker book**: packs unlocked and stickers on the page.
* **Journal** 🔒 (only on their own device and parents' devices): **Open the journal**, and with the [evening goal check](snapshot.md#evening-goal-check) on, **Goals met this week: 3 of 5** (goals answered Yes out of goals set in the last 7 days). See [Journal](journal.md).
* **Insights** 🔒 (only on their own device and parents' devices): **Open insights**, for patterns in their check-ins. Nothing from Insights shows on the profile itself. See [Insights](insights.md).
* **Medicines** 🔒 (with [medication reminders](medications.md) on, only on their own device and parents' devices): **Open medicines**. No names or doses on the profile itself.
* **Birthday**, under their name, from [Settings → Family](../settings/family.md): a countdown in the 60 days before ("Turns 8 in 35 days"), "Turned 8 on Sep 13 🎂" for two weeks after, and their age ("8 years old") the rest of the year. Without a birth year it says "Birthday in 35 days" or "Birthday was Sep 13", and nothing the rest of the year.

Cards with nothing to show stay hidden, so a grown-up's profile usually has no sticker book or activities. Cards follow the family's [features](../settings/general.md#features): with **Chores & points** off, chores, points, streak and the sticker book go; with reading off, the bookshelf goes.

### Parents only

On a parent's device (full access), a **Waiting for your OK** card shows that person's chores and rewards waiting for approval, with a button to go approve them. Wall screens and kids' devices never see it.

## Badges

Twelve milestone badges, earned from all-time totals. Once earned, they stay: deleting a chore that was done keeps its history (see [Chores](chores.md)).

| Badge | Earned for |
|---|---|
| 🌱 First chore | The first chore done |
| ⭐ 10 chores | 10 chores done |
| 🏅 50 chores | 50 chores done |
| 💯 100 chores | 100 chores done |
| 🏆 500 chores | 500 chores done |
| 🔥 7-day streak | A best streak of 7 days |
| 🌟 30-day streak | A best streak of 30 days |
| 🎁 First reward | A reward approved or given |
| 🎨 First sticker pack | A sticker pack bought |
| 📒 Every sticker pack | Every sticker pack unlocked |
| 📖 First book | A book or audiobook finished |
| 📚 10 books | 10 books finished, audiobooks included |

Badges not earned yet show grayed out.

## API and MCP

`GET /api/members/{id}/stats?period=today|week|month|year|all` returns everything on a profile. Wall screens and kids' devices can read it too. See [REST API → Member stats](../integrations/rest-api.md#member-stats). The MCP tool `get_member_profile` returns the same for a member by name.
