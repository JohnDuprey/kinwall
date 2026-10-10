# Medications

Medication reminders help the family remember each person's medicines: a reminder at each dose time, a **Take now** card on the wall, and a simple record of what was taken. It's off until a parent turns it on.

## Turn it on

Medication reminders are part of the Health tracker. On a parent's device: **Settings → General → Features → Change**, then under **Health**, turn on **Medication reminders**. The first time, Kinwall says what it keeps and who sees it, and you tap **Turn on**. Turning it off, or turning off the Health tracker, hides everything again and stops reminders; what you saved is kept. See [Features](../settings/general.md#features).

## Add a medicine

On a parent's device, open **Trackers → Health**. The **💊 Medicines** section lists each person (the header's person filter narrows it); under a person, tap **+ Add medicine**. The Health tab shows while medication reminders are on, even if the Health tracker itself is off.

* **Medicine**: a name the family knows it by, like "Allergy medicine". There's no place for what it's for, and no need for one.
* **Dose** (optional): free text, like "1 tablet" or "5 mg".
* **Times**: one or more times a day (up to 8), in the household's time zone. **+ Add a time** adds another. Each time is **At a time** (a clock time) or **When I start my day**, with a latest time (12:00 PM unless you change it); see [When I start my day](#when-i-start-my-day). A medicine can have one of those.
* **Days**: **Every day**, **Weekdays**, **Weekends**, or **Certain days** with a button per weekday.
* **Can be taken late**: how long after its time a dose can still be taken. **Up to 3 hours** (the default), **Until evening (8 PM)**, **Until the end of the day**, or **Don't take late**. Some medicines shouldn't be taken late, so check with your doctor or pharmacist. A late window never ends sooner than 3 hours after the dose's time (a 7 PM dose set to **Until evening** still has until 10 PM), except **Don't take late**, where the card stays for 1 hour: long enough to notice it, short enough not to invite a late dose.
* **Ends** (for a course, like an antibiotic): **No end**, **On a date** (the last day of doses), or **After a number of doses** (reminders stop once that many are marked **Taken**; skipped doses don't count). The list shows "Until Mon, Oct 5" or "7 of 20 doses left", then "Done: all 20 doses taken". The history keeps the finished course.

Tap a medicine to change it. **More… → Delete medicine** removes it and its history. Only parent devices add, change or delete medicines.

## When I start my day

For a medicine taken first thing, whenever the day really starts (handy with irregular sleep), pick **When I start my day** instead of a clock time. The dose becomes due at the first of these, that day:

* the person answers their [Temp check](snapshot.md#temp-check);
* they check in by reading their day to the end (the daily check-in);
* their own phone or tablet opens Kinwall (for a grown-up, the phone or computer they picked themselves for under **Whose device is this?**);

or at the latest time, if none of those happen first. From that moment it works like any dose: the reminder, the **Take now** card and the late window all start then, and the reminder is sent once (starting the day after the latest time changes nothing). The card and the person's page say **Started at 9:40 AM**, or **When you start your day** before then.

Only the person counts. A parent's phone opening a kid's day, or a parent answering a Temp check or checking in for a kid, never starts a kid's day. Answering or checking in on a shared wall screen does (that's the kid, at the wall); so does a grown-up doing it on a parent device nobody owns, or on their own. Another grown-up's phone doesn't: answering Sam's Temp check on Alex's phone doesn't start Sam's day. The app tells the server once a day, on the person's own device only. Connected apps (like Claude) are never anyone's own device.

## Take now

At each dose time, **💊 Take now** ("3 due", with who) shows in the [Board](calendar.md#board-view)'s Today card, right under the events (a count tile across the top on a layout without Today); tap it to open the doses in a sheet. The person's **Day** view shows their doses right there. Each dose shows who, the medicine and the time, with three buttons:

* **Taken**: logs when and on which device, with a quick cheer that changes each time ("🚀 Leo for the win!") and a little confetti. Low-stimulation mode keeps it to a calm "Nice job, Leo." with no confetti. There are no points for medicine: points would be a reason to tap Taken without taking it, and they show on the leaderboard.
* **Skip**: logs that it was skipped on purpose.
* **Snooze 10 min**: hides the card for 10 minutes, then it comes back with one more reminder. On a grown-up's own phone (a parent device that belongs to them), snoozing a kid's dose hides it on that phone only: the kid's device and the wall keep showing it, and no extra reminder goes out.

Within 15 minutes of the dose's time, **Taken** is one tap. Later than that, it asks **When did you take it?**: **Just now**, **At 8:00 AM** (the dose's time), or **Earlier…** to pick a time between the start of the dose's day and now (a date and time for yesterday's dose). The Live Activity's **Taken** button always logs now.

