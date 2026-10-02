# Trackers

The **Trackers** tab keeps the family's logs: the books and audiobooks everyone is reading, a journal of daily memories, and doctor and dentist visits. Each entry belongs to one person or to the whole family.

In Reading and Memories, the header's member filter works too: pick a person and you see their entries plus the family's. Health has its own switcher (below).

## Reading 📚

A shelf per person, with what they're reading first, then what they want to read, then what they've finished.

* **Add a book** with **+**: the format (**Book** or **Audiobook**), title (required), author, status (**Want to read**, **Reading**, **Finished**), pages read and total pages, the day they started, the day they finished, a rating and notes.
* **Look up** a book instead of typing it: search by title, author or ISBN and pick the right one to fill in the title, author, total pages and cover. Results come from [Open Library](https://openlibrary.org), and the search goes through your Kinwall server. Listening length isn't in Open Library, so fill that in for an audiobook.
* **Scan** (in the iPhone and Android app): point the camera at the barcode on the back of a book to look it up by its ISBN. The first time, the app asks to use the camera. A wall screen opens its front camera, so hold the book up to the screen; **Flip** on the scanner switches cameras.
* **Cover link** takes the address of a cover picture (public `https`, JPEG, PNG, WebP or GIF). The cover shows next to the book on the shelf. Your Kinwall server fetches it, so screens never connect to the cover's site themselves.
* An **audiobook** has a narrator, and **Listened** and **Length** in hours and minutes instead of pages. It shows 🎧 on the shelf, with the time left ("2h 10m left").
* **Log pages** on a book they're reading: type the page they're on or tap **+5**, **+10**, **+20**, **+50**. For an audiobook it's **Log listening**: type how long they've listened or tap **+15m**, **+30m**, **+1h**. Reaching the last page (or the end of the audiobook), or tapping **Finished it!**, marks it finished today.
* **Reading by day** (**Listening by day** for an audiobook): tap a book to see the last 14 days as bars and the latest days read ("Today · 12 pages"). Every time someone logs pages, uses **+5** and the rest, edits the page, or finishes the book, the pages since last time count toward that day, in the family's timezone. Pages already read when a book is added don't count as read that day, and fixing a typo the same day takes it back off. Days before this feature have no history. It's kept for about a year.
* **Rate** a finished book by tapping a star. Tap the same star again to clear it.
* Each shelf shows the books finished this year (audiobooks count), the pages read and the time listened, like "3 books finished in 2026 · 812 pages · 4h 10m listened". Pages and time are the finished ones this year plus the progress so far on the ones in progress; a part that's zero is left out.

### Library

**Library** (at the top of Reading, next to **Shelves**) is the books your family owns, apart from who's reading what. This device remembers which of the two you were looking at.

* Each book shows its cover, author, series and number ("Warriors #1"), the year it came out, its reading level (Lexile, like "660L"), page count and up to three genres (Fantasy, Animals, Mystery…, picked out of Open Library's subjects), and who has read it (✓ read, 📖 reading, ⭐ wants to read), or **Not read yet**. Books in a series sit together in order.
* **Search** finds titles, authors, series and genres; **Not read yet** shows the books nobody has started.
* **📷 Scan books** (in the iPhone and Android app): scan the barcodes on the back of your books one after another. Each one is looked up and added ("Added: Holes"); a book that's already there says so, and a barcode that isn't a book's is skipped. **Cancel** stops.
* **+** adds one: **Look up a book** fills in the details, or type the title and author.
* Details come from [Open Library](https://openlibrary.org) once, when a book is added, including its description, which shows when you tap the book. Your Kinwall server does the lookup.
* Tap a book for its description and who has read it. **Read it** with someone's name puts it on their Reading shelf, linked to the book, so the library shows them as reading it. A parent's device can **Remove from library**; their reading entries stay.
* Wall screens and kids' devices can browse, scan and add books; only parents remove them.

A person's day (tap their avatar) lists what they're reading, like "Charlotte's Web — 45%" (for an audiobook, how much of its length they've listened to). See [Daily & weekly snapshot](snapshot.md).

## Memories 📝

A family journal. **Add today's memory** opens a new entry for today: what happened, an optional headline, a mood and one photo (optional).

Memories are for the whole family: anyone in the family, wall screens and connected apps can read them, and they're not private even when they belong to one person. For writing only you can read, use your own [Journal](journal.md#private-journals).

A memory has at most one photo:

* **Add a photo** (or **Replace photo**) adds a new one that belongs to the memory. It shows only in that memory: not in Activities → [Photos](photos.md), on the Board's picture card, on the night screen or in the photos zip as a family photo. Turn on **Also in family photos** to share it there too, and off again to take it back out.
* **From family photos** uses one that's already in the family photos. It's only linked, so it stays in the family photos whatever happens to the memory.
* Deleting a memory, removing its photo or replacing it deletes the memory's own photo, unless it's also in the family photos.

A memory's own photos count toward the family's photo storage (200 photos, 100 MB). The Photos page shows them separately, for example "20 photos (+3 in memories)".

**On this day** shows memories from the same date in earlier years.

## Health 🩺

Doctor, dentist and other visits: the date and time, the type (checkup, dentist, specialist, vaccine, sick visit, other), the reason, the doctor or office, notes, measurements (height, weight, temperature, each in the unit you pick) and a follow-up date. Upcoming visits come first, then past ones.

**Whose health** at the top of the tab shows **Everyone** or one person: their visits and their medicines, and a visit you add is theirs to start with. This device remembers the choice, and it starts from the header's member filter when one is set. It doesn't change the header's filter, so the calendar stays as it was.

**Add to calendar** on an upcoming visit adds a normal calendar event, like "🦷 Dentist · Maya", at the visit's time with the office as its location. Only the type and the person go on the calendar; the reason, notes and measurements stay in Trackers.

When [medication reminders](medications.md) are on, the Health tab also has **💊 Medicines**: each person's medicines, where parents add and change them, **Show medicine names on shared screens**, and **More… → Delete all medication data**.

### Health stays off the wall

Health stays on phones and computers, never on the wall screen:

* A paired wall display (a display key) doesn't show the Health tab.
* The server refuses health entries to display keys: listing them, opening one, adding one or editing one answers **403**, and a list without a kind leaves health out. This holds for the REST API and the MCP tools, whatever app is asking.
* Webhooks (`tracker.changed`) carry only the entry's id and kind, never its fields.
* Claude and other connected apps don't see health entries unless a parent allows it in **Settings → Access → Connected apps**. See [MCP server](../integrations/mcp.md#health-entries).
* Health entries are encrypted in the database (the reason, the office, notes and measurements), and never written to the server logs. See [Privacy](../your-data/privacy.md#health-entries).

Keep in mind that a visit you add to the calendar is a normal event, and the calendar is on the wall.

## Who can do what

| | Admin (phones, computers) | Kid's own device | Wall display |
|---|---|---|---|
| Reading and Memories | See, add, edit, delete | See all; add, edit and delete their own; add and edit the family's | See, add, edit (no delete) |
| Health | See, add, edit, delete | Nothing | Nothing |

On a kid's own device, **Whose book?** (or memory) offers only the kid and **Family**, and someone else's entry opens read-only.

Removing a family member keeps their tracker entries under their name, for example a **Sam (removed)** shelf in Reading and "Sam (removed)" on their memories and visits. They don't become the family's. Editing one and picking someone else (or **Family**) moves it for good.

## Turning it off

An admin can turn off **Reading**, **Memories** and **Health** one at a time under **Trackers** in **Settings → General** (tap **Change** under **Features**). A tracker that's off has no tab (a link to it opens the first one that's on), and Reading off also drops the reading line from a person's day. The **Trackers** tab goes when all three are off. The entries are kept and the API keeps answering. See [Features](../settings/general.md#features).

## API and MCP

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/trackers?kind=&memberId=&from=&to=&q=` | Entries, newest first. `q` searches titles and fields. |
| `POST` | `/api/trackers` | Add `{ kind, memberId?, date?, title?, photoId?, photoFamily?, data }`. `date` defaults to today. A member's own device: only for them or the family (else `403`). |
| `GET` | `/api/trackers/{id}` | One entry. |
| `PATCH` | `/api/trackers/{id}` | Edit. `data` is merged over the entry's fields; `null` clears one. A member's own device: only their or the family's entries, given to them or the family (else `403`). |
| `DELETE` | `/api/trackers/{id}` | Delete: admin keys, or a member's own device for their own entries (else `403`). |
| `GET` | `/api/trackers/summary?year=` | Reading stats per person: books and audiobooks finished that year, `pages`, `minutes` listened, books in progress with a percent. |

Each entry also has `formerMember` (the name of a removed member it belonged to, with `memberId` null), and for a memory's photo `photoOwned` (added for the memory) and `photoFamily` (also a family photo). A memory's own photo is uploaded with `POST /api/photos?family=0` and attached with `photoId`; `photoFamily: true` shares it. Only memories take a photo, one each.

`data` by kind (checked by the server; unknown fields are refused):

* **reading**: `format` (`book` / `audiobook`, default `book`; an entry without one is a book), `author`, `status` (`want` / `reading` / `finished`), `pagesRead` and `totalPages` (books), `narrator`, `minutesListened` and `totalMinutes` (audiobooks, whole minutes, so 4h 30m is `270`), `finishedOn`, `rating` (1–5), `notes`. `title` is the book and is required. Progress is by pages for a book and by minutes for an audiobook. Marking one finished fills in `pagesRead` (or `minutesListened`) from its length.
* **memory**: `text`, `mood` (one emoji). It needs text or a photo.
* **health**: `type` (`checkup` / `dentist` / `specialist` / `vaccine` / `sick` / `other`), `time` (`HH:MM`), `provider`, `notes`, `height` `{ value, unit: in|cm }`, `weight` `{ value, unit: lb|kg }`, `temperature` `{ value, unit: F|C }`, `followUp`, `eventId`.

The [MCP server](../integrations/mcp.md) has `list_tracker_entries`, `add_tracker_entry` and `update_tracker_entry`. Health through MCP works only with an admin key.

Tracker entries are included in [Export & import](../your-data/export-import.md). Photos travel in their own zip (a memory's own photos too, marked `"family": false`); an entry whose photo isn't on the new server imports without it.
