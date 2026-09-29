# Journal

Each person's own place for their days: their [Temp check](snapshot.md#temp-check) answers, how their goals went, and notes they write themselves. It's the start of bullet journaling in Kinwall.

Open it with **Journal** in the menu on a person's own device (under **More** on a phone), **Open the journal** on their [profile](profiles.md), or by tapping the evening goal check push.

## What's in it

Days, newest first. Each day shows what was recorded:

* **Temp check**: 🙂 how they slept and how they felt.
* **🎯 The goal** with how it went (🎉 Yes, 🌗 Partly, 🌱 Not today) and their notes: what helped, what got in the way, next time.
* **Their entries**: anything they wrote, with an optional mood emoji.

On evenings with a goal, today's **Goal check** waits at the top until they answer (see [Evening goal check](snapshot.md#evening-goal-check)). **Show earlier** loads older days. **📈 Insights** at the top opens their [Insights](insights.md): the same check-ins as charts and patterns over weeks.

## Writing an entry

Tap **+ New entry**, write what happened (up to 2,000 characters), pick a mood if you like and change the day if it's about another one. **Save**. Tap an entry to change it; **More… → Delete entry** removes it.

## Who can open it

* **The person's own device** (a phone or tablet that belongs to them).
* **Parents' devices** (full access). For kids the page says "parents can see it too". A grown-up's journal opens on parent devices too, and their page says so.
* **Never a shared wall screen** or another person's device: they get "This journal is private".
* **Claude and other connected apps** can't read or change it unless a parent turns on **Let connected apps see health entries**. There's no MCP tool for the journal.

Entries (the words and the mood) and goal check answers are encrypted on the server, never written to the logs, and never sent in webhooks or push text. Their profile shows **Goals met this week: 3 of 5** only on their own device and parents' devices. See [Privacy](../your-data/privacy.md#journal).

## API

* `GET /api/members/{id}/journal?to=&days=`: days (`to` is today by default, `days` 60, up to 366), newest first: `{ memberId, from, to, days: [{ date, tempCheck, entries }] }`. `tempCheck` is `{ sleep, feelings, goal, goalSkipped, followup }` or `null`.
* `POST /api/members/{id}/journal` with `{ date?, text, mood? }`, `PATCH /api/members/{id}/journal/{entryId}` (only what's sent), `DELETE /api/members/{id}/journal/{entryId}`.
* 403 for a shared wall screen, another member's device, and a connected app without `aiHealthAccess`.
* Changes send the `journal.changed` [webhook](../integrations/webhooks.md) with `{ memberId, date, id }`, never the words. Entries are in [exports](../your-data/export-import.md).
