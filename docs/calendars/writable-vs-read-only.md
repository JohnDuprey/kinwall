# Writable vs read-only

Every calendar is either **writable** or **read-only**, and the calendar decides which. Each event carries a `readOnly` flag.

| Calendar kind | Writable? |
|---|---|
| Local ("Kinwall only") | Yes |
| Google, Microsoft, CalDAV | Yes, unless the provider says you can't write to it (shared or holiday calendars show a **read-only** badge in the picker) |
| ICS feed | Never |

Through the API, `writable: false` on `POST /api/calendars` can only *lower* access. Sync re-checks it with the provider.

## What you can still do on read-only events

The event's own fields (title, time, location, description, recurrence) come from the source and can't be changed. These Kinwall-only annotations still work, because they never touch the provider:

* **Family members**: tap chips in the detail sheet.
* **Category**: via [keywords](../using/categories.md), the calendar default, or `set_event_category` / `PATCH /api/events/{id} {categoryId}`.
* **Travel time / leave-by**.
* **Linked tasks** from lists.

The detail sheet shows no **Edit**/**Delete** and says "Only the family members are saved in Kinwall — the event itself comes from *calendar*."

## Where annotations are stored

Synced events are replaced on every sync, so Kinwall keeps annotations in separate tables keyed by the provider's event ID. Member and category tags can apply per occurrence or per series, and travel time applies per occurrence. They survive re-syncs. [Export/import](../your-data/export-import.md) carries both the per-event and the series-wide ones.

## Writes to writable calendars

Creating, editing or deleting an event on a Google, Outlook or CalDAV calendar goes **to the provider first**. If that fails, you get an error (HTTP 502 from the API) and nothing is stored locally. Deleting a synced event deletes it at the source: "If it came from Google or Outlook it is deleted there too."
