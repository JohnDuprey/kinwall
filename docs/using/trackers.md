# Trackers

The **Trackers** tab keeps the family's logs: the books and audiobooks everyone is reading, a journal of daily memories, and doctor and dentist visits. Each entry belongs to one person or to the whole family.

In Reading and Memories, the header's member filter works too: pick a person and you see their entries plus the family's. Health has its own switcher (below).

## Reading 📖

A shelf per person, with what they're reading first, then what they want to read, then what they've finished.

* **Every book on a Reading shelf is in the family's [library](#library)** too. A book added here (or from an assistant or a sync like Libro.fm) is linked to the library book with the same title and author (case, punctuation and subtitles don't matter) and the same format, or added to the library if it isn't there yet. A book on a shelf is one you have, even if it's only **Want to read** (an audiobook bought but not started); the wishlist is for books you don't have yet. Starting a wishlist book takes it off the wishlist. Deleting a reading entry leaves its book in the library. An audiobook is its own library item, apart from a paper copy of the same book: an audiobook on someone's shelf links only to the library's audiobook. Books tracked before this joined the library once, the same way; library books only ever listened to became audiobooks, and a book both read and listened to was split in two, the audiobook entries moving to the new audiobook (nothing is removed). Adding a book by ISBN (the scanner, an assistant, a sync) finds the same book, in the same format, already saved without one and gives it the ISBN instead of adding it twice.
* **Add a book** with **+**: the format (**Book** or **Audiobook**), title (required), author, status (**Want to read**, **Reading now**, **Finished**), pages read and total pages, the day they started, the day they finished, a rating and notes.
* **Look up** a book instead of typing it: search by title, author or ISBN and pick the right one to fill in the title, author, total pages and cover. Results come from [Open Library](https://openlibrary.org), and the search goes through your Kinwall server. Listening length isn't in Open Library, so fill that in for an audiobook.
* **Scan** (in the iPhone and Android app): point the camera at the barcode on the back of a book to look it up by its ISBN. The first time, the app asks to use the camera. A wall screen opens its front camera, so hold the book up to the screen; **Flip** on the scanner switches cameras.
* **Cover link** takes the address of a cover picture (public `https`, JPEG, PNG, WebP or GIF). The cover shows next to the book on the shelf. A book without one shows its cloth color with 📖 (🎧 for an audiobook), the same color its spine has on the library's **Covers** shelf. Your Kinwall server fetches it, so screens never connect to the cover's site themselves.
* An **audiobook** has a narrator, and **Listened** and **Length** in hours and minutes instead of pages. It shows 🎧 before its title and a square cover on the shelf, with the time left ("2h 10m left").
* **Log pages** on a book they're reading: type the page they're on or tap **+5**, **+10**, **+20**, **+50**. For an audiobook it's **Log listening**: type how long they've listened or tap **+15m**, **+30m**, **+1h**. Reaching the last page (or the end of the audiobook), or tapping **Finished it!**, marks it finished today.
* **Reading by day** (**Listening by day** for an audiobook): tap a book to see the last 14 days as bars and the latest days read ("Today · 12 pages"). Every time someone logs pages, uses **+5** and the rest, edits the page, or finishes the book, the pages since last time count toward that day, in the family's timezone. Pages already read when a book is added don't count as read that day, and fixing a typo the same day takes it back off. Days before this feature have no history. It's kept for about a year.
* **An earlier day:** forgot to log yesterday, or a day is wrong? In **Log pages** (or **Log listening**), change **Day** to that date and enter the pages read that day (or time listened). It replaces what that day had, and their place in the book moves by the difference; **0** clears the day. Any day in the last year works.
* **The same words everywhere:** a book is **🔖 Want to read**, **📖 Reading now** or **📗 Finished**, on the Reading shelves, in the book's sheet and in the library's cards and filters.
* **📚 Open in the library** (in a book's sheet, once it's in the library) opens that book's library sheet: where it lives, lending, and who else has read it. A book that isn't linked yet has **📚 Save to library** there instead.
* **Rate** a finished book by tapping a star. Tap the same star again to clear it.
* A shelf lists what someone's reading, then what they want to read, then their three most recently finished books. **Show all N finished** opens the rest (**Show fewer** folds them back).
* Each shelf shows the books finished this year (audiobooks count), the pages read and the time listened, like "3 books finished in 2026 · 812 pages · 4h 10m listened". Pages and time are the finished ones this year plus the progress so far on the ones in progress; a part that's zero is left out.

### Library

**Library** (a view next to Reading, Memories and Health) is the books your family owns or has borrowed, plus a wishlist of ones you want, apart from who's reading what. On a phone, the button at the top switches views, like the home page's.

* Each book shows its cover, author, series and number ("Warriors #1"), the year it came out, its reading level (Lexile, like "660L"), page count and up to five genres (Fantasy, Animals, Mystery…, picked out of Open Library's subjects), and who has read it (📗 finished, 📖 reading now, 🔖 wants to read, the same marks as the Reading shelves), or **Not read yet**. A book without a cover shows its cloth color, like on the shelves. Books in a series sit together in order.
* **List or Covers:** the Library opens in **Covers**; the switch on the right of the row under the search picks the view (📚 for Covers, ☰ for List; on a tablet or wall display it shows the words too), and each device remembers its choice (a device that picked **List** keeps opening in List). The same row counts the books showing ("📚 14 books · 🎧 4 audiobooks"). In List, an audiobook shows 🎧 before its title, who reads it and a square cover, as on the Reading shelves.
* **Covers** stands the books on wooden shelves, covers only, with the same search and filters as the list. Tap a cover for the book's sheet. A book without a cover (or one that won't load) gets a cloth cover in its own color with its title and author. A book someone is reading has a bookmark sticking out of the top with their face, a borrowed one a library-card tag ("Due Fri", "Overdue"), and wishlist books a ⭐ ribbon. The shelves show whatever the filters pick.
* **🎧 Audiobooks** are their own items (a paper copy and an audiobook of the same book are two), shown in Covers as records in a crate below the shelves: a square sleeve with a 🎧 badge and a record peeking out of the top. One without a cover gets made-up album art in its own color with its title and author. While someone is listening, its record is pulled out further and slowly spins (it holds still with reduced motion on), with their face on the label and a ring around it for how far along they are.
* **🎲 Pick one** on the **📚 Books** heading (Covers) scans along the shelf, lands on a book and opens it; the one on the crate's **🎧 Audiobooks** heading does the same for a listen. Each picks from the ones showing, never a wishlist or returned one. With reduced motion on, it skips the scan.
* **Search** finds titles, authors, series, genres, places, who has a book and where a borrowed one came from.
* **Filters** (the button next to the search, with a count of how many are on) opens a sheet; tap as many as you like in each group:
  * **Show:** **Not read yet** (nobody has started it), **📖 Reading now**, **🔖 Want to read** (on someone's shelf, nobody started), **📗 Finished**, **🤝 Lent out**, **📅 Borrowed** (still out, soonest due first when it's the only one picked), **↩️ Returned** and **⭐ Wishlist**. A book shows when it matches any of them. With none picked you see the books you have, without returned books, the wishlist or books someone only wants to read, the same in List and Covers.
  * **Format:** **📚 Books**, **🎧 Audiobooks**, or both.
  * **Where:** the places books live; any of them.
  * **Who:** family members; books on any of their reading shelves (reading, finished or want to read).
  * Groups combine: **Want to read** and **Maya** shows the books Maya wants to read. **Clear** turns everything off, **Done** closes the sheet. What's on shows as chips under the search; tap one's **✕** to drop it. Filters start fresh each visit, so a wall display never opens on a filtered shelf.
* **Where it lives:** pick a place in a book's sheet ("Maya's room", "Living room shelf"), or **New place…**. Cards show 📍 the place.
* **Lending:** type who you're lending it to ("Grandma", a friend) and tap **Lend**; the card shows 🤝 "Lent to Grandma since Sep 23". Tap **It's back** when it's returned; it keeps its place.
* **Borrowing** (a library book, a friend's): when you add a book, pick **Borrowed**, then say who from ("Town library") and when it's due back (three weeks out to start). For a book that's already there, set **Whose book** to **Borrowed** in its sheet (**Cancel** backs out); set it back to **Ours** if it turns out to be yours. Cards show 📅 "Due back Oct 23 · from Town library", in red once it's overdue. Change the date in the book's sheet; tap **Returned it** when it goes back. Returned books leave the shelf but stay under **↩️ Returned** (Filters), with who read them, and **Borrow again** brings one back with a new due date.
* **Wishlist:** books you want but don't have yet. When you add one, pick **Wishlist**, or set **Whose book** to **Wishlist** in a book's sheet. They stay off the shelf (find them under **⭐ Wishlist** in Filters) until you set **Whose book** to **Ours**; borrowing one takes it off the wishlist.
* **Due dates:** a borrowed book shows on the home board on its due day ("📚 Return Wonder to Town library"), and an overdue one stays on today. At 9 AM, two days before and on the day it's due, parents' devices and the family feed get a heads-up.
* **📷 Scan books** (in the iPhone and Android app): scan the barcodes on the back of your books one after another. Each one is looked up and added ("Added: Holes"), then the camera opens again after a couple of seconds for the next one; **Cancel** stops. A book that's already there says so, the same barcode twice in a row counts once, and a barcode that isn't a book's is skipped. Scan just one and its sheet opens, so you can say where it lives or whose it is.
* **From the Reading shelves:** every book someone tracks there is in the library already, linked, so the library shows them reading it (see [Reading](#reading-)). Its title, author, cover and page count come along (an audiobook's length doesn't, since the library counts pages).
* **+** adds one, yours or borrowed: **Look up a book** fills in the details, or type the title and author.
* Details come from [Open Library](https://openlibrary.org), including its description (as plain text; long ones open with **More**), which shows when you tap the book. Your Kinwall server does the lookup. A book that came in with little (one from the Reading shelves, a sync that only knows its title and ISBN, one typed in by hand) is looked up on its own right after it's added: by its ISBN, else its title and author, and only when Open Library has the same title by the same author. Only empty details are filled in, never ones you set. Books already in the library are looked up a few at a time in the background. A book Open Library doesn't know is tried again after a month.
* A book's sheet shows what's known: author, series and number ("📚 Warriors #2"), when it was first published, page count, reading level with a rough grade ("860L · about grades 4–5"), genres, Open Library readers' rating ("★ 4.2 · 1,210 ratings", once a few people have rated it), its description and ISBN. An audiobook says who reads it and how long it is: "🎧 Audiobook · read by Nora Bell · 3h 45m" (from a listener's reading entry). An audiobook's sheet leaves out **Where it lives** and **Lending**, says who's listening, and **Listen to it** puts it on someone's Reading shelf as an audiobook. On a parent's device, **🎧 Listen on Libro.fm** opens an audiobook's page there (when it has an ISBN), **View on Open Library** opens its page, and **🔎 Look up details** looks it up again now.
* Tap a book for its description and who has read it. **Read it** with someone's name puts it on their Reading shelf, linked to the book, so the library shows them as reading it. If they were already tracking that book on its own, that entry is linked instead of a second one being added. A parent's device can **Remove from library**; their reading entries stay.
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
