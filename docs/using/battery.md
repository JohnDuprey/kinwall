# Energy battery

Some people find a full day hard to keep up with: getting started, switching between things, having enough left for the evening. The energy battery is a rough daily guess at how much energy someone has, from how they slept and felt against what their day asks of them. When a day ahead looks likely to run them low, it gives a gentle heads-up while there's still time to plan a rest or move something.

It's a guide, not a measurement. The numbers are simple weights picked by hand (below), and every number comes with what made it, so you can see when it's wrong and ignore it.

## Turning it on

A parent turns on **Energy battery** in the person's **Temp check** settings in [Settings → Family](../settings/family.md#temp-check). It's off by default and needs Temp check on, since sleep and feelings are what charge it. There are no other settings.

## Where you see it

* **Their day**: a **🔋 Battery** card at the top of their [Day](snapshot.md#day): the level by this evening ("51% · Good by this evening · started at 75%"), a meter in their color, what went into it, and any heads-up for today or tomorrow. Only on their own device and parents' devices.
* **Their [Insights](insights.md)**: a **Battery** card with the last week and the 3 days ahead as bars (days ahead are lighter: they're a guess), every heads-up, and a **Day** picker to see what went into any of those days.

The words stay calm: **Full**, **Good**, **Getting low** and **Running low**.

## How it works

Each day starts with a charge from 0% to 100%, and the day's plans drain it. What's left by evening is the day's **level**.

**The start**

| What | Points |
|---|---|
| Sleep last night: Great, Good, OK, Poorly, Terrible | +90, +75, +60, +40, +25 |
| No sleep answer yet, and days ahead | their usual: the average of their answers in the last week (+65 with none) |
| Feeling tired or awful | −10 each |
| Feeling sore or bad | −5 each |
| An event ended after 8 PM the day before | −10 |
| Busy days in the last 3 (a day that drained 40 or more) | −5 each |

Other feelings don't change it. The start never goes under 0% or over 100%.

**The drain**

| What | Points |
|---|---|
| Each timed event (theirs and the family's, like [Insights](insights.md) counts them) | −10 |
| Long events: each hour past the first, up to 3 | −5 |
| Back to back: an event starting less than 15 minutes after the last one ended | −5 |
| A late evening: an event ending after 8 PM | −10 |
| Each of their chores due that day | −3 |
| A Temp check goal for the day | −5 |

All-day events (birthdays, school holidays) don't count, and chores only count while **Chores & points** is on.

Every day shows its reasons, for example "Sleep: ok (+60) · Late evening yesterday (−10) · 3 events (−30) · 2 chores (−6)". There's no hidden score.

## Heads-up before a heavy day

When today or one of the next 3 days is likely to end **under 25%** and something is planned, there's a heads-up:

> Tomorrow looks full: 5 events, 1 chore and a late evening. Maybe plan a rest or move something?

with a couple of plain ideas: **Rest before Art class** (the event that takes the battery under 25%) or **Plan a rest in the middle of the day**, and **Pick one thing to skip**. A day that's low only because of a rough night, with nothing planned, doesn't get one.

### The evening push

From **7:00 PM** (household time) the evening before a day like that, their own phones and tablets get one push: **🔋 Heads-up for tomorrow**, with the same line. Tapping it opens their [Insights](insights.md). It's at most one per person per day.

* Only devices that belong to them (set under **Settings → Access**) with notifications on. Never a shared wall or a parent's device, and it's not added to the family's notification feed.
* Never during [quiet hours](quiet-hours.md). If quiet hours cover the evening, it waits until they end and goes out that morning (until noon) as **🔋 Heads-up for today**.
* The text comes from the calendar and chores only. It never mentions sleep or feelings.

## Who can see it

It's worked out from sleep and feelings, so it's as private as [Insights](insights.md):

* **The person's own device** and **parents' devices**. Never a shared wall screen, the Board, a profile, or another person's device.
* **Claude and other connected apps** can't see it unless a parent turns on **Let connected apps see health entries**. There's no MCP tool for it.
* It's worked out each time it's opened and never saved. The only thing stored is the on/off setting, and a one-way hash that stops the push going out twice. See [Privacy](../your-data/privacy.md#energy-battery).

## API

`GET /api/members/{id}/battery` returns `{ memberId, on, today, days, warnings }`:

* `on`: false unless their Temp check and `tempCheck.battery` are on (then `days` and `warnings` are empty).
* `days`: the 7 days up to today, then 3 days ahead, oldest first: `{ date, forecast, start, drain, level, reasons: [{ text, points }], lowBefore }`. `lowBefore` is the first event that takes the battery under 25%, or `null`.
* `warnings`: `[{ date, text, suggestions }]` for today and the days ahead.
* 403 for a shared wall screen, another member's device and a connected app without `aiHealthAccess`.