The card stays until the dose is marked, or until its late window closes: 3 hours after its time by default, 8 PM, midnight, or 1 hour for **Don't take late**. After that the dose counts as **Not marked**.

On a shared wall screen the card says **Meds** instead of the medicine's name, unless the family turns on **Show medicine names on shared screens** (in **Trackers → Health → Medicines**). Anyone at the wall can mark a dose, since many families give medicines in the kitchen.

### On the Lock Screen

In the Kinwall phone app, a dose that's due also shows as a Live Activity on the person's own phone: **Time for Maya's medicine**, with a countdown to the end of its late window and **Taken** and **Snooze** buttons. From the follow-up point (halfway through a window longer than 3 hours) it says **Still time for Maya's medicine**. It ends when the dose is marked **Taken** or **Skip**, or when the window closes; **Snooze** hides it until the snooze runs out. It says "Maya's medicine" unless that phone turned on **Show medicine names on this device** (in the app's **Settings → This display → Notifications**; off by default), since the Lock Screen is visible to anyone nearby.

It shows a person's own doses: on their own device, or on a parent's device that belongs to that parent. Wall screens never get one.

**The kids' doses on a parent's phone**: a grown-up can turn on **Show the kids' doses on this phone** (in the app's **Settings → This display → Notifications**, on a full-access phone that belongs to them; off by default). Then a kid's dose that's due shows there too: **Leo · 8:00 AM medicine** (or **Leo · Allergy medicine · 1 tablet** with medicine names on). **Taken** marks it taken for Leo, recorded as done by that grown-up. **Snooze** hides it on that phone only for 10 minutes; Leo's device and the wall keep it. It ends as soon as anyone marks the dose anywhere (Leo's device, the wall, another parent), by the phone's next refresh with the app open. One countdown shows at a time: the earliest dose due, with **+1 more** (or +2, …) when others are due too; their own doses keep working alongside. The "hasn't been marked yet" note below still goes out as before.

## Reminders

At each dose time:

* the person's own phones and tablets get a push: **Time for Leo's medicine**. The medicine's name and dose are only in the text on devices that turn on **Show medicine names in notifications on this device** ([This display → Notifications](../settings/this-display.md#notifications)), since push text passes through Apple or Google and shows on the lock screen;
* the bell's feed gets the same line.

When a medicine's late window is longer than 3 hours (**Until evening** or **Until the end of the day**) and the dose still isn't marked halfway through it, the person's own devices get one more, gentler push, like **Still time for Maya's medicine (until 8 PM)**. For an 8 AM dose that's at 2 PM (until 8 PM) or 4 PM (until midnight): halfway leaves real time to take it, and one is enough. The wording changes from dose to dose and never says "missed" or "late". It isn't added to the bell's feed, and like the first reminder it names the medicine only on devices that turned names on.

