# Outings

A list the whole family adds to: things happening that you might go to (a fall fest, a concert, a movie coming out, a class) and places you can go any time (a nature preserve, a beach, a museum). Everyone marks what they'd like to do, the list narrows down to "what's for me" or "what's free this weekend", and when you decide to go, **Add to our calendar** puts it on the family calendar.

Outings are kept apart from the calendar on purpose: the calendar is what you're doing, Outings is what you might do.

Outings is one of Kinwall's **nooks**: a space of its own with several parts inside, like Meals and Trackers. "Nooks" is only a heading (in Settings → Features and the phone's **More** list); the tab is called **Outings**.

## Where it is

* **The Outings tab** (🎟, under **More** on a phone): **Upcoming** and **Places**, with filters.
* **Home → Board → 🎟 Outings**, next to 🗳 Polls: a tray with **This weekend** (what's on Saturday or Sunday, and places someone ⭐) and **Coming up** (the next 30 days: outings someone ⭐, and ticket dates: "Tickets go on sale Fri, Oct 16", "Get tickets by Tue, Oct 20"). **See all outings** opens the tab. On a phone and a portrait tablet the button is just 🎟. It's not shown on a screen whose view is locked.
* **An event made from an outing** shows **From Outings** with a link back (and the ticket page, if there is one).

## Upcoming and Places

**Upcoming** is grouped by when: This week, This weekend, Later this month, then by month. An outing that runs for a while (a pumpkin patch open all October) shows under **Open now** once it's started ("Until Oct 31"). One whose date isn't known yet is under **Date not announced yet**. Past outings drop off by themselves; the **Past** filter shows them. Nothing is deleted.

**Places** are any-time spots, under **Want to go** and **Been there** (with the last visit date).

Each row shows the category's emoji, when and where, the cost (**Free**, or the lowest price per person), who it's for ("Kids 7–10 · For Maya"), ticket dates, and who marked it (their faces, with ⭐ and 👀 counts).

## Filters

Tap **Filters**:

* **When**: any time, this weekend, the next 7 or 30 days, or past (Upcoming only).
* **Categories**: one or more.
* **Who it's for**: pick a person, then tick what counts as theirs:
  * **Just for Maya**: Maya is named on the outing.
  * **For kids (Maya's age)**: it's for kids and Maya's age fits its ages (a kid with no birth year always fits). A grown-up gets **For grown-ups** instead.
  * **For the family**: it's for the whole family.
* **Marked by**: anyone, someone marked it, ⭐ only, or one person.
* **Cost**: free only, under $10, under $25. An outing with no price drops out of a price filter.

Each filter that's on shows as a chip above the list; tap its ✕ to take it off. On a kid's own device the list starts on "for me" (all three boxes for that kid).

## Interested or really want to go

Open an outing and tap **👀 Interested** or **⭐ Really want to go**. Tap it again to clear it. ⭐ is the one that matters for reminders (coming soon).

* **A kid's own device** marks only for that kid ("Marking for Maya").
* **A wall screen** asks **Who?** first, then gets ready for the next person.
* **A parent's device** starts on its owner and can mark for anyone.

## Adding and editing

Tap **Add** on the tab or in the tray. **What is it?** is something happening or a place to visit. Then, all optional:

* **Category**: Food, Drinks, Music, Movies, Shows & theater, Art & museums, Fairs & festivals, Markets, Outdoors & nature, Beaches & water, Sports, Classes & workshops, Library & story time, Holidays & seasonal. A parent changes the list under **Filters → Edit categories** (rename, emoji, order, add, delete; deleting one leaves its outings with no category).
* **When**: the day (empty means "Date not announced yet"), **Runs for a while** for a first and last day plus **Days and hours** ("Fri–Sun, 9 AM to 5 PM"), and start and end times.
* **Where**: the place and address (for the **Map** link).
* **Cost**: **Free**, or the lowest price per person and a note ("Kids under 5 free"). Prices are shown and filtered, never added up.
* **Who it's for**: the whole family, kids (with the youngest and oldest age), grown-ups, and **Just for** specific people. This is who it suits, not who's interested.
* **Tickets or sign-up** (upcoming only): the ticket page, when tickets go on sale, and **Get tickets by**.
* **Been there?** (places): want to go or been there, and the last visit.
* **Details**: an info page and notes.

From an outing's **More…** menu: **Edit**, **We went today** (a place), **We have tickets**, **Not for us** (hides it from the list; it's kept and can be put back), and **Delete outing…** (parents).

### Who can do what

* **Parents** do everything.
* **Kids, on their own device**, add outings and places and edit the ones they added. Outings only for grown-ups (and not naming that kid) aren't shown on a kid's device.
* **Wall screens** show everything and mark interest after **Who?**; adding and editing are for parents and kids' own devices.

## Add to our calendar

On a parent's device, an outing's **Add to our calendar** asks for the day (for a run, which day you're going), the time or **All day**, the calendar, and **Who's going** (to start: everyone who ⭐ it and the people it's for). It becomes a normal event, so sync, reminders and leave-by all work. It goes in the **🎟 Outing** [category](categories.md), made the first time you use this; rename or recolor it like any category. The event has the place, notes, price and links, and says "From Kinwall Outings".

The outing then shows "On our calendar: Sat, Oct 10" with a link to the event, and the event links back. Deleting the event takes the link away; the outing stays. Deleting the outing leaves the event.

## Turning it off

Outings has its own switch in [Settings → Features](../settings/general.md#features). Off, the tab, the Board's 🎟 button and the event link are gone, and `/api/outings` answers 404. Nothing is deleted.

## For developers

REST: [`/api/outings`](../integrations/rest-api.md). MCP: `list_outings`, `get_outing`, `create_outing`, `update_outing`, `delete_outing`, `mark_outing_interest`, `add_outing_to_calendar`, `list_outing_categories` ([MCP](../integrations/mcp.md)). Webhook: `outing.changed`. Outings are in the family's export and import.
