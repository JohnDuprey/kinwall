# What's new

The full list of changes in every version is in the [changelog](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md), and each version is on the [releases page](https://github.com/JohnDuprey/kinwall/releases). Self-hosting? See [Updating](self-hosting/updating.md) for how to move to a new version.

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
