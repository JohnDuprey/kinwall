# Trackers

The **Trackers** tab keeps the family's logs: the books everyone is reading, a journal of daily memories, and doctor and dentist visits. Each entry belongs to one person or to the whole family.

The header's member filter works here too: pick a person and you see their entries plus the family's.

## Reading 📚

A shelf per person, with what they're reading first, then what they want to read, then what they've finished.

* **Add a book** with **+**: title (required), author, status (**Want to read**, **Reading**, **Finished**), pages read and total pages, the day they started, the day they finished, a rating and notes.
* **Log pages** on a book they're reading: type the page they're on or tap **+5**, **+10**, **+20**, **+50**. Reaching the last page, or tapping **Finished it!**, marks it finished today.
* **Rate** a finished book by tapping a star. Tap the same star again to clear it.
* Each shelf shows the books finished this year and the pages read (finished books this year plus the pages so far in books in progress).

A person's day (tap their avatar) lists what they're reading, like "Charlotte's Web — 45%". See [Daily & weekly snapshot](snapshot.md).

## Memories 📝

A family journal. **Add today's memory** opens a new entry for today: what happened, an optional headline, a mood and one photo (optional).

A memory has at most one photo:

* **Add a photo** (or **Replace photo**) adds a new one that belongs to the memory. It shows only in that memory: not in Activities → [Photos](photos.md), on the Board's picture card, on the night screen or in the photos zip as a family photo. Turn on **Also in family photos** to share it there too, and off again to take it back out.
* **From family photos** uses one that's already in the family photos. It's only linked, so it stays in the family photos whatever happens to the memory.
* Deleting a memory, removing its photo or replacing it deletes the memory's own photo, unless it's also in the family photos.

A memory's own photos count toward the family's photo storage (200 photos, 100 MB). The Photos page shows them separately, for example "20 photos (+3 in memories)".

**On this day** shows memories from the same date in earlier years.

## Health 🩺

Doctor, dentist and other visits: the date and time, the type (checkup, dentist, specialist, vaccine, sick visit, other), the reason, the doctor or office, notes, measurements (height, weight, temperature, each in the unit you pick) and a follow-up date. Upcoming visits come first, then past ones.

**Add to calendar** on an upcoming visit adds a normal calendar event, like "🦷 Dentist · Maya", at the visit's time with the office as its location. Only the type and the person go on the calendar; the reason, notes and measurements stay in Trackers.

### Health stays off the wall

Health stays on phones and computers, never on the wall screen:

* A paired wall display (a display key) doesn't show the Health tab.
* The server refuses health entries to display keys: listing them, opening one, adding one or editing one answers **403**, and a list without a kind leaves health out. This holds for the REST API and the MCP tools, whatever app is asking.
* Webhooks (`tracker.changed`) carry only the entry's id and kind, never its fields.

Keep in mind that a visit you add to the calendar is a normal event, and the calendar is on the wall.

## Who can do what

| | Admin (phones, computers) | Wall display |
|---|---|---|
| Reading and Memories | See, add, edit, delete | See, add, edit (no delete) |
| Health | See, add, edit, delete | Nothing |

Removing a family member keeps their tracker entries under their name, for example a **Sam (removed)** shelf in Reading and "Sam (removed)" on their memories and visits. They don't become the family's. Editing one and picking someone else (or **Family**) moves it for good.

## Turning it off

An admin can turn off **Reading**, **Memories** and **Health** one at a time under **Trackers** in **Settings → General → Features**. A tracker that's off has no tab (a link to it opens the first one that's on), and Reading off also drops the reading line from a person's day. The **Trackers** tab goes when all three are off. The entries are kept and the API keeps answering. See [Features](../settings/general.md#features).

## API and MCP

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/trackers?kind=&memberId=&from=&to=&q=` | Entries, newest first. `q` searches titles and fields. |
| `POST` | `/api/trackers` | Add `{ kind, memberId?, date?, title?, photoId?, photoFamily?, data }`. `date` defaults to today. |
| `GET` | `/api/trackers/{id}` | One entry. |
| `PATCH` | `/api/trackers/{id}` | Edit. `data` is merged over the entry's fields; `null` clears one. |
| `DELETE` | `/api/trackers/{id}` | Delete (admin keys only). |
| `GET` | `/api/trackers/summary?year=` | Reading stats per person: books finished that year, pages, books in progress with a percent. |

Each entry also has `formerMember` (the name of a removed member it belonged to, with `memberId` null), and for a memory's photo `photoOwned` (added for the memory) and `photoFamily` (also a family photo). A memory's own photo is uploaded with `POST /api/photos?family=0` and attached with `photoId`; `photoFamily: true` shares it. Only memories take a photo, one each.

`data` by kind (checked by the server; unknown fields are refused):

* **reading**: `author`, `status` (`want` / `reading` / `finished`), `pagesRead`, `totalPages`, `finishedOn`, `rating` (1–5), `notes`. `title` is the book and is required.
* **memory**: `text`, `mood` (one emoji). It needs text or a photo.
* **health**: `type` (`checkup` / `dentist` / `specialist` / `vaccine` / `sick` / `other`), `time` (`HH:MM`), `provider`, `notes`, `height` `{ value, unit: in|cm }`, `weight` `{ value, unit: lb|kg }`, `temperature` `{ value, unit: F|C }`, `followUp`, `eventId`.

The [MCP server](../integrations/mcp.md) has `list_tracker_entries`, `add_tracker_entry` and `update_tracker_entry`. Health through MCP works only with an admin key.

Tracker entries are included in [Export & import](../your-data/export-import.md). Photos travel in their own zip (a memory's own photos too, marked `"family": false`); an entry whose photo isn't on the new server imports without it.
