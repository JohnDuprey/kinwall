# What's new

The full list of changes in every version is in the [changelog](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md), and each version is on the [releases page](https://github.com/JohnDuprey/kinwall/releases). Self-hosting? See [Updating](self-hosting/updating.md) for how to move to a new version.

## Coming in the next version

### Highlights

* **School**: a new place for what each kid learns, for kids who are homeschooled and kids who
  go to a school. Log time by subject for one kid or several at once; add lessons, homework, tests
  and projects that kids tick off like chores (with the same repeat options, and optional points);
  see each kid's school day with their bus or pickup, school hours, the school's and district's
  calendars, lunch and teacher. Days off, early release and the last day of school come from those
  calendars (or a grown-up marks one), with early release times and a countdown to summer; bus and
  pickup reminders go out once for kids on the same bus, with a Lock Screen countdown on iPhone.
  Grown-ups get report card grades, records of a school year against hour and day
  goals, a photo portfolio and a printable year-end report. Time a kid logs can wait for a
  grown-up's OK. School starts off: turn it on in Settings → General → Features. See
  [School](using/school.md).

## 1.4.0

Catch a thought before it slips away, then look over the week together and get ready for what's
coming. Keep track of the food you have and find meals to use it up, with easier ways to share
and organize chores.

### Highlights

* **An inbox for passing thoughts**: jot down "Permission slip for Friday" without picking a
  date, person or list first. Later, turn it into a task, calendar event or note on the family
  board. It stays in the inbox until you've added it, and cleared thoughts can be brought back.
  See [Inbox](using/inbox.md).
* **Plan the week**: open it from Home or Calendar to see next week's events, dinners, to-dos
  and home upkeep together. Pick meals, swap a planned dinner or leave one open on purpose, and
  add preparation tasks linked to an event. Save a shared draft, then review what to add to the
  week. See [Plan the week](using/weekly-planning.md).
* **Pantry lists**: keep food at home on its own list, with use-by dates and where it's kept.
  Scan barcodes in the Kinwall phone app, see what needs using first, and optionally have used-up
  food added to your grocery list when you check it off. See [Lists](using/lists.md#pantry).
* **Use it up**: the meal planner suggests your own recipes for food that expires soon, showing
  what you have and what you'd still need. Open a recipe or plan it for dinner. A connected AI
  assistant can help with ideas too. See [Meals](using/meals.md#use-it-up).
* **Chores for several people**: give each person their own copy of a chore in one go. Everyone
  ticks theirs off and earns their own points; editing the chore changes all the linked copies.
  See [Chores](using/chores.md#chores-for-several-people).
* **Chores in your order**: drag chores into place or use the up and down buttons, and give them
  categories such as Kitchen or Garden to find them more easily. See
  [Chores](using/chores.md#putting-chores-in-order).
* **Ongoing responsibilities**: keep jobs like putting a wash on available for anyone to do
  again, even on the same day. Each completion earns its own points and can need a parent's OK,
  without adding unfinished daily work or breaking streaks. See
  [Chores](using/chores.md#ongoing-responsibilities).
* **Catch up on late chores**: the Board keeps missed chores in reach for seven days, including
  the most recent missed time for a repeating chore. Open the late list to finish one for the day
  it was due; a chore with an unfinished checklist opens that checklist first. Parents can also
  choose **Not done**, with Undo, to remove that missed day without awarding points or changing
  future repeats. See
  [Chores](using/chores.md#late-chores).
* **Today at a glance**: on a wall or a tablet, medicine, chores, free time, to-dos,
  an open poll and the list counts sit on one line above the cards, so the Today card keeps its
  whole column for the day's events. What doesn't fit opens from **+N more**. See
  [Board view](using/calendar.md#board-view).

### Everything else

* Recipe pickers share search, sorting and cooking-history filters. Find favorites, top-rated
  recipes, meals you cook often or something you have never cooked. See
  [Meals](using/meals.md#planning-the-week).
* Planning has a visible **Close** button on every step, asks before discarding unsaved changes,
  and fits the Calendar toolbar on phones. Hide the Home planning prompt for today, this week
  or until you bring it back; planning stays available in Calendar.
* The Board fits its available space more reliably, keeps late chores reachable and stops rows
  flickering between the card and **More**. On wide screens, approvals sit below the chore
  columns. Inbox and notification badges line up.
* Meals puts planned meals first on phones. Cooking instructions are easier to read on a wall,
  eating-out order actions are easier to find, and ingredients already on the grocery list
  start unticked when choosing what to add. **Plan meal** starts on the day you're looking at.
* Removing a book from the library, deleting a journal entry or removing an upkeep file asks
  first. **Share recipe** explains who can see a recipe and makes a link only when you tap
  **Make a link**.
* Chore repeat and due-date choices are easier to find, with less-used options under
  **More options**. Rewards appear before milestones, and everyday labels and passkey errors use
  clearer words.
* Settings cards have clearer names, such as **Language on this device** and **Appearance for
  the family**, and search finds settings by everyday words such as "quiet hours" or "font".
* Leaving Free time or a journal takes you back to where you opened it. Open Free time from
  Home, and Back returns to Home instead of Chores.
* Event details show which calendar an event comes from. Calendar and Chores views showing today
  move to the new day after midnight; a date you picked stays put.
* Calendar feeds handle older repeating events and timezones more reliably, including all-day
  events on servers in another timezone. Reminders set more than two days ahead now arrive.
* Cooking steps such as "1 hour 15 minutes" make one timer, and short timers show their actual
  duration.
* Clearer icons throughout the app, fixes for lists switching or saving their settings, and
  edited contact phone numbers saving correctly. Coloring pages and profile pictures no longer
  turn up as memories.
* Notification settings explain why the phone app's push notifications are off. Fixes also keep
  browser notification registrations from displacing the phone app's registrations.
* A passkey saved in a password manager such as 1Password signs in from your other browsers and
  devices too, at the same Kinwall address. See
  [Sign-in and security](using/sign-in-and-security.md).
* Security fixes for passkeys, connected-app sign-in, device pairing and activity updates.
* Less database work for long event reminders and phone notification registration, and faster
  recipe matching for the pantry.

### Upgrading

See [Updating](self-hosting/updating.md). The database updates itself on first start. Existing
lists and chores keep their types and schedules; pantry lists and ongoing responsibilities are
choices you turn on. Turning a synced to-do list into a pantry list stops its to-do-app sync.

Weekly planning is for parents. Its drafts are shared between parents and included in backups;
**Save draft** keeps choices without adding anything, while **Add to the week** applies the
reviewed meals and preparation tasks. Preparation tasks have due dates, not timed alerts.

Inbox is for parents and included in backups. It starts on; turn it off under
**Settings → General → Features → Inbox** if you don't need it. Capturing a thought doesn't
notify anyone. Turning one into a note on the family board makes that note visible on Home.
English day words such as "Friday" can suggest a date to check before adding an event or task.

Self-hosted Android push enrollment also needs the Kinwall Android app update that names the
server's public address (version 1.4.0); install it when it reaches your test channel. The phone apps are available as test builds through TestFlight and Google Play testing,
not yet as public store listings; see [Native apps](integrations/mcp.md#native-apps).

If you use the REST API or MCP: linked chores change together when edited or deleted, and ongoing
chores return a separate completion ID for each tick. See
[REST API](integrations/rest-api.md#chore-organization) and
[MCP](integrations/mcp.md#chore-organization) for the new fields and retry behavior. Calendar feed
downloads now have a 20 MB limit and a 30-second timeout.

## 1.3.0

Kinwall now looks after the house too, keeps kids' screen time tied to their chores, and its
phone apps get real push notifications, even from a server you run yourself.

### Highlights

* **Home upkeep**: a new **Upkeep** tab for the jobs that come round every few months or years:
  the furnace filter, smoke alarms, the gutters, the oil change. Each job repeats from the last time
  it was done or on set dates, reminds you before it's due, and keeps a history of who did it and
  what it cost. Keep each thing's model, part sizes, warranty and receipts, give a job to a kid as a
  chore with points (Done then waits for a grown-up's OK like any chore), and have its supplies go
  on the shopping list. See [Home upkeep](using/upkeep.md).
* **Routine mode** (preview, iPad and iPhone): a parent sets when a kid's day starts and when free
  time ends, and the chores that come first. Until they're done and approved, only the apps and
  websites you allow open, like school links, and the kid sees what's left on a free-time page.
  See [Routine mode](using/routine-mode.md).
* **Real push on iPhone and Android**: notifications from the Kinwall apps arrive even when the
  app is closed. A self-hosted server sends them through the Kinwall push gateway, with no Apple or
  Google keys to set up. See [Push gateway](self-hosting/configuration.md#push-gateway).
* **Live Activities on iPhone**: follow an event, a medicine dose or a timer on the Lock Screen.
  See [Notifications](using/notifications.md#live-activities-kinwall-app-for-iphone).
* **Medications** are organized around today and history, with alarms for reminders and a second
  try when an alert doesn't get through. See [Medications](using/medications.md).
* **Reward milestones**: earn a reward without spending points, like "Earn 100 points → pick the
  family movie". See
  [Rewards](using/rewards.md#reward-milestones).
* **Chores repeat your way**: custom schedules, more than one day a month, and flexible goals. The
  date strip shows what's unfinished, and devices hear about a new chore right away. See
  [Chores](using/chores.md).
* **Scheduled announcements**: write one now, and it shows up on the board when it starts and
  goes away when it ends. See
  [Family announcements](using/announcements.md).

### Everything else

* Overnight events show on every day they cover, and outings can add visits that last several days.
* Ticked items on grocery and shopping lists can clear themselves after a time you pick.
* An optional morning check-in reminder, names for paired devices and API keys, and a switch to
  hide the status bar in the phone apps.
* Reminders for "Anyone" chores are now opt-in.
* Faster: Kinwall starts quicker and reads much less from the database.
* Fixes for the Nest Hub layout, routine labels at large text sizes, duplicate Live Activities and
  an outing's sheet that wouldn't stay closed. See the
  [changelog](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md).

### Upgrading

Updates install like any other: see [Updating](self-hosting/updating.md). The database updates
itself on first start. If you use the REST API: push registration and Live Activity routes now
answer with `{push, delivery, gatewayExpiresAt?}` instead of `nativePushReady`, and undoing an
upkeep job works only from the device that did it (or a parent's).

## 1.2.0

* **Calendar has its own place** in the navigation, right after Home, with **Day | Week | Month |
  Schedule** in one switch (3 Day on a phone). Home is now **Board | Newscast**, and the Board's
  layouts moved into **Layout and filter** (the sliders on its toolbar), together with the category
  filter. On a phone the bottom bar is Home, Calendar, Chores and Lists, and Contacts is first under
  More. Reminders open Calendar on the event's day. See [Home & calendar](using/calendar.md#views).
* **Editing without press and hold**: on a parent's device, tap **✏️ Edit chores** on Chores or
  **Edit lists** under the lists, then tap what you want to change. Tap **Done** to go back to
  ticking. Right-click still works on a computer. See [Chores](using/chores.md) and
  [Lists](using/lists.md).
* **Kinwall speaks German.** Pick the family's language in Settings → General → Household, and
  anyone can pick their own for their own devices. A wall stays in the family's language when
  someone taps their face; the activities they play use theirs. German covers every screen and the
  text the server writes: notifications and reminders, the newscast, insights, the battery, the
  weather and error messages. A push goes out in the language of the person whose phone it is. The
  phone apps' own screens are still English. Translation by
  [sudo-Foras666](https://github.com/sudo-Foras666). See
  [Language](settings/general.md#language), and [Translations](contributing/translations.md) to
  help add another language.

* **To-do lists sync with Todoist, Google Tasks and Microsoft To Do**, both ways: titles, done,
  due dates, notes and priority (not in Google Tasks). Connect the app in **Settings → Calendars →
  To-do apps**, then pick the list in a to-do list's **Edit → Sync with…**. The first sync matches
  items with the same title and copies the rest; after that, each change goes across within seconds,
  and a field changed on both sides goes to the side that changed it last. Steps sync too, as
  subtasks or To Do checklist items. Parents get a notification if an app stops letting Kinwall in,
  and backups bring synced lists back once the app is connected again. See
  [To-do apps](using/todo-apps.md).

## 1.1.0

Kinwall is now more than a calendar on the wall: it's the family life organizer, for the day, the
meals, the groceries, the chores and the people.

### Highlights

* **Newscast**: a new Home tab with what the family did and shared: chores done, rewards given,
  new photos and drawings, books finished, birthdays and short announcements anyone can post, with
  👏 ❤️ 🎉 reactions. Tap a picture to see it full size. No push, no counts to compete over, and
  health, journals and check-ins never appear. See [Newscast](using/newscast.md).
* **Board**: a new default view with the family's day at a glance. Each screen can have its own
  layout: pick Kids, Kitchen, Parents or Simple, or drag cards where you want them. On a phone,
  today's weather sits right beside the time. See [Board view](using/calendar.md#board-view).
* **Meals and recipes**: plan the week, import recipes from any link, cook one step at a time with
  timers, rate and share recipes. See [Meals](using/meals.md).
* **Groceries that follow the store**: aisles, Checkout, Shopping mode and a catalog of
  everything you buy. See [Lists](using/lists.md).
* **Medications**: reminders, a Take now card and courses that end on their own. See
  [Medications](using/medications.md).
* **Check-ins and private journals**: a quick Temp check, an evening goal check and a journal
  that stays private. See [Journal](using/journal.md).
* **Night**: one schedule for when wall screens rest and reminders wait. See [Night](using/night.md).
* **A new look**: a new Kinwall logo, and **Peacock** 🦚, deep blue with a sky-blue accent, for new
  families.

### Lists and groceries

* Shopping lists are now **Groceries** or **Shopping**, so hardware-store things stop showing up
  on the grocery list.
* Items remember their store, aisle and department. **Shopping mode** walks one store in aisle
  order, and a store that sells both shows both lists together.
* A **catalog** of everything you've bought, with your own categories like Breakfast or Lunchbox.
* Move an item to another list, see who added or checked it off, and swipe left to delete (with
  Undo).
* Each list shows how many items are overdue.
* **Scan products** onto a list with the Kinwall app's camera, and scan to check them off while you
  shop. New products are looked up in [Open Food Facts](https://world.openfoodfacts.org) and its
  sister databases for [household](https://world.openproductsfacts.org),
  [beauty](https://world.openbeautyfacts.org) and [pet](https://world.openpetfoodfacts.org) items.
* Pick a **default list** for groceries and for shopping.

### Meals

* Plan meals for the week and add their ingredients to your Groceries list. Thanks to
  [@OwenIbarra](https://github.com/OwenIbarra) for contributing it.
* On phones the planner opens on today, with a Day/Week switch, and Swap is right at the top of a
  meal.
* Import recipes from a website, pasted text or a meal kit. Home Assistant can bring in your
  HelloFresh box each week (through the [HelloFresh integration](https://github.com/kedube/ha-hellofresh)
  by Katherine Dubé).
* Cooking mode shows one step at a time with timers you can pause and reset.
* Tap a meal on the Board to open it right there.

### Timers

* Start a **quick timer** from the header for homework, chores or anything else. Timers keep
  running when you close things or reload, and ring over everything. See [Timers](using/timers.md).

### Chores

* A **Chore library** for occasional jobs like cleaning out the car or washing the windows: save
  them once, then hand one out in a few taps. Kinwall shows when each was last done and brings
  the ones that are about due to the top.

### Kids and permissions

* **Rewards** that kids spend chore points on, with parent approval. Kids can cancel their own
  request while it's still waiting. See [Rewards](using/rewards.md).
* Kids can **pick their own avatar** on their own device.
* A **kid's device changes only that kid's things**: their own list items, notes, tracker
  entries, stickers and calendars. They can still add to any list and tick off chores.
* **Wall screens and kids' devices** can no longer delete, archive, rename or reorder lists,
  edit event categories or change the grocery catalog. Ask a grown-up's device for those.
* A kid's device gets only that kid's and the whole family's notifications.
* When you pair a device, Kinwall asks whether it's a **wall screen or a kid's device**.

### Night

* **Quiet hours are now Night**: one family schedule with two parts you can turn off on their
  own: wall screens rest on the Night screen, and reminders wait until morning. Medicine
  reminders and event reminders always come through.
* The Night screen, the PIN to wake and what walls show at night are all in one place: Settings
  → General → For the whole family → Night.
* Dark mode can follow the same schedule. See [Night](using/night.md).

### Calendar

* The main screen is now **Home**: **Board | Calendar | Schedule**, where Calendar opens into
  Day, Week (3 Day on phones) and Month and remembers the one you used last.
* **Day view** is one shared timeline, and an event on two calendars shows once.
* Events have **notes**, and parents get a heads-up on Home when a calendar stops syncing.
* **Filter a calendar** to show or hide events by keywords, all-day or category, with presets
  like "School: days off & half days".
* **Hide one event** or its whole series, even on calendars you can't edit.
* Events can be **free or busy**, synced with your calendar. Free events don't count for leave-by
  or transition reminders.
* On phones, switch views from one button. A phone that travels can show its own time zone on the
  clock.
* Connecting Google Calendar asks for less: editing events and the list of your calendars,
  instead of reading everything in every calendar.

### Journal and check-ins

* A grown-up's **journal is private**: it opens only on their own phone. A parent can let a kid
  keep a private journal too. Moods still show, so Insights keep working.
* Last night's check-in stays open until the next morning, with one gentle reminder.
* [Insights](using/insights.md) and the [Energy battery](using/battery.md) show patterns in
  sleep, feelings, goals and busy days.

### Everything else

* A **family library** of the books you own: scan or look them up in
  [Open Library](https://openlibrary.org), say where each one lives, lend them out, track
  borrowed books and their due dates, and keep a wishlist. See [Trackers](using/trackers.md).
* **Paint** has new brushes and a coloring book, with room for your own pages.
* **Profiles** for each person, a new household **contacts** directory (contributed by
  [@OwenIbarra](https://github.com/OwenIbarra), with phone imports and FaceTime on iPhone, iPad and Mac), and **trackers** for reading, memories and health. See
  [Profiles](using/profiles.md) and [Contacts](using/contacts.md).
* **Color schemes and typefaces** for the family or one device. New families start on **Peacock**;
  if you never picked a scheme, you keep the colors you have. See [Appearance](using/appearance.md).
* Turn off **Check-ins & journal** or **Rewards** if your family doesn't use them, like the other
  switches in Settings → General → Features. Nothing is deleted.

### Home Assistant

* Turn the Night screen on and off from Home Assistant, for example when nobody's home.
* Kinwall tells Home Assistant what changed, so it fetches much less.
* The integration follows your feature switches, and it and the Home Assistant app wear the new
  logo.
* The "Kinwall updated" banner no longer shows for good inside Home Assistant.
* Passkeys work in the Home Assistant app (add-on) without setting `public_url`, even behind a proxy that
  rewrites the address. If the page isn't where passkeys are set up, Kinwall now says which address
  to open. If your browser won't add a passkey inside Home Assistant's panel, Settings links to
  Kinwall in its own tab, where it works.

### Privacy

* **Fonts ship with Kinwall**, so no screen asks Google for them anymore. See
  [Credits](contributing/credits.md) for the typefaces and the people behind them.
* **Security activity** in Settings → Access shows parents every sign-in, new passkey and paired
  device, and a sign-in link now asks before it signs a browser in.
* Health data is always encrypted at rest and stays away from connected apps unless you turn it
  on. See [Privacy & what's encrypted](your-data/privacy.md).

### Fixes

* A calendar feed no longer loses every event when its last event is old.
* Deleting a chore keeps the points already earned, and marking one not done asks first.
* A refresh no longer flashes the wrong colors, and links stay readable in dark mode.
* All-day events from a synced calendar no longer disappear for a few hours around midnight.
* Contacts imported from a phone keep every number, email, address and date.
* Contacts imported from a phone or a vCard keep labels like Mobile and Work, first and last
  names, birthdays without a year and anniversaries, and the review offers to update a contact
  you already have instead of adding it twice.
* Plus many smaller fixes; see the [changelog](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md).

### Upgrading

Updates install like any other: see [Updating](self-hosting/updating.md). The database updates
itself on first start.

* **Kids' devices and wall screens can do less.** If a kid used to rename or delete lists, or a
  wall screen edited event categories, do that from a parent's phone now.
* **Grown-ups' journals become private**, past entries included. Each grown-up should pick
  themselves under Settings → Access → **This device** on their own phone. If a paired screen
  belonged to a grown-up, Settings → Access lists it under **Needs a fix**: make it a wall screen
  or a kid's device.
* **Quiet hours moved to Night.** Your times and PIN carry over and nothing changes until you
  change it.
* **Check your shopping lists.** Kinwall sorted them into Groceries or Shopping by name. If one
  guessed wrong, change it in the list's **Edit** → **Type**.
* **Home Assistant**: update the Kinwall Home Assistant app to 1.1.0 and the Kinwall integration
  to 1.9.0 or later.
* **The Kinwall app**: update to 1.1.0 to connect calendars from inside the app and to scan
  barcodes.
* **New switches start on**: Check-ins & journal and Rewards stay just as they were until you turn
  them off.
* **Home Assistant app and passkeys**: you no longer need `public_url`. Open Home Assistant by
  name over https (not an IP address). A passkey works only at the address where it was made, so
  add one for each address you use (at home and away), or set `public_url` and use only that one.
  The app's own port (8080) has no passkeys without an https proxy in front.
* **Your own Google client**: Kinwall now asks for `calendar.events` and
  `calendar.calendarlist.readonly` (not `calendar.readonly`). Declare those under your consent
  screen's **Data access**. Accounts you already connected keep working.
* **Self-hosting**: health data needs an `ENCRYPTION_KEY`. Docker and the Home Assistant app
  already have one; on Cloudflare Workers make sure the secret is set and deploy with this
  release's `wrangler.toml`. Behind a reverse proxy, set `TRUST_PROXY=1`. See the
  [changelog's Upgrading notes](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md#upgrading).