For a kid (not a [grown-up](../settings/family.md#members)), if a dose isn't marked **Taken** or **Skip**, parent devices get **Maya's 8:00 AM medicine hasn't been marked yet**, once. With **Up to 3 hours** or **Don't take late** that's 30 minutes after its time. With a longer window it waits until about an hour is left (7 PM for **Until evening**, 11 PM for **Until the end of the day**): a kid who sleeps in isn't chased at 8:30 for a dose that's fine until 8 PM, and there's still time to help. Grown-ups' doses don't alert anyone.

Each reminder is sent once per dose (and once per snooze and follow-up), even if the server restarts. A dose that isn't scheduled that weekday sends nothing.

**Night hours**: medication reminders still come through during the [night hours](night.md), both the reminder to the person and the note to parents. Wall screens show the Night screen during the night hours; tap to wake it and see the Take now card.

**Do Not Disturb (Kinwall app for Android)**: a phone's own Do Not Disturb still silences medicine reminders. To let them through, tap **Let medicine reminders through Do Not Disturb** under [This display → Notifications](../settings/this-display.md#notifications). It opens Android's settings for Kinwall's **Medicine** notifications; turn on **Override Do Not Disturb** there. Other Kinwall notifications stay quiet.

## A person's medicines page

Open it with **Open medicines** on their [profile](profiles.md), or **History** next to their name in **Trackers → Health**. It shows:

* **Take now**, when something is due;
* **Today**: each dose with ✅ Taken, ⏭️ Skipped, 💊 Due now, ⭕ Not marked or 🕒 Later. A dose that's due or not marked has **Taken** and **Skipped** buttons, so a dose taken without tapping the card can still be logged. Past its late window the button says **Taken late**;
* **Yesterday**: yesterday's doses, with the same buttons on any that weren't marked, for catching up the next morning;
* **Last 7 days**: a row per medicine and a column per day.

Catching up asks **When did you take it?** too, and logs that time: a dose taken inside its late window shows ✅ **Taken** with its time even when it's marked hours later, and one taken after the window closed shows ✅ **Taken late**. A dose taken late counts toward a course's **doses left**.

### Fixing a dose

Marked it late, but it was really taken at 8:05? Tap a marked dose under **Today** or **Yesterday** to open **Change this dose**:

* **What happened**: **Taken**, **Skipped**, or **Not marked** (takes the mark back, so the dose shows as due or not marked again);
* **Taken at**: the time it was taken (a date and time for yesterday's dose). It can't be in the future or before the start of the dose's day; a late dose taken just after midnight is fine.

**Save**, and the dose shows its new status and time with a small "edited". Whether it was taken late, a course's **doses left** and the 7-day grid all follow the change. Kinwall keeps the first mark and which device changed it, encrypted with the rest of the log. Older days can't be changed.

Reminders and the "hasn't been marked yet" note for parents go by whether the dose is marked when they're due: changing a dose afterward doesn't send them again or take them back.

It opens on the person's own device and on parents' devices, and both can catch up and fix doses there (a kid's device, their own only). A shared wall screen shows only the Take now card (it has no history, so no catch-up or fixing); other people's devices get "private".

## Refills

Each medicine can say where and how to ask for a refill. Set it up from a parent's device: **Trackers → Health → Medicines**, tap the medicine, and fill in **Refills** at the bottom.

* **Ask for refills at**: who to ask, picked from your [contacts](contacts.md): doctors' offices and pharmacies first, then other places, then people. Or **Add a contact…** to make one right there, and **Edit contact** to change the one picked. Several medicines can share a contact, so you set up an office once. On the refill card it shows with:
  * its **phone numbers**, each with its [phone menu](contacts.md#phone-menus) if it has one, so **Call** gets you through "press 2 for prescriptions" for you,
  * its **websites and apps** (like the office's patient portal), each with **Open**.
* **Pharmacy**: pick it from your [contacts](contacts.md) (pharmacies are listed first, then other places), or type its name if it isn't a contact.
* **Date of birth** and **Callback number**: said in the message.
* **Remind me to ask on**: on that day at 9 AM, Kinwall adds the refill to-do by itself and sends a reminder (to a grown-up's own devices, or to parents' devices for a kid's medicine).

**Same as …** copies who to ask, the pharmacy, date of birth and callback number from the person's other medicine.

The message is always the same plain one: who it's for and their date of birth, the medicine with its dose and how often, the pharmacy and the callback number.

Refill places set up before refills moved to Contacts became contacts by themselves when the server updated: a service contact (relationship Medical) with the phone number and its phone menu, and the app link and website, or the menu and links were added to a contact with the same name. Each medicine now points to that contact. A place's own message wasn't kept; every card uses the message above.

### Request refill

On the person's [medicines page](#a-persons-medicines-page), **Refills** lists each medicine with **Request refill**. Tapping it:

1. adds a to-do, "Request refill: Allergy medicine for Leo", at the top of the page, in the bell (for parents and that person) and in **Trackers → Health**. There's only ever one open per medicine; tapping again just opens the card.
2. opens the refill card: the contact to ask, with **Open** for its websites and apps and **Call** for each phone number, the phone menu in words, the pharmacy with **Call** and **Map**, and **What to say** in large print, one sentence per line, with **Copy**.

**Call** dials the number and then the phone menu for you on most phones. Some phones ignore the waits, so the steps are written out too. Anything the family hasn't filled in shows in [brackets] in the message so you know to say it yourself.

When you've asked, tap **Done, requested** to close the to-do.

A kid's own device can request a refill for their own medicine too. Their card shows the contact to ask only if they can see that contact (set it to **Grown-ups only** to keep it off kids' devices), and the pharmacy contact likewise; otherwise the pharmacy's typed name.

## Who sees what

| Device | Sees | Can do |
|---|---|---|
| Parent devices | Everyone's medicines, cards with names, today and 7-day history, refill cards | Add, change, delete; pick who to ask for refills; mark and fix any dose; request refills |
| A person's own device | Their own medicines, cards, history and refill cards | Mark and fix their own doses and request their own refills (kids too) |
| Shared wall screen | Take now cards for whoever is due ("Meds" unless names are on) | Mark Taken, Skip or Snooze |
| Another person's device | Nothing about others' medicines | Nothing |
| Claude and other connected apps | Nothing, unless a parent turns on **Let connected apps see health entries** | With it on: read a refill card, request a refill, set the pharmacy and who to ask |

Everything is encrypted on the server, including who to ask, the pharmacy, date of birth and callback number, and the medicine notes in the bell's feed. See [Privacy](../your-data/privacy.md#medications).

## Not in this version

Pill counts and running-low warnings (a course can end after a number of doses, but Kinwall doesn't count what's left in the bottle), as-needed doses, schedules that change over time, interaction checks, and Home Assistant or webhook events.

## API

All medication routes answer 404 while the feature is off.

* `GET /api/medications?memberId=`: medicines (`{ id, memberId, name, dose, times, days, endDate, totalDoses, lateWindow, dosesLeft, createdAt, updatedAt }`, `days` 0 = Sunday, `lateWindow` one of `3h` (default), `evening`, `endOfDay`, `none`). Parent devices: everyone's; a person's own device: theirs. 403 on a shared wall.
* `POST /api/medications` with `{ memberId, name, dose?, times, days?, endDate?, totalDoses?, lateWindow? }`, `PATCH /api/medications/{id}`, `DELETE /api/medications/{id}` (and its log): parent devices only.
* `DELETE /api/medications`: delete all medication data (parents only; works while off).
* Each entry in `times` is `"HH:MM"`, or `{ "wake": true, "latest": "HH:MM" }` for **When I start my day** (one at most). Its doses use `time: "wake"`.
* `GET /api/medications/due`: `{ names, doses: [{ medicationId, memberId, date, time, dueAt, startedAt, until, name, dose }] }`, the Take now cards. `startedAt` is when the person's day started (a `"wake"` dose), `until` when the late window closes. `name` and `dose` are `null` on a shared wall with names off.
* `POST /api/medications/{id}/doses` with `{ date, time, action: "taken" | "skipped" | "snooze" | "unmark", at? }` (today's or yesterday's doses): parent devices, shared walls, and the person's own device. `snooze` from a grown-up's own device (a parent device that belongs to them, or its app's widgets key) on someone else's dose snoozes it for that grown-up's devices only (`GET /api/medications/due` there leaves it out; elsewhere it stays), and a mark from such a widgets key is recorded with that grown-up's name in `by`. `at` (ISO, taken or skipped only) is when it really happened, for a dose marked after the fact; the default is now. It must be between the start of the dose's household day (midnight) and now; up to 2 minutes ahead counts as a fast clock and is stored as now, anything else answers 400.
  * On a dose that's already marked, the same action without `at` changes nothing; a different action or an `at` changes it, and `unmark` takes the mark back. The answer has `edited: true`, and the sealed log keeps the first mark and the device that changed it. Changing a marked dose (or `unmark`) is for parent devices and the person's own device: a shared wall gets 409.
* `GET /api/members/{id}/medications?days=7`: `{ memberId, today, medications, days: [{ date, doses: [{ medicationId, time, dueAt, status, startedAt, at, late, by, edited }] }] }`, oldest first. `at` is when it was taken or skipped, `late` whether it was taken after its late window closed, `edited` whether it was changed after it was first marked. Their own device and parent devices only.
* `POST /api/members/{id}/day-started`: the person's own device opened the app today (204; again the same day changes nothing). Their own device only: a device paired as theirs, or for a grown-up a full-access key, passkey or Kinwall app sign-in they own (`PUT /api/me/owner`). 403 for other parent devices, shared walls, connected apps and anyone else.
* Each medicine also has `refill: { contactId, pharmacyContactId, pharmacy, dateOfBirth, callback, remindOn }` (set with POST or PATCH; PATCH changes only the refill fields sent; `contactId`, who to ask, and `pharmacyContactId` must be contacts, else 400) and `refillRequest: { at, by } | null`, the open to-do.
* `GET /api/medications/{id}/refill`: the refill card, `{ medicationId, memberId, contact: { id, name, phones: [{ label, number, steps, telUri }], websites: [{ label, url }] }, pharmacy: { name, contactId, phone, telUri, address }, script, request }`. Parent devices and the person's own device. `contact` is the contact as that device may see it (null if it can't); `steps` is a phone's menu in words and `telUri` dials it. Phone menus are set on the contact (`phones[].menu`, see [Contacts](contacts.md#phone-menus)).
* `POST /api/medications/{id}/refill-request` with `{ action: "open" | "done" }`: open the to-do (201, `created: true`, with a bell note) or, if one is open already, return it (200, `created: false`); `done` closes it. Parent devices and the person's own device.
* Connected apps get 403 unless `aiHealthAccess` is on. There are no webhook events. MCP tools: `get_medication_refill`, `request_medication_refill`, `set_medication_pharmacy`, `set_medication_refill_contact`.
