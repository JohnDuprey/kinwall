# Changelog

## [1.2.0](https://github.com/JohnDuprey/kinwall/compare/v1.1.0...v1.2.0) (2026-10-03)


### New

* **board:** add a Get stuff done card showing a checklist's progress ([07f7745](https://github.com/JohnDuprey/kinwall/commit/07f77457aae19c48ff94e48e8e1302e3e9795c03))
* **chores:** let parents give bonus points outside a chore ([796bbc9](https://github.com/JohnDuprey/kinwall/commit/796bbc943db367364e578e561206d98ae307802c))
* **chores:** open a chore's checklist in Get stuff done ([ed9a54e](https://github.com/JohnDuprey/kinwall/commit/ed9a54e7a9ccd1b01235f0b1f07285cf91a70904))
* **lists:** add Get stuff done mode for working through a checklist ([7d3f9e4](https://github.com/JohnDuprey/kinwall/commit/7d3f9e4ffa0292b986f38aeef6e2746e21ce1bab))
* **settings:** fold general's cards and add settings search ([e294890](https://github.com/JohnDuprey/kinwall/commit/e2948907ad593fe63c1a410e67c33471497c2777))
* **settings:** pin a checklist to a screen in Get stuff done ([3b2e102](https://github.com/JohnDuprey/kinwall/commit/3b2e102c000df7dcec519cc3704c5ba856d6676e))
* **trackers:** log or fix reading for an earlier day ([d431a1c](https://github.com/JohnDuprey/kinwall/commit/d431a1caa4f73df582fcb203f3a0c47e4ee81e19))


### Fixed

* **lists:** spell check and autocorrect list items again ([772e36d](https://github.com/JohnDuprey/kinwall/commit/772e36d2f47802da2e1398dcf3e2b516edc8665f))
* **settings:** only fold general's cards that hold more than one control ([d05b4d0](https://github.com/JohnDuprey/kinwall/commit/d05b4d08775e7854dde1da08e7b442d7164eac21))
* **web:** never leave the page blank when the app fails to start ([3d2fd9a](https://github.com/JohnDuprey/kinwall/commit/3d2fd9ade7c76ab5a93eb2e238a726cbb39c09f0))

## [1.1.0](https://github.com/JohnDuprey/kinwall/compare/v1.0.3...v1.1.0) (2026-10-02)

A big one: a Board view for the wall, meal planning and recipes, groceries that follow the store,
rewards, medications, daily check-ins, private journals, a family library, Newscast, Night, a new
logo and a lot more. Kids' devices and wall screens can change less than before. Self-hosting?
Read [Upgrading](#upgrading) first.

### Board

* A new **Board** view, now the default: the family's day at a glance with the clock, weather,
  today, coming up, due soon, chores, a rotating picture and a quote or fact.
* **Layouts per screen**: each screen uses the family's arrangement, a built-in layout (Kids,
  Kitchen, Parents, Simple), a family preset or its own. Place cards in one to four columns by
  drag and drop, with a height and text size for each card. Parents save family presets.
* The quote card can show fun facts, "On this day", trivia you tap to answer, or practical tips
  for routines, focus and feelings. Pick the sources in Settings → Quotes & facts, or give a
  screen **up to three cards** of its own, each with its own sources.
* **Count tiles** for chores, due soon, groceries, shopping and reward requests on smaller
  screens, with full cards on big ones. Each display picks Counts, Full lists or Auto, and tiles
  fill the grid without gaps.
* On a kid's device or a screen showing one person, chores, goals, due soon and reward requests
  count only that person (plus the family's unassigned ones).
* A **Take now** tile for medicines that are due.
* On a phone, **today's weather sits beside the time** on the clock card (temperature, condition,
  high and low, rain), so the card is about a fifth shorter. Narrow cards and big text keep the
  stacked layout.
* A **Finish setting up Kinwall** card on a parent's phone or computer lists only what's missing
  (a calendar, a wall screen, more people, a second way in), each linking to the right spot in
  Settings. Not now hides it for 30 days.
* Library books due back show on their day, and overdue ones stay on today.
* Tap a meal to open it right on the Board instead of jumping to Meals.
* On a wall screen the Board fits the screen, with "+3 more" for the rest.
* Pictures show whole, never cropped.

### Night

* **Quiet hours are now Night**: one family schedule, the night hours, with two effects you can
  turn off on their own: **wall screens rest** on the Night screen and **reminders wait** until
  morning. Families that had quiet hours keep both on, so nothing changes.
* What wall screens show at night, the **PIN to wake** and the moon button all live in the Night
  card under Settings → General → For the whole family. Each screen follows the family's choice
  unless it picks its own.
* Dark mode can follow the same schedule (**Dark hours: Same as night**) under Appearance.
* Tap the screen to wake it; it goes back to the Night screen after five minutes.
* Start and end the Night screen on wall screens from Home Assistant, for example when nobody's
  home.

### Medications

* **Medicine reminders**: a medicine's name, dose and times for each person. Their own devices
  get a reminder, and a **Take now** card offers Taken, Skip and Snooze.
* **Courses** that end on a date or after a number of doses, for things like antibiotics.
* Medicines live in **Trackers → Health**, added from parent devices.
* A different cheer each time you tap Taken (one calm line in low-stimulation mode).
* Each medicine says **how late it can be taken**. A long late window gets one kind follow-up,
  and a dose taken late asks **"When did you take it?"**
* **"When I start my day"** doses, reminded when the person starts their day instead of at a
  set time.
* **Catch up** on doses nobody marked from the person's page.
* Parents hear about a kid's missed dose once the late window has passed, and medicine
  reminders come through at night too.
* The Health tab can switch **whose health** it shows, and each person's medicines fold up to a
  name and a count until tapped.

### Check-ins and journals

* **Temp check**: a few quick questions at the end of a person's day: how they slept, how they
  feel and a goal for today, which shows on the Board.
* **Check-in points**: reading your day to the end and tapping "I'm all caught up" can earn
  points (Settings → Family, off by default, and only while Chores & points is on).
* An evening **goal check** ("Did you finish your goal?") with optional notes, and a personal
  **journal**.
* **Private journals**: a grown-up's journal is private by default, including what they already
  wrote, and opens only on their own devices. A parent can let a kid keep a private journal too.
  Everyone else, parents included, sees the mood and that an entry exists, so Insights and the
  battery keep working.
* Last night's check-in **stays open until the next morning** (noon, the morning Temp check or a
  skip), with one gentle reminder in the morning.
* A **drained check-in** ("How drained do you feel?") when the energy battery is on.
* A **Check-ins & journal** switch in Settings → Features turns off Temp check, goal checks, the
  energy battery, journals and Insights for the whole family (on by default; nothing is deleted).

### Insights and the energy battery

* **Insights** for each person: sleep, feelings, goals, chores and busy days as charts, with
  plain summaries and, after three weeks of check-ins, the connections that show up.
* The **Energy battery**: a rough daily energy level from sleep, feelings, events, chores and
  goals, with a heads-up the evening before a day that looks heavy. It learns from drained
  check-ins.

### Recipes and meals

* **Meal planning**: plan the week's meals, see who's eating, and add the ingredients to your
  Groceries list. Thanks to [@OwenIbarra](https://github.com/OwenIbarra) for contributing it.
* On phones the planner opens on **today**, with a Day/Week switch. **Swap** sits right under the
  meal's name.
* Put meals on **any calendar** at your usual meal times; the event follows the meal.
* **Import recipes** from any website link, pasted text or a meal kit, with step photos,
  bullets and timers kept. When a link would update a recipe you already have, Kinwall says
  which one and offers Save as a new recipe.
* **Cooking mode**: full screen, one step at a time, with the step's photo, its ingredients and
  its own named timers you can pause, resume and reset. The screen stays on while a recipe is
  open.
* **Ratings**: everyone can give a recipe 1 to 5 stars, with a Top rated sort.
* **Share links** for a recipe, with a link preview. A link shared from one Kinwall imports into
  another with nothing lost.
* **Basics** like a spice blend, sauce or dough that other recipes link to. When you add
  groceries, Kinwall asks if they're made already.
* Choose a meal's recipe from a **searchable picker**, and **swap** a planned meal with another
  one later in the week.

### Timers

* **Quick timers from the header** for homework, chores or anything else, shared with cooking
  mode. Timers keep running when you close a sheet, leave cooking mode or reload, and ring over
  everything, the Night screen included.

### Lists and groceries

* Shopping lists are now **Groceries** or **Shopping**, each with its own remembered items, so
  hardware-store things stop showing up on the grocery list. Existing lists are sorted into one
  or the other by name.
* A **catalog** of remembered items: browse and search them, fix a name, set the department and
  the aisle at each store, tag them with your own **categories** (Breakfast, Lunchbox,
  Cleaning…) and filter, sort or group by them.
* Grocery items remember their **store, aisle and department**, sort in aisle order, and stay
  crossed off in place until **Checkout** (with undo).
* **Shopping mode**: one store's trip, full screen, in walking order, grouped by aisle. Walk the
  aisles **in reverse** when you come in the other door. At a store that sells both, the trip
  shows your Groceries and Shopping items together.
* **Scan products** onto a list with the Kinwall app's camera. A product the family added before
  goes straight on under the family's name for it. Anything new is looked up in
  [Open Food Facts](https://world.openfoodfacts.org), then its sister databases
  [Open Products Facts](https://world.openproductsfacts.org),
  [Open Beauty Facts](https://world.openbeautyfacts.org) and
  [Open Pet Food Facts](https://world.openpetfoodfacts.org), so household, beauty and pet items
  are found too. A sheet shows the name (brand first) to check, starts it on Groceries or Shopping
  by what it is, and can save the barcode to the catalog. Only the barcode is sent, by the server.
* In Shopping mode, **scan to check items off** (or add them already checked off), and Kinwall asks
  which aisle it was in when it doesn't know yet. Wall screens scan with the front camera.
* A **default list** for each type: scans, meal ingredients, the Kinwall app's widgets and Siri,
  and connected assistants use it.
* **Move** an item to another list of the same type.
* See **who added and who checked off** an item, and when a reusable list was last done.
* **Swipe an item left** to delete it on a parent's device, with Undo.
* Each list's card shows how many items are **overdue**.
* A to-do's priority shows as a labeled badge.
* **Autocomplete** when adding shopping items.
* The Lists page groups lists into **Shopping, To-dos and Reusable** sections, and parents can
  **reorder** them.
* An item's notes get more room to read.
* **Offline**: the app opens without a connection, and list and chore changes sync when it's
  back.

### Chores and rewards

* **Chore library** for occasional jobs that don't fit a schedule (clean out the car, wash the
  windows): save them once, then hand one out from Chores → Library in a few taps (who, then Today,
  Tomorrow, This weekend or a date). An optional "about every N weeks" shows when it was last done
  and floats due-ish jobs to the top. New families start with eight common ones. Parent devices
  only. MCP `list_chore_library` and `assign_chore_from_library`.
* **Rewards** that kids spend chore points on, with limits, goals on the Board and parent
  approval. A kid can **cancel their own request** while it's still waiting, and gets the points
  back, and a quiet **Stop saving** button sits under the goal.
* Optional **parent approval** for chores: a tick waits for a parent's OK before it earns points.
* **Chore checklists**: link a list to a chore, and it's done once every item is ticked.
* **Activity chores** like "5 min of Sight words", done by playing.
* Ticking an Anyone chore asks who did it, so the right person gets the points.
* Chores can be ticked off from a person's day.
* A **Rewards** switch in Settings → Family → Chores (`rewardsEnabled`, on by default), for
  families who'd rather spend points only on stickers.

### Profiles and family

* A **profile** for each person: chores and points over time, streaks, their bookshelf, badges,
  sticker book and a birthday countdown when it's close.
* Kids can **pick their own avatar** on their own device.
* **Grown-ups**: mark a member as a grown-up, and their chores never wait for an OK. First-time
  setup asks Grown-up or Kid for each person.
* **Transition reminders** for each person before their events, with warning times you pick
  and repeat, and friendly headlines that change from day to day.
* **Start prep by**: a meal's event counts down to when to start cooking, not just when to leave.
* Tap the family name on a phone to filter to one person or open their day.

### Newscast

* A fourth Home tab: a 30-day digest built from chores, rewards given, photos and drawings, books,
  memories and birthdays, plus announcements (up to 280 characters, optional emoji and photo,
  everyone or grown-ups only) and 👏 ❤️ 🎉 reactions shown as faces. Wall screens ask who's
  reacting. Tap a photo or drawing to see it full size. Parents can take a post down or pause a
  kid's posting; anyone can opt out of being featured. Off switch under Settings → Features. API `GET /api/newscast`, MCP `list_newscast`,
  webhook `newscast.posted`.

### Calendar

* The main screen is called **Home** in the navigation, and its views are Board | Calendar |
  Schedule: Calendar opens in place into Day, Week (3 Day on phones) and Month and remembers the
  last one per device. The phone view sheet has the same structure. `#/home` is an alias for
  `#/calendar`, which keeps working for links, notifications, widgets and Home Assistant.
* **Filter a calendar**: show only the events that match, or hide them, by keywords, all-day or
  timed, and category, with presets like "School: days off & half days".
* **Hide an event**, its whole series or every event like it, even on read-only calendars.
  Parents can show hidden events faded, and bring them back from Settings.
* **Free or busy**: events marked free (synced both ways with Google, Outlook, iCloud and
  CalDAV) are striped, sit behind busy ones, and don't count for Now / Next, leave-by,
  transition reminders or the energy battery.
* **Day view is one shared timeline**, like Week: events at the same time sit side by side with
  the faces of who they're for, and an event on two calendars shows once with everyone from both.
* **Notes on events**: write them under Location; they show labeled, with links you can tap. The
  event's comment thread is now called Discussion. Outlook events keep their full description
  instead of the first 255 characters, and editing one no longer cuts it down.
* On phones, tap a day in Month to open it in Day view, with Back to Month. The + button adds to
  the day on screen.
* **A calendar that stops syncing** shows a warning on Home on parent devices after two failed
  syncs in a row, with a link to fix it in Settings → Calendars.
* On phones, switch views from one button instead of five cramped tabs.
* Clocks change right on the minute, and a traveling phone or laptop can show **its own time
  zone** on the clock (chores, reminders and "today" stay on family time).
* Sync writes only the events that changed instead of rewriting them all.
* Signing in to a calendar account that fails now brings you back to Settings with a message.
* Google Calendar asks for narrower scopes: `calendar.events` and
  `calendar.calendarlist.readonly` replace `calendar.readonly`, which was only used to list
  calendars. Setup steps say which scopes to declare.

### Contacts

* A household **contacts directory** for people, services and places, with vCard import and a
  duplicate review. Thanks to [@OwenIbarra](https://github.com/OwenIbarra) for contributing it.
* Importing from a phone keeps every phone number, email, address, label, date and company, and
  the review shows everything before you save.
* **FaceTime** a contact from their sheet on Apple devices.
* Visibility levels that mean something: everyone, grown-ups only, chosen people or parents
  only.

### Trackers

* Track **reading**, **memories** and **health** visits for each person or the whole family.
* **Audiobooks** in the reading tracker, with listening time and a narrator.
* **Look up a book** in [Open Library](https://openlibrary.org) by the
  [Internet Archive](https://archive.org) to fill in the title, author, pages and cover, or scan
  its barcode with the Kinwall app. The server fetches covers, so screens never contact Open
  Library.
* A book keeps **pages read each day**, shown as the last 14 days in its sheet. A shelf shows
  what's being read and wanted, then the last three finished, with Show all.
* A **family library** of the books you own: scan them in one after another or search, with series,
  reading level and description. Say where each one lives, lend it to someone, track books
  **borrowed** from the town library or a friend with a due date (a heads-up two days before and on
  the day), and keep a **wishlist**. Read it starts a reading entry (or links the one someone
  already has), and Save to library works the other way.
* Trackers pick Reading, Library, Memories or Health from one view picker.

### Activities and photos

* **Family photos** for the Board, the Night screen and a Photos page. Save a Paint drawing to
  them.
* Add **activities made by others**, like Sight words and Math practice, from a list reviewed
  for Kinwall. They run sandboxed, away from your family's data.
* Paint has forty colors plus any color you pick, **brushes** (Marker, Crayon, Highlighter, Spray,
  Rainbow and Stamps), Fill, and a **coloring book** of ten pages plus your own, added on a
  parent's device from a picture or a PDF.

### Appearance

* A **new Kinwall logo** everywhere: the app icon, favicon and installed-app icons, the sign-in,
  setup, pairing and loading screens, and the foot of Settings, which now shows the version with
  links to help, the source code and open-source credits. The logo's colors follow your scheme.
* Loading screens show a small spinner and a bigger logo, and in the Kinwall app the logo holds
  still from the splash screen to the loading screen.
* **Color schemes**: eighteen built-in ones, including seasons, holidays and a Modern group led by
  Peacock, plus your own with a contrast check. Pick one for the whole family, or a different one
  on a device.
* **Peacock** 🦚 is the default for new families: deep peacock blue with a sky-blue accent, the
  logo's colors. Families who never picked a scheme keep the colors they have.
* The **Modern** schemes have more color.
* **Typefaces**: seven, including Hyperlegible (Atkinson Hyperlegible Next) and
  Dyslexia-friendly (Lexend), plus Modern, Playful, Storybook and Handwritten, for the whole
  family or per device, picked from a sheet of samples.
* Kinwall follows the device's **light or dark mode** by default.
* **12-hour or 24-hour** clock times, for the family or per device.
* **Easier for colorblind eyes**: a warning when two people's colors look alike, and charts,
  priorities and categories that don't rely on color alone.
* Settings → Features turns off what your family doesn't use, like Paint, Photos, Notes or
  Check-ins & journal (thanks to [@OwenIbarra](https://github.com/OwenIbarra) for these
  switches), and Rewards has its own. What's off also leaves the Board's layout editor, the Night
  screen and Newscast, and a chore's checklist goes with Lists.

### Devices and access

* Pairing asks **what the device is**: a wall screen or a kid's device. A wall screen turns on
  Use as a wall screen by itself. Grown-ups use their own phone's sign-in instead, and first-time
  setup asks whose phone it is.
* Settings → Access groups devices by kind, with each phone's widgets nested under it. Removing
  a phone signs its widgets out too.
* **Kids' devices change only their own things**: their own calendars, list items (or
  unassigned ones), notes, tracker entries, sticker book and activity progress. Adding to a list
  still works everywhere.
* **Wall screens and kids' devices can't** rename, archive, delete or reorder lists, change the
  family's event categories, edit the grocery catalog, add, edit or delete chores, or change
  family settings. They can still tick chores and items off.
* **Kids' devices get only their own notifications** and the family's, not messages or
  reminders meant for a grown-up.
* **First-time setup starts on a phone or computer**: on a wall screen it shows a QR code that
  opens setup there with the code filled in. Setup always leaves a way back in, a passkey or, where
  the browser can't make one, recovery codes.
* The Kinwall app for iPhone and Android (1.1.0) follows the family's feature switches in Siri,
  widgets and the Apple Watch, scans barcodes, and has the new logo and splash screen.
* A Help button in the same spot on every screen.
* Phones get a new header, a More tab when there are more than five screens, landscape support
  and an install prompt.
* Old iPads (iOS 12 to 16.3) get a compatibility build.

### Home Assistant and automations

* Automations can keep their own events in sync on a local calendar, like meal kit
  deliveries.
* A weekly meal kit blueprint imports your HelloFresh meals (through the
  [HelloFresh integration](https://github.com/kedube/ha-hellofresh) by Katherine Dubé), plans them as
  dinners and can put them on a calendar.
* Recipe, meal, contact and reward events for webhooks, and chore events carry who and how many
  points.
* Kinwall tells Home Assistant which part changed (events, lists or chores), and background
  calendar syncs that change nothing stay quiet, so the integration fetches much less.
* The Kinwall integration (1.9.0) follows the family's feature switches: with Chores & points or
  Lists off, their entities aren't created and their data isn't fetched. The blueprints say which
  features they need.
* The integration and the Home Assistant app have the new logo.
* A guide for connecting Kinwall to [n8n](https://n8n.io).

### Privacy and security

* **Health data is encrypted at rest**, always, on every host: health visits, medicines, Temp
  check sleep and feelings, goal checks, journal entries and drained check-ins.
* **Connected apps** (AI assistants and MCP) get no health data unless the family turns it on in
  Settings → Access → Connected apps, and can no longer manage sign-ins, keys or other connected
  apps.
* **No more requests to Google for fonts**: every typeface ships with Kinwall. See
  [Credits](docs/contributing/credits.md).
* **Security activity** under Settings → Access on parent devices: passkeys, sign-ins, recovery
  codes, keys, paired devices, connected apps, the Night PIN and private journal changes, kept for
  a year and searchable. A new passkey or a recovery-code sign-in also notifies parents. Privacy
  notes now show only on that person's own devices, and they can dismiss them there.
* **Opening a sign-in link asks first**, naming the family and the address, so nobody can sign
  your browser into their family with a link.
* Connecting a Google or Microsoft calendar finishes only in the browser that started it.
* Photos, covers and the photo download no longer put your key in the address (where it lands in
  browser history and logs); they use media tokens and one-time links.
* Medicine reminders in the notification feed are encrypted like the medicines themselves.
* A kid's device sees only its own reward requests and point history, and wall screens no longer
  show declined requests or a parent's note.
* Marking a grown-up as a kid is refused once they have a private journal, unless it's done from
  their own device, and the change is logged.
* Connected apps can no longer subscribe to push notifications or set up webhooks.
* Unexpected errors show "Something went wrong" with a short reference, never the server's
  internals.
* A self-hosted server checks the address an outbound fetch (webhooks, calendar feeds, recipe
  pages, images) actually connects to, so a public name pointing into your home network is
  refused.
* Sign-in attempt limits count the connection's own address, not a header anyone can set.
* A link can't tick a chore off without asking first, and a tick counts only for a day the chore
  is due.
* Push notifications go only to Apple's, Google's, Microsoft's and Mozilla's push services.
* Wrong Night PIN guesses are limited per screen and per family, and wrong setup codes per
  address, so one guesser can't lock the owner out.

### Faster

* Calendar views, the Board, lists and the notification check read far less from the database.
* Self-hosted servers send the web app compressed, so a phone's first load is about twice as
  fast.
* The app refetches only what changed, and hidden tabs stop polling (wall screens keep going).
* SQLite on Node and Docker skips an extra disk sync on every write and waits briefly for a
  backup instead of failing.

### API, MCP and export

* **Breaking**: a private journal entry's `text` is `null` (in the API and in exports) for anyone
  but its owner. `DELETE /api/notifications` keeps privacy lines.
* **Breaking**: display keys get `403` on list rename, archive, delete and reorder
  (`PATCH /api/lists/{id}` takes only `sortBy`, `groupBy` and `keepChecked`), on event category
  writes, on catalog edits, and, on a kid's device, on other people's items, notes, tracker
  entries, stickers and activity progress. A display key can't be owned by a grown-up (`400`).
* **Breaking**: connected apps (OAuth) get `403` on sign-in management routes (keys, recovery
  codes, passkeys, pairing, sign-in providers, connected apps).
* **Breaking**: `GET /mcp` answers `405` instead of holding an SSE stream open.
* **Breaking**: `GET /api/oauth/{kind}/start?key=` is removed. Start a calendar connection with
  `POST /api/oauth/{kind}/start` and the `Authorization` header; the callback finishes only in the
  browser carrying the cookie it sets. An embedding host must redirect its shared OAuth callback
  to the instance (SPEC.md, "Embedding the server").
* **Breaking**: a full key as `?key=` on image routes and `GET /api/photos/export.zip` gets `401`.
  Send it in the `Authorization` header, or use `GET /api/media-token` (for `?key=` on image
  routes) and `POST /api/photos/export-link` (a one-time zip link).
* **Breaking**: request bodies over 2 MB get `413` (the photo zip, plugin packages and import keep
  their own limits); an unreadable body on `.../clear-completed` or `.../reset` is a `400` and
  changes nothing; a kid's device can assign an item only to itself or no one.
* **Breaking**: a chore completion's date must be a day the chore is due (wall screens and kids'
  devices: the last 7 days to tomorrow). Events need valid `start`, `end` and `rrule`; repeats
  finer than daily or that can never happen are refused; `from`/`to` must be dates at most 400
  days apart, and a series gives at most 1,000 instances per read. A hidden event is a `404` by id
  to display keys.
* **Breaking**: a kid's device gets `403` on other members' reward requests and only a sibling's
  balance, not their ledger. Connected apps get `403` on push subscriptions and webhooks
  (migration 0087 removes push subscriptions they already made).
* An unexpected failure answers "Something went wrong. Please try again." with a `ref` that's also
  in the server log.
* `GET /api/lists/{id}` returns empty stores, categories and aisles for non-shopping lists, and
  takes `?suggestions=false`.
* New: `revs` in `GET /api/rev`; `householdId` in `GET /api/me`; `busy` on events;
  `includeHidden=true` for parents; `itemsRev` and `overdueCount` on lists; `addedBy`,
  `checkedBy`, `lastDoneAt` and `lastDoneBy` on items; `?skipExisting=1` on adding items;
  `POST /api/lists/{id}/items/move`; the grocery catalog under `/api/lists/remembered` (with
  `?catalog=` and `?tag=`) and `/api/lists/remembered-tags`; device kinds on keys
  (`PATCH /api/keys/{id}`, `PUT /api/me/owner`); `PUT /api/members/{id}/avatar`;
  `POST /api/rewards/redemptions/{id}/cancel`; per-display sources on `GET /api/tidbits`;
  `GET /api/security-events` (parent devices, with `q`, `kinds` and `before`); `removable` on
  notifications; `syncFailures` on calendars; `isDefault` on lists;
  `/api/chore-library`; `/api/library` and `GET /api/books/search`; `coverUrl` on reading entries
  and `GET /api/trackers/{id}/cover`; `/api/lists/{id}/barcodes/{code}`; `/api/coloring-pages`.
* MCP: `list_remembered_items`, `update_remembered_item` and `move_list_items`; `groceries` as a
  list kind; `busy` on events; `list_library`, `add_to_library`, `update_library_book` and
  `search_books`; `isDefault` on `update_list`, and `add_list_items` with no list uses the default
  Groceries list.
* Export: `itemBarcodes`, `libraryBooks` and `choreLibrary` are included; older files still import.
* Older export files (without `overdueCount`) still import.
* `GET /api/board` and `GET /api/snapshot` (and MCP `get_board` / `get_snapshot`) answer empty
  `chores` while Chores & points is off and empty `items` while Lists is off, in the same shape.
* New settings: `features.checkIns` and `rewardsEnabled` (both default on). Reward requests
  answer `403` while rewards are off.

### Fixed

* The **update banner** no longer shows for good inside Home Assistant.
* A calendar feed no longer loses every event when its last event is old.
* Deleting a chore keeps the points already earned from it.
* Marking a chore not done asks first, so a stray tap doesn't take points back.
* The update banner no longer gets stuck behind cooking mode or shopping mode.
* A refresh no longer flashes the default colors before your color scheme loads.
* A browser tab and the installed app no longer fight over the saved look and pin the CPU.
* Recipe ratings and steps no longer show twice.
* Shared recipe pages no longer fail on an old recipe's source link, and skip photos they can't
  show.
* Foggy weather shows a cloud instead of a gray square on iPhone and iPad.
* Profile sections no longer squash on short screens.
* Contact phone numbers survive a vCard import with a photo, and one bad value no longer fails
  the whole import.
* Merged contacts stay as private as the stricter copy.
* Passkeys work behind Home Assistant's ingress, and other proxies, when Home Assistant serves
  https itself (also in 1.0.3).
* Passkeys work in the Home Assistant app (add-on) without setting `PUBLIC_URL`: requests through the
  Supervisor's ingress proxy (172.30.32.2 only) use the browser's own address, even when an
  upstream proxy rewrites Host. A page on the wrong address gets a clear 400 naming the right one.
  Inside a frame (Safari refuses passkeys there), Settings links to Kinwall in its own tab.
* Contact import keeps Apple and Android labels, names, departments, yearless birthdays,
  anniversaries and extensions. The review matches the contact editor and offers to update a
  duplicate.
* First-time setup: going back keeps the people already added, starter chores work on a wall
  screen, a reload resumes setup, and the "Saved" pill no longer sticks.
* A new family's leaderboard no longer ranks everyone #1 at 0 points.
* The Cloudflare setup script runs on Windows.
* Tapping to wake the Night screen no longer taps what's underneath.
* Returning to the Board when idle no longer pulls a kid out of an activity or a parent's phone
  away from what they're reading.
* Scrollbars show with a mouse and on light pages; open lists no longer pan sideways on touch.
* Long timer names wrap instead of pushing the clock off screen.
* A Try again button when the Board or events fail to load.
* Activities no longer disappears when Paint, Photos and the sticker book are off but an added
  activity (like Math practice) is on, and a chore's Play link always opens its activity.
* With Photos off, the Board's picture card falls back to other pictures instead of going blank,
  and the Night screen shows drawings only while Paint is on.
* All-day events from a synced calendar no longer drop out for a few hours around midnight and
  come back (which also sent two updates and webhooks a day for each one).
* One failing part of the scheduled background work (calendar sync, reminders, the daily summary,
  cleanup) no longer stops the rest, and one calendar that fails to sync doesn't hold up the
  others.
* Accent text (links, the active tab, focus rings) stays readable after switching to dark mode.
  Dark schemes with a deep accent, like Peacock, showed it most.
* On narrow phones the header hides the family name instead of cutting it to "O…" when the offline
  icon or the Night button is showing, and every icon keeps its full size.
* The Board lists today's meals by time, so a 3:30 snack no longer shows after a 6:00 dinner.
* Count tiles take two rows on tablets instead of being cut off, and the tablet header's buttons
  stay on screen.
* Day and Week line up with their hour labels on a phone turned on its side.
* An activity's title stays readable on a phone when its chore is done.
* A setup code pasted with a space works, and a new family on a reinstalled server no longer picks
  up the last family's Board layout, filters or unsynced changes.
* A time zone with no offset shows as UTC, not UTC+0.

### Upgrading

* **Database migrations run automatically** when the server starts (Docker, Node and the Home
  Assistant app) or on the first request (Cloudflare Workers). There's nothing to run by
  hand.
* **Health data needs an `ENCRYPTION_KEY`.** Docker and the Home Assistant app already have
  one: if you didn't set `ENCRYPTION_KEY` or `ENCRYPTION_KEY_FILE`, it was generated into
  `encryption.key` in your data folder on first boot. On Cloudflare Workers, make sure the
  `ENCRYPTION_KEY` secret is set (the setup script sets one). Without a key, Kinwall refuses to
  save health visits, medicines and check-in answers rather than store them unencrypted, and an
  import that includes them is refused. Keep the key with your backups: a lost key can't be
  recovered.
* **Kids' devices and wall screens can do less.** They can no longer delete, archive, rename or
  reorder lists, edit event categories or the grocery catalog, or add, edit and delete chores.
  On a kid's device, other people's list items, notes and tracker entries open read-only, and
  notifications follow only that kid. Parent devices are unchanged.
* **Grown-ups' journals become private**, including past entries, and open only on that
  grown-up's own devices. Each grown-up should pick themselves under Settings → Access → **This device** so their
  phone counts as theirs. A paired display that belonged to a grown-up shows under **Needs a
  fix**; pick a wall screen or a kid for it.
* **Quiet hours are now Night** (Settings → General → For the whole family → Night). Your times,
  PIN and night screen carry over, and both effects stay on. Old links to the quiet hours page
  redirect.
* **Shopping lists are split** into Groceries and Shopping by name. Check that each list landed
  on the right side, and change its type under **Edit** → **Type** if not. Meal ingredients go only
  to Groceries lists.
* **Color scheme**: new families start on Peacock. If you never picked a scheme, you keep Peach:
  migration 0079 stores it for you. Migration 0094 does the same for the default Peacock replaces,
  but a server upgrading from 1.0.x already has Peach stored, so it changes nothing there.
* **New switches start on.** Check-ins & journal (`features.checkIns`) and Rewards
  (`rewardsEnabled`) default on, so nothing disappears; turning one off hides it and keeps its
  data. Check-in points now also need Chores & points on.
* **Board and snapshot answers follow the switches.** `GET /api/board` and `GET /api/snapshot`
  (and MCP `get_board` / `get_snapshot`) return empty `chores` while Chores & points is off and
  empty `items` while Lists is off, in the same shape, and `checkInPoints` reads 0 while check-in
  points can't be earned. Anything reading them should expect empty arrays.
* **Behind a reverse proxy or Cloudflare Tunnel** (Docker or Node), set `TRUST_PROXY=1` and
  publish the port only to the proxy. Kinwall now ignores `X-Forwarded-For` without it, so
  sign-in attempt limits would count everyone behind the proxy as one address. Don't set it when
  the port is reachable directly. See [Configuration](docs/self-hosting/configuration.md).
* **Fonts** now come from your own server. If you run a reverse proxy with its own
  Content-Security-Policy, it no longer needs the Google Fonts hosts.
* **Home Assistant**: update the Kinwall Home Assistant app to 1.1.0 and the Kinwall integration to
  1.9.0 or later, so it fetches only what changed and follows the feature switches (1.8.0 fetches
  less too, but keeps the entities of a switched-off feature).
* **The Kinwall app for iPhone and Android**: update to 1.1.0. Connecting a Google or Microsoft
  calendar from inside the app needs it (older versions are told to update or use a browser), as
  do barcode scanning and the feature switches in Siri, widgets and the Watch.
* **Home Assistant app**: `PUBLIC_URL` is no longer needed for passkeys. Use https and a host
  name; each address needs its own passkey, or set `PUBLIC_URL` and use only that address.
* **Your own Google OAuth client**: Kinwall now requests `calendar.events`,
  `calendar.calendarlist.readonly`, `openid` and `email`. Declare those under the consent screen's
  **Data access** (drop `calendar.readonly`). Accounts connected before keep working; their grant
  covers more.
* **Cloudflare Workers**: deploy with this release's `wrangler.toml`, which adds the routes for
  recipe share links and activities.
* Connected apps that managed keys, passkeys or other sign-ins through the API need a parent's
  own sign-in for that now, and can no longer subscribe to push or set up webhooks.
* **Scripts and integrations using the API**: a full key in the address (`?key=`) no longer works
  for images or the photo download, and calendar connections start with
  `POST /api/oauth/{kind}/start`. A sign-in link (`#key=`) now asks before it signs a browser in.
  The other breaking API changes are listed under [API, MCP and export](#api-mcp-and-export);
  nothing else breaks.
* The old accent and background presets are replaced by color schemes; an accent you set carries
  over.
* Self-hosters can see how to delete their family's data in Settings.
