# Trips

**Trips** is where the family plans going somewhere together, from "someday" to the drive home: where you'll stay (and a family vote on it), getting there, a day plan and lists. Prices are shown as listed, side by side. Kinwall never adds them up, books anything or checks a booking.

Look for the suitcase in navigation to open **Trips**. It's off until a grown-up turns it on in [Settings → General → Features](../settings/general.md#features) (**Trips**, under Nooks). [Away days](away.md) work whether Trips is on or off.

## The Trips tab

Three sections:

* **Ideas**: trips with the status Idea. Everyone can mark an idea 👀 **Interested** or ⭐ **Really want to go**, like an outing, so grown-ups see what the kids are excited about.
* **Upcoming**: trips being planned or ready, under **Soon** (under way, or starting within 30 days) and **Later**. Dated trips are in date order; trips without dates come last.
* **Past**: trips whose last day has gone, newest first.

A trip can have exact dates (first and last day), or just words for when ("Sometime in February", "next summer"). Words are shown as written. Kinwall never turns them into dates, and they never start away days.

A grown-up's device has **Add trip**. A trip needs only a name; dates, where, who's going and a few words about it can wait. Trips that are **Not this time** or **Put away** fold under **Put away** at the foot of the list.

## Plan status

Each trip has a status a grown-up picks in **Add trip** or **Edit trip**:

| Status | Means |
|---|---|
| 💭 **Idea** | A name is enough. |
| 🗺️ **Planning** | Comparing places, voting, booking. |
| ✅ **Ready** | We're set. Ready means "we're set", not "we paid": a weekend at a family home with nothing to book can be Ready. |

**🧳 Underway** and **📸 Past** come from the dates, not the status. Booked and Chosen are badges on each place to stay and each leg, never the trip's status.

## A trip's page

A trip opens on one page with, from the top:

