# Home upkeep

**Upkeep** keeps the jobs that come round every few months or years: the furnace filter, smoke alarm batteries, the water heater, the gutters, the car's oil change. It remembers when each one was last done, who did it and what it cost, and reminds you before the next one is due.

Turn it on or off in [Settings → General → Features](../settings/general.md#features) (**Home upkeep**, under Spaces).

## Things, jobs and Done

* A **thing** is something you look after: the furnace, the fridge, the blue van, the yard. It keeps where it is, its brand, model and serial number, what to buy for it ("Filter 16x25x1, MERV 8"), when you bought it and for how much, the warranty's end, a link to the manual, the [contact](contacts.md) who services it, notes, and files: receipts, the manual, a photo of the label.
* A **job** keeps a thing working: "Change the furnace filter". It belongs to a thing, or just to an area ("Safety").
* **Done** is one time a job was done: the day, who did it, and on a parent's device the cost, a reading (the odometer or an hour meter), notes and a receipt.

Areas group things: Heating & cooling, Water & plumbing, Kitchen & laundry, Safety, Outside & yard, Cars & bikes and Pets to start.

## How a job repeats

| Repeats | Example | When it's due next |
|---|---|---|
| **Every so often, from the last time** | Every 3 months | That long after it was last done. Done late, the next one moves too. Never done: its first due date, else right away. |
| **On set dates each year** | Every April 15 and October 15 | The next of those dates. Done a little early (within its heads-up days) still counts for that date. A day past a month's end is its last day. |
| **Just once** | Fix the cracked window | Its day; once it's done, it's done. |

**Heads-up, days before** (7 by default) is when a job shows as **Due soon** and its heads-up note goes out.

In a job's **More…**:

* **Not this week** (when it's late or due within the week) moves it a week on, just this time. Marking it done puts it back on its usual schedule.
* **Skip this time** logs nothing and counts the next one on from the date skipped.
* **Add to the calendar…**, for a pro's visit: a normal event with the job's title, the thing and the steps.
* **Put it away** keeps the job and its history but stops its reminders; it waits under **N jobs put away** at the foot of Due, where **Put it back** returns it. **Delete job…** removes it; what was done stays in the history.

## The Upkeep tab

* **Due**: **Late**, **Due soon** and **Later**, each job with when it's due, its thing, when it was last done and who usually does it, and a **Done** button right on the row (a ✓ on a phone).
* **Things**: by area (a thing marked **Sold or gone** waits under **N sold or gone**, its jobs put away with it), with each one's warranty ("Warranty until Mar 2028", "Warranty ends in 12 days") and its next job.
* **History**: every Done, newest first, by year. On a parent's device each year shows what upkeep cost ("$1,240 on 18 jobs"), and **Search the history** looks through titles and notes. This is the one place Kinwall adds prices up.

**Add common jobs** offers a checklist of usual ones (furnace filter, smoke alarm tests and batteries, the water heater, dryer vent, fridge filter and coils, gutters, sump pump, oil change, tire rotation, car registration, fire extinguisher), each with a usual schedule. Nothing is added unless you tick it; check your manual and change any of them later.

A link to `#/upkeep?job=<job id>` opens that job, and `#/upkeep?thing=<thing id>` that thing (the bell and the Board use them).

## Marking a job done

**Done** asks only what it needs: **When** (today; up to 7 days back from a wall or a kid's device, any day from a parent's) and **Who did it**. A parent's device also takes the **Cost** (the job's usual cost is filled in), a **Reading** in miles, kilometers or hours, **Notes** and a **Receipt or photo**. Under it, **Next due** shows where the schedule moves. The toast says "Done: Change the furnace filter" with **Undo**.

## On the Board

Jobs late or due soon show with the to-dos: as **🔧 2 upkeep jobs due soon** (or **late**) in Today, and in the **Due soon** card with each job and when it's due. When someone is picked at the top, it's their jobs and the ones nobody is set to do. Jobs with **Show it on wall screens** off stay off wall screens.

## Kids' upkeep chores

Set **Usually done by** to a kid and tick **Make it their chore on the day it's due** with some points. On the day the job comes due (from 9 AM, household time), it becomes a one-off [chore](chores.md) for them with those points. Ticking that chore off marks the job done by them that day; undoing the tick takes it back.

## Supplies on the shopping list

List a job's **Supplies to buy, one per line**. That many days before it's due (**Days before it's due**, 7 by default), each goes on its shopping list (the family's first Shopping list unless you pick one), once per due date, remembering its store and aisle like any item. Something already on the list and not ticked off isn't added again.

## Reminders

From 9 AM (household time), each once, held through [night hours](night.md):

| Note | When | To |
|---|---|---|
| "🚿 Flush the water heater is due Friday" | Its heads-up days before | Who usually does it, and the grown-ups unless that's a grown-up |
| "… is due today" | The day (a missed morning catches up for a week) | The same |
| "🔧 Clean the gutters is 7 days late" | A week late, then every two weeks, three at most | The grown-ups |
| "🧾 The warranty on the dishwasher ends Nov 20" | 30 days before | The grown-ups |

They're in the bell, and pushed where **Home upkeep** is on in [Notifications](notifications.md).

## Who sees what

| | A parent's device | A kid's own device | A wall screen |
|---|---|---|---|
| Jobs | All | Their own | The ones shown on the wall |
| Mark done | Yes, any day | Their own, the last 7 days | Yes, for whoever picks themselves, the last 7 days |
| Things | Everything | Name, room and emoji | Name, room and emoji |
| Costs, readings, notes, serial numbers, warranty, files, pros | Yes | No | No |
| History | All | Their own, without costs or notes | No |
| Add, change, delete | Yes | No | No |

Kinwall leaves the hidden parts out of what it sends, not just off the screen. Notes say **Don't save codes or passwords here**: the garage door code or the Wi-Fi password don't belong in upkeep.

## For automations

Upkeep has REST routes under `/api/upkeep` ([REST API](../integrations/rest-api.md)), the webhooks `upkeep.changed`, `upkeep.done` and `upkeep.due` ([Webhooks](../integrations/webhooks.md)), and MCP tools like `list_upkeep_jobs`, `log_upkeep_done` and `list_upkeep_history`, so you can ask "When did we last change the furnace filter?" ([MCP](../integrations/mcp.md)). Its things, jobs and history are in the [export](../your-data/export-import.md); receipts and manuals are in the photo backup zip.
