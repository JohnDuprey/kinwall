# Journal

Each person's own place for their days: their [Temp check](snapshot.md#temp-check) answers, how their goals went, and notes they write themselves. It's the start of bullet journaling in Kinwall.

Open it with **Journal** in the menu on a person's own device (under **More** on a phone), **Open the journal** on their [profile](profiles.md), or by tapping the evening goal check push.

## What's in it

Days, newest first. Each day shows what was recorded:

* **Temp check**: 🙂 how they slept and how they felt.
* **🎯 The goal** with how it went (🎉 Yes, 🌗 Partly, 🌱 Not today) and their notes: what helped, what got in the way, next time.
* **Their entries**: anything they wrote, with an optional mood emoji.

On evenings with a goal, today's **Goal check** waits at the top until they answer (see [Evening goal check](snapshot.md#evening-goal-check)), and after midnight it stays there as **🌙 Last night's check-in** until noon, their morning Temp check or **Skip last night** (see [Last night's check-in](snapshot.md#last-nights-check-in)). With the [energy battery](battery.md#how-drained-do-you-feel) on, the same card asks **How drained do you feel?**, and on a day without a goal it's the only question. **Show earlier** loads older days. **📈 Insights** at the top opens their [Insights](insights.md): the same check-ins as charts and patterns over weeks.

## Writing an entry

Tap **+ New entry**, write what happened (up to 2,000 characters), pick a mood if you like and change the day if it's about another one. **Save**. Tap an entry to change it; **More… → Delete entry** removes it.

## Who can open it

* **The person's own device** (a phone or tablet that belongs to them).
* **Parents' devices** (full access). For kids the page says "parents can see it too". A **private** journal opens there too, but shows only the mood of each entry (see below).
* **Never a shared wall screen** or another person's device: they get "This journal is private".
* **Claude and other connected apps** can't read or change it unless a parent turns on **Let connected apps see health entries**. Even then they never get the words of a private entry. There's no MCP tool for the journal.

Entries (the words and the mood) and goal check answers are encrypted on the server, never written to the logs, and never sent in webhooks or push text. Their profile shows **Goals met this week: 3 of 5** only on their own device and parents' devices. See [Privacy](../your-data/privacy.md#journal).

## Private journals

A private journal is for writing only you can read. The page says so: **Private: only you can read these. Other parent devices see your mood, not what you write.** on a grown-up's journal, and **… Parents see your mood, not what you write.** on a kid's.

* **What others see.** On anyone else's device, parents' devices included, each private entry shows its day, its mood and **🔒 Private entry**, never the words. The same goes for that day's goal check notes (what helped, what got in the way, next time): the outcome shows, the notes say **🔒 Notes are private**. [Insights](insights.md) and the [energy battery](battery.md) keep working, because they only use moods and answers, never the words.
* **Marked on the entry.** An entry written while the journal is private stays private for good. Turning privacy off later only affects new entries; nothing written before is shown.
* **Only you change it.** While it's private, only your own devices can add, change or delete entries, or change that day's goal check.

### Who decides

* **Grown-ups** (anyone marked a grown-up in [Settings → Family](../settings/family.md)): private by default. Turn **Private journal** off or on at the top of your journal, on your own device.
* **Kids**: off until a parent turns on **Let Maya keep a private journal** in [Settings → Family](../settings/family.md#private-journal) (Maya's settings). Then Maya turns **Private journal** on or off from her own device. If a parent turns the permission off later, Maya's new entries can be read on parent devices again, and the ones she wrote while it was private stay private.
* Every change is logged in [Security activity](sign-in-and-security.md#security-activity) ("Maya's journal is private") and leaves a 🔒 note in Maya's own [notifications](notifications.md), so nothing changes quietly.

### Your own devices

"Your own device" means one that belongs to you:

* for a kid, a phone, tablet or screen paired as theirs: **A kid's device** under **Settings → Access → Paired devices**. A paired device is never a grown-up's, so whoever approves a pairing code can't read a grown-up's journal; one paired as a grown-up's before this rule no longer opens it (it shows under **⚠️ Needs a fix**);
* the first parent phone or computer, when you pick yourself at **Whose device is this?** in the [setup wizard](../getting-started/setup-wizard.md#steps). It opens your journal, private entries too, from the start;
* a parent's phone or computer that says it's yours: **Settings → Access → This device → Whose device is this?**, or **This is Alex's device** on Alex's journal. A full-access device can only belong to a grown-up. Signed in with a passkey, the passkey remembers it, so the next sign-in with it is yours too. Kinwall's app asks "Whose device is this?" when it signs in.

When a device is set to belong to someone, that person's own devices get a 🔒 note ("Alex's phone now belongs to Alex"), and parents see it in [Security activity](sign-in-and-security.md#security-activity). Devices that belong to no one, the setup admin key, a sign-in with a recovery code, the hosted service's support sign-in and connected apps can never read private entries.

### Updating from an earlier version

Journals of grown-ups were made private when this arrived, including what they had already written (and their goal check notes), so nothing a grown-up wrote became readable on someone else's device. To read your own entries on a parent's phone or computer, set it as yours (above). Kids' journals, and everything kids wrote before, stay as they were.

What private can't protect against is on the [Privacy](../your-data/privacy.md#what-a-private-journal-protects) page.

## API

* `GET /api/members/{id}/journal?to=&days=`: days (`to` is today by default, `days` 60, up to 366), newest first: `{ memberId, from, to, privacy, days: [{ date, tempCheck, entries }] }`. `tempCheck` is `{ sleep, feelings, goal, goalSkipped, followup, followupHidden }` or `null`. Each entry has `private`; its `text` is `null` when it's private and the caller's key doesn't belong to them (`followupHidden: true` likewise means the goal check notes are `null`). `privacy` is `{ on, allowed, mine, canChange }`: new entries are private; they may keep a private journal; this key belongs to them; this key may turn it on or off.
* `POST /api/members/{id}/journal` with `{ date?, text, mood? }`, `PATCH /api/members/{id}/journal/{entryId}` (only what's sent), `DELETE /api/members/{id}/journal/{entryId}`. While the journal is private, adding needs a key that belongs to them, and so does changing or deleting a private entry (403 otherwise).
* `PUT /api/members/{id}/journal/privacy` with `{ private?, allowed? }` returns `privacy`. `private`: only a key that belongs to them (a kid's only once allowed). `allowed`: a kid's, from a parent's device (full access, not a connected app); 400 for a grown-up.
* A key belongs to a member when its `owner` is their ID: see `PATCH /api/keys/{id}` and `PUT /api/me/owner` in the [REST API](../integrations/rest-api.md). A full-access key's owner must be a grown-up. Connected apps never read private entries.
* 403 for a shared wall screen, another member's device, and a connected app without `aiHealthAccess`.
* Changes send the `journal.changed` [webhook](../integrations/webhooks.md) with `{ memberId, date, id }`, never the words. Entries are in [exports](../your-data/export-import.md), private ones without their words.