* Its dates, where, who's going and its status. A grown-up's device has **Edit trip**, where its status is set too. **Not this time**, **Put away** and **Delete trip…** are at the foot of the page.
* **Today on the trip** while it's under way: today's legs, check-ins and plans, **Tonight** (where you're sleeping: a chosen place, never a canceled one) and what's **Next up** after today. A line says whose clock "today" follows (see [Today on the trip](#today-on-the-trip)).
* **Next up** before the trip: the next leg, check-in or plan. Things with a time and a time zone are put in order by the actual moment, so a 9:00 flight in Boston comes before an 8:30 one in Denver.
* **Needs a decision**: an open stay vote, a stay nobody has chosen yet, and on a grown-up's device a leg that isn't booked yet (drives and "other" aside) and, for a dated trip with people going, away days that aren't set up.
* **Worth a look**: [plan checks](#plan-checks), on a planned trip with dates.
* A row for each part: **Stops** (grown-ups, or once there are some), **Places to stay**, **Getting there**, **Day plan**, **Home and pet care** (grown-ups' own devices only), **Lists**, and on a grown-up's device **On our calendar**, **Booking details** and **Away days**. Each opens on its own page; **‹** goes back.

The address of a trip is `#/trips?trip=<id>`, and of a part `#/trips?trip=<id>&part=stays` (`stops`, `travel`, `plan`, `care`, `lists`, `calendar`, `details`).

## Today on the trip

While a trip is under way, "today" (which day of the plan, **Tonight**, **Day 3 of 8**) follows the clock where the family is, worked out from the plan, never from a device's location:

* on the day of a leg everyone going is on (a rental car aside), with its times and time zones set, the time zone it leaves from until it lands;
* at a stop with its dates and time zone set, that stop's time zone, from the stop's arrive day until its leave day begins;
* on the day such a leg lands, with no stop saying otherwise, the time zone it landed in;
* otherwise home time. The line says so ("Home time (New York): the plan doesn't say which time zone you're in right now"), so home's date is never mistaken for the local one. It also falls back to home time when two stops that overlap have different time zones, or a stop that could be the current one has no time zone.

A grown-up with full access can tap **Change** and pick **Follow the time in** to choose a time zone for the trip; **Not sure** goes back to working it out. This changes only what Today shows. No date or time in the plan moves, and each leg and activity keeps showing its own place's time. The page turns over at midnight there, and across a daylight-saving change, without a reload.

[Away days](away.md) and home and pet care always use home calendar dates. The trip's row in the Trips tab and the Board's **Day 3 of 8** use the server's reading of the same rules when it follows a place on the trip. These views keep up as the local day changes, even when nobody changes the plan.

## Plan checks

**Worth a look** on a trip's page lists things in the plan that may not line up, each with **Look** to open the part it's about:

* nights with no chosen place to stay (shown as the nights themselves, "Sat, Jul 10 – Mon, Jul 12"); nights on a timed overnight flight, train, bus or ferry that everyone going is on count as covered;
* two chosen places to stay with nights that overlap ("Fine if the family splits up for those nights");
* a stop, stay, leg or activity dated outside the trip's dates;
* two timed legs for the same people whose times overlap (a rental car aside), or a leg that arrives before it leaves. These compare the actual moments, so they need both ends' times and time zones; a leg without them isn't checked.

They're advice, never errors: nothing is blocked and nothing changes unless you change it. Canceled places and legs, and anything without dates, are left out. An idea or a called-off trip shows no checks. With nothing to flag, it says **Nothing to look at in what's been added so far**, which doesn't mean the plan is complete.

## Home and pet care

**Home and pet care** keeps track of who looks after the pets, the plants or the house while you're away. Each arrangement has:

* what it's for (**Pets**, **Plants**, **The house**, **Something else**) and a name ("Feed and walk Biscuit");
* a helper's name and how to reach them, both optional. A helper is just a name: they don't need a Kinwall account, and Kinwall never messages, invites or gives them a login;
* the **First day** and **Last day** at home, on the family calendar, whatever time it is on the trip;
* **Status**: **Need someone**, **Asked, waiting to hear**, **✓ Confirmed** or **✕ Canceled**. One that still needs someone also shows under **Needs a decision**;
* a **checklist**, ticked off as things get done;
* **🔒 Private** notes: **Instructions**, **Getting in** (a key, a door code, the alarm) and **If something goes wrong** (the vet, a neighbor). Keep medical details out.

It's tracking only: no chores are made or handed off (for chores, use [Away days](away.md)).

| | Grown-up's device with full access | A grown-up's own everyday device | Kid's own device | Wall screen | Connected apps (MCP) |
|---|---|---|---|---|---|
| See home and pet care | ✓ | ✓ | | | |
| Add, edit, tick off and delete | ✓ | | | | |

This is separate from the trip's **Booking details** setting: sharing booking details with everyone or the wall never shares home and pet care. Your server sends it only to those devices, keeps all of it encrypted, leaves it out of the trip list, the Board, notifications, webhooks and connected apps, and never keeps it in the app's offline storage. If some of it can't be opened (the server's encryption key changed, say), the page says **Some home or pet care could not be opened** instead of showing it as empty; the rest still works, but a private backup can't be made until it's fixed. Check the server's encryption key or restore a private backup. Deleting an arrangement asks first. Changing the trip's dates never moves an arrangement's days: the date review lists them under **🔒 Home and pet care** so you can check with the helper.

## Stops

A trip to one place needs no stops. For a road trip, **Stops** keeps the places on the way in order: a name, the town, **the time zone there**, arrive and leave days, and notes. Grown-ups add, edit, delete and move them up or down. A stay can belong to a stop, and a new activity's time zone starts as the first stop's that's set. Deleting a stop keeps its stays, without a stop.

## Places to stay

A **stay** is where you sleep for some nights: one for the whole trip, or one per stop on a road trip ("Harbor Point", "Pine Ridge"), with arrive and leave dates. Each stay has its own places to compare, its own vote and its own final choice. Only grown-ups add stays and places to stay.

**Add a place** opens one sheet. Pick the **Kind of place** (rental home, hotel, staying with family, camping or other); only a name is needed.

* **Link (optional)**: paste a hotel, rental or any public page and tap **Read the page**. Kinwall reads only what the page publishes about itself (its structured data, Open Graph or Twitter card): the name, town, a picture, sometimes a price or how many it sleeps. It fills in only empty fields, and you check and change each one before you add it. Many listing sites don't let Kinwall read their pages, and that's fine: the link still saves and you fill in the rest by hand. Kinwall doesn't check prices or whether a place is free on your dates.
* **Staying with family**: a relative's or friend's home. It needs only a name and has no link, picture or booking step, and the people who live there don't need Kinwall. It can still be one of the choices in a vote.

What each place can keep: kind, name, town, a link, a picture, cost, how many it sleeps and notes.

**Cost** is one of **Not set yet**, **Free**, **We'll offer to chip in** or **A price**. "Not set yet" shows as **Cost not set yet** and never counts as free. A price keeps its amount in its own currency (no conversions), what it's for (**a night**, **the whole stay**, **a week**, **a person**), whether fees and taxes are included, and the date you saw it ("as listed Mon, Nov 2"). The **Added order | Lowest price** picker appears only when every place has a price in the same currency for the same thing.

### Pictures

When a page shares a picture, the place shows it with the site's name on it. Before saving, the sheet says where the picture comes from ("Picture from stays.example.com. It appears after saving.") with **Remove picture** and **Use a different picture** (paste another `https://` picture link).

Kinwall keeps only the picture's link. Your server fetches it each time it's shown (checking it's a public `https://` image of 8 MB or less), the same way Meals pictures work, and the browser may keep it for up to a week. No copy is saved on the server or in the app's offline storage, and Kinwall never takes a screenshot of a page. With no picture, or one that won't load, the card just shows without it.

### Voting

With two or more places, a grown-up taps **🗳 Ask the family**. That starts a [family poll](polls.md) whose choices are the places, and **everyone going on the trip** gets one vote, which they can change. Kids vote as themselves; a wall asks **Who?**; a grown-up's phone votes as its owner, with **Someone else**.

* While voting is open, the places can't change. Tap **End voting** to add or change a place, then ask again.
* **End voting** never picks a winner, not even with a clear leader, a tie or no votes.
* Changing a place after voting has ended starts fresh: the last vote's results stay with it, and the family votes again on the new choices.

A vote also shows in the Board's **Today at a glance**, the bell and the Polls list, like any poll. With Family polls off, there's no vote; a grown-up chooses directly.

### Choosing and booking

**Choose this one** (a grown-up) marks the place ★ **Chosen**. A grown-up can choose a place that isn't in the lead; Kinwall asks once to be sure. **Undo choice** clears it. Actually changing anything about the chosen place other than its booking, notes or booking details (its name, kind, town, link, picture, cost or how many it sleeps) clears the choice too, so a choice never quietly means something else. Saving the sheet without changing those keeps the choice and any vote.

Booking is separate: in the place's **Edit**, set **Booking** to **Booked** after you've booked it elsewhere, or **Canceled**. A family home has **With the family**: **Confirmed with family**, with no booking or payment step.

## Getting there

Legs are the parts of the journey, in order: flights, drives, trains, buses, ferries, rental cars. They're records to keep track of, not options to compare or vote on.

Each leg can keep: how, a name, from and to, when it leaves and arrives, **the time zone at each end**, the airline or company and number, who's on it (it can differ from who's going: Sam flies out later), booking (**Not booked yet**, **Booked**, **Canceled**; drives say **Plan only**) and notes.

* Times show in the zone where they happen: "7:05 AM EDT → 9:12 AM CDT". **+1** marks arriving the next day on the arrival clock. A leg across the date line can arrive "earlier" than it left.
* Leave a zone as **Not sure** rather than guessing. Kinwall then shows the time as "(local time)" and never assumes your home time zone.
* Booked shows only when a grown-up marks it. Kinwall doesn't check airlines.

## Day plan

One day per date of the trip, then **Things to do there** (ideas not on a day yet). A day shows only what's tied to this trip:

* **Legs** and **arrive / leave** for each stay, from their own records (marked **From Getting there**, **From Places to stay**).
* **Trip activities**: things to do there. Kids can **Suggest something** (it lands in Things to do there, "Maya's idea"); grown-ups add, edit and put things on a day. Everyone marks activities 👀 or ⭐.
* **Linked** outings, meals and calendar events (**Link from Outings, Meals or the calendar**, grown-ups). The outing, meal or event stays where it is, keeps its own date and marks, and the trip shows it with **From Outings**, **From Meals** or **From the calendar**. It's never copied. If it's deleted, the trip keeps its name with **No longer there**. A linked meal shows the trip's name ("🌊 Summer road trip") in the Meals week, and a linked or added event shows **From Trips**.

Home meals on those dates never appear unless someone links them, so a parent staying home doesn't see their dinners in someone else's trip.

## Lists

Link one or more existing [lists](lists.md) with **Linked lists**, or choose **Make a list**, give it a name and select its type: **Packing / reusable**, **Groceries**, **Shopping**, **To-do** or **Pantry**. You can use separate lists for each person’s packing, cabin groceries, supplies and things to do before leaving.

Each list opens in Lists and keeps its normal behavior, including reusable resets and grocery shopping tools. The trip shows its type and checked-item progress. Lists are shared references: editing one changes that same list wherever it is used. Unlinking a list or deleting the trip keeps the list and its items. List permissions stay the same; reservation visibility does not protect list contents, so keep entry codes in protected booking details.

Older `part=packing` links still open Lists.

## On our calendar

Nothing goes on the calendar until a grown-up picks it in **On our calendar**: the whole trip as an all-day event (first to last day), legs with a date, time and time zone, chosen places to stay with dates, and activities with a date, time and time zone (an activity's zone starts as the first stop's time zone that's set). Places you didn't choose never go on. If adding to a synced calendar fails (it needs reconnecting, say), that row says so; tick it again and **Add** tries only what's missing, never a duplicate. If the calendar didn't answer clearly, the row says **⏳ Not sure it was added**: check the calendar. Kinwall won't add it again by itself, so it can't end up there twice.

Events made from a trip are ordinary events, with **From Trips** on the event linking back to the trip. Changing or deleting the trip never changes or deletes them.

## Changing a trip's dates

New dates on a trip that has things tied to the old ones first show **Change the trip's dates?**: its away days, calendar events, linked meals, booked travel and places to stay, and on a grown-up's device with full access, home and pet care. Saving changes only the trip's dates. Each of those keeps its date until someone changes it on its own. Kinwall can't change a booking.

## Booking details

Some things about a place to stay or a leg are private: a place's **street address**, **host or front desk** (or **contact at the house**), **arrival notes**, door, lockbox and Wi-Fi **codes**, **confirmation number** and **manage booking link** (these two not for a family home), and a leg's confirmation number, booking link and private notes. Grown-ups enter them under **🔒 Booking details** in the place's or leg's sheet. Each trip sets who sees them (**Booking details**, grown-ups):

| | Grown-ups' devices | Kids' own devices | Wall screens |
|---|---|---|---|
| **Grown-ups only** (the default) | ✓ | | |
| **Everyone in the family** | ✓ | ✓ | |
| **Everyone in the family** + **Show on wall** | ✓ | ✓ | ✓ |

**Show on wall** is off by default and works only with Everyone in the family, like [Contacts](contacts.md). Where details are hidden, a row says **🔒 Booking details are for grown-ups**, so kids know to ask.

Everything else is plans the whole family sees on every device, including trips they aren't going on: names, dates, towns, place names, prices, travel times and the day plan, unless the trip is set so only some see it (below). Keep codes out of a trip's description and notes, which everyone reads.

Your server leaves booking details out of what it sends to devices that may not see them, keeps them encrypted, and never puts them in notifications, webhooks, a person's day, the Board or [connected apps (MCP)](../integrations/mcp.md). Trips are never kept in the app's offline storage. Changing the setting stops new reads at once; it can't take back a screenshot.

## A surprise trip: who can see it

**Who can see this trip**, in **Add trip** and **Edit trip**, is **Everyone in the family** by default. To plan a surprise, choose:

* **🔒 Grown-ups only**: grown-ups' own devices see the trip; kids' own devices don't.
* **👥 Only some people**, then **Who can see it**: only those people's own devices see the trip.

Either way, devices with full access always see it (they're the ones that change and delete trips), and wall screens never do. [Connected apps (MCP)](../integrations/mcp.md) see it only with **Connected apps can see it** turned on for that trip (off by default): an assistant connected to Kinwall may answer anyone in the family who asks it. Anyone else doesn't see the trip at all: not in Trips, its stay votes, trip tags on meals, outings and events, or the trip named on away days. The trip shows **🔒 Grown-ups only** or **👥 Only some people** to those who see it. Choose it when you add the trip, so it's never shown to the wrong people. A surprise for a grown-up works only if their devices don't have full access.

A few things still show, because they live outside the trip:

* Away days made from it stay (they pause chores) and everyone sees their dates. Filled in from a trip like this, they're named **Away** instead of the trip's name.
* Events you put on a calendar are seen by everyone who sees that calendar.
* Linked lists, meals and outings are seen as usual, without the trip's name.

Only a grown-up with full access changes these settings; a connected app can't.

## Who can do what

| | Grown-up's device | Kid's own device | Wall screen |
|---|---|---|---|
| See every family trip's plans (except trips set so only some see them) | ✓ | ✓ | ✓ |
| Mark ideas and activities 👀 / ⭐ | ✓ | as themselves | after **Who?** |
| Suggest something to do | ✓ | ✓ | |
| Vote on a stay | as themselves if going, or **Someone else** going | as themselves, if going | after **Who?** (people going) |
| Add trips, stays, places, legs; choose; mark booked; status; calendar; booking details setting | ✓ | | |
| See home and pet care | ✓ (grown-ups' own devices) | | |

## On the Board

The Board has no Trips button. **Today at a glance** shows a trip when it's under way ("🌊 Summer road trip · Day 3 of 8") or starts within two weeks ("In 12 days"), and who's away today (see [Away days](away.md)). An open stay vote shows like any poll.

## Turning it off

With Trips off there's no Trips tab, no trip line on the Board, and trip votes leave the Board, bell and Polls list. `/api/trips` answers 404, so the MCP trip tools answer that it's turned off. Nothing is deleted. [Away days](away.md), including ones made from a trip, keep working and stay editable in Chores and Settings → Family. Calendar events made from a trip stay as ordinary events.

## Deleting a trip

**Delete trip…** at the foot of the trip removes the trip, its stops, stays, places, legs, day plan and stay votes. A grown-up confirms first. Calendar events, meals, outings and away days made from it stay.

Places to stay can be sorted with **Added order** or **Lowest price**; added order keeps the existing order of the places. Calendar links use checkable rows, and home-care tasks use the same done-tick as list items.
