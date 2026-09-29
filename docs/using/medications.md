# Medications

Medication reminders help the family remember each person's medicines: a reminder at each dose time, a **Take now** card on the wall, and a simple record of what was taken. It's off until a parent turns it on.

## Turn it on

Medication reminders are part of the Health tracker. On a parent's device: **Settings → General → Features → Change**, then under **Health**, turn on **Medication reminders**. The first time, Kinwall says what it keeps and who sees it, and you tap **Turn on**. Turning it off, or turning off the Health tracker, hides everything again and stops reminders; what you saved is kept. See [Features](../settings/general.md#features).

## Add a medicine

On a parent's device, open **Trackers → Health**. The **💊 Medicines** section lists each person (the header's person filter narrows it); under a person, tap **+ Add medicine**. The Health tab shows while medication reminders are on, even if the Health tracker itself is off.

* **Medicine**: a name the family knows it by, like "Allergy medicine". There's no place for what it's for, and no need for one.
* **Dose** (optional): free text, like "1 tablet" or "5 mg".
* **Times**: one or more times a day (up to 8), in the household's time zone. **+ Add a time** adds another.
* **Days**: **Every day**, **Weekdays**, **Weekends**, or **Certain days** with a button per weekday.
* **Can be taken late**: how long after its time a dose can still be taken. **Up to 3 hours** (the default), **Until evening (8 PM)**, **Until the end of the day**, or **Don't take late**. Some medicines shouldn't be taken late, so check with your doctor or pharmacist. A late window never ends sooner than 3 hours after the dose's time (a 7 PM dose set to **Until evening** still has until 10 PM), except **Don't take late**, where the card stays for 1 hour: long enough to notice it, short enough not to invite a late dose.
* **Ends** (for a course, like an antibiotic): **No end**, **On a date** (the last day of doses), or **After a number of doses** (reminders stop once that many are marked **Taken**; skipped doses don't count). The list shows "Until Mon, Oct 5" or "7 of 20 doses left", then "Done: all 20 doses taken". The history keeps the finished course.

Tap a medicine to change it. **More… → Delete medicine** removes it and its history. Only parent devices add, change or delete medicines.

## Take now

At each dose time, a **💊 Take now** tile joins the [Board](calendar.md)'s count tiles ("2 due", with who); tap it to open the doses in a sheet. The person's **Day** view shows their doses right there. Each dose shows who, the medicine and the time, with three buttons:

* **Taken**: logs when and on which device, with a quick cheer that changes each time ("🚀 Leo for the win!") and a little confetti. Low-stimulation mode keeps it to a calm "Nice job, Leo." with no confetti. There are no points for medicine: points would be a reason to tap Taken without taking it, and they show on the leaderboard.
* **Skip**: logs that it was skipped on purpose.
* **Snooze 10 min**: hides the card for 10 minutes, then it comes back with one more reminder.

The card stays until the dose is marked, or until its late window closes: 3 hours after its time by default, 8 PM, midnight, or 1 hour for **Don't take late**. After that the dose counts as **Not marked**.

On a shared wall screen the card says **Meds** instead of the medicine's name, unless the family turns on **Show medicine names on shared screens** (in **Trackers → Health → Medicines**). Anyone at the wall can mark a dose, since many families give medicines in the kitchen.

## Reminders

At each dose time:

* the person's own phones and tablets get a push: **Time for Leo's medicine**. The medicine's name and dose are only in the text on devices that turn on **Show medicine names in notifications on this device** ([This display → Notifications](../settings/this-display.md#notifications)), since push text passes through Apple or Google and shows on the lock screen;
* the bell's feed gets the same line.

For a kid (not a [grown-up](../settings/family.md#members)), if a dose isn't marked **Taken** or **Skip** within 30 minutes, parent devices get **Maya's 8:00 AM medicine hasn't been marked yet**, once. Grown-ups' doses don't alert anyone.

Each reminder is sent once per dose (and once per snooze), even if the server restarts. A dose that isn't scheduled that weekday sends nothing.

**Quiet hours**: medication reminders still come through during [quiet hours](quiet-hours.md), both the reminder to the person and the note to parents. Wall screens show their night clock during quiet hours; tap to wake it and see the Take now card.

## A person's medicines page

Open it with **Open medicines** on their [profile](profiles.md), or **History** next to their name in **Trackers → Health**. It shows:

* **Take now**, when something is due;
* **Today**: each dose with ✅ Taken, ⏭️ Skipped, 💊 Due now, ⭕ Not marked or 🕒 Later;
* **Last 7 days**: a row per medicine and a column per day.

It opens on the person's own device and on parents' devices. A shared wall screen shows only the Take now card; other people's devices get "private".

## Who sees what

| Device | Sees | Can do |
|---|---|---|
| Parent devices | Everyone's medicines, cards with names, today and 7-day history | Add, change, delete; mark any dose |
| A person's own device | Their own medicines, cards and history | Mark their own doses (kids too) |
| Shared wall screen | Take now cards for whoever is due ("Meds" unless names are on) | Mark Taken, Skip or Snooze |
| Another person's device | Nothing about others' medicines | Nothing |
| Claude and other connected apps | Nothing, unless a parent turns on **Let connected apps see health entries** | Nothing (no MCP tool) |

Everything is encrypted on the server. See [Privacy](../your-data/privacy.md#medications).

## Not in this version

Refills and pill counts (a course can end after a number of doses, but there is no refill tracking), as-needed doses, schedules that change over time, interaction checks, and Home Assistant or webhook events.

## API

All medication routes answer 404 while the feature is off.

* `GET /api/medications?memberId=`: medicines (`{ id, memberId, name, dose, times, days, endDate, totalDoses, lateWindow, dosesLeft, createdAt, updatedAt }`, `days` 0 = Sunday, `lateWindow` one of `3h` (default), `evening`, `endOfDay`, `none`). Parent devices: everyone's; a person's own device: theirs. 403 on a shared wall.
* `POST /api/medications` with `{ memberId, name, dose?, times, days?, endDate?, totalDoses?, lateWindow? }`, `PATCH /api/medications/{id}`, `DELETE /api/medications/{id}` (and its log): parent devices only.
* `DELETE /api/medications`: delete all medication data (parents only; works while off).
* `GET /api/medications/due`: `{ names, doses: [{ medicationId, memberId, date, time, dueAt, name, dose }] }`, the Take now cards. `name` and `dose` are `null` on a shared wall with names off.
* `POST /api/medications/{id}/doses` with `{ date, time, action: "taken" | "skipped" | "snooze" }` (today's or yesterday's doses): parent devices, shared walls, and the person's own device.
* `GET /api/members/{id}/medications?days=7`: `{ memberId, today, medications, days: [{ date, doses: [{ medicationId, time, status, at, by }] }] }`, oldest first. Their own device and parent devices only.
* Connected apps get 403 unless `aiHealthAccess` is on. There are no webhook events and no MCP tool.
