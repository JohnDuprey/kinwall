# Changelog

## [1.1.0](https://github.com/JohnDuprey/kinwall/compare/v1.0.2...v1.1.0) (2026-09-29)

A big one: a Board view for the wall, meal planning and recipes, groceries that follow the store,
rewards, medications, daily check-ins and a lot more. Self-hosting? Read [Upgrading](#upgrading)
first.

### Board

* A new **Board** view, now the default: the family's day at a glance with the clock, weather,
  today, coming up, due soon, chores, a rotating picture and a quote or fact.
* The quote card can show fun facts, "On this day", trivia you tap to answer, or practical tips
  for routines, focus and feelings. Pick the sources in Settings → Quotes & facts.
* **Count tiles** for chores, due soon, groceries and reward requests on smaller screens, with
  full cards on big ones. Each display picks Counts, Full lists or Auto, and tiles fill the grid
  without gaps.
* A **Take now** tile for medicines that are due.
* On a wall screen the Board fits the screen, with "+3 more" for the rest.
* Pictures show whole, never cropped.

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
  reminders arrive even during quiet hours.
* The Health tab can switch **whose health** it shows.

### Check-ins

* **Temp check**: a few quick questions at the end of a person's day: how they slept, how they
  feel and a goal for today, which shows on the Board.
* **Check-in points**: reading your day to the end and tapping "I'm all caught up" can earn
  points (Settings → Family, off by default).
* An evening **goal check** ("Did you finish your goal?") with optional notes, and a personal
  **journal** that only that person and parents can open.
* A **drained check-in** ("How drained do you feel?") when the energy battery is on.

### Insights and the energy battery

* **Insights** for each person: sleep, feelings, goals, chores and busy days as charts, with
  plain summaries and, after three weeks of check-ins, the connections that show up.
* The **Energy battery**: a rough daily energy level from sleep, feelings, events, chores and
  goals, with a heads-up the evening before a day that looks heavy. It learns from drained
  check-ins.

### Recipes and meals

* **Meal planning**: plan the week's meals, see who's eating, and add the ingredients to your
  grocery list. Thanks to @OwenIbarra for contributing it.
* Put meals on **any calendar** at your usual meal times; the event follows the meal.
* **Import recipes** from any website link, pasted text or a meal kit, with step photos,
  bullets and timers kept.
* **Cooking mode**: full screen, one step at a time, with the step's photo, its ingredients and
  its own named timers. The screen stays on while a recipe is open.
* **Ratings**: everyone can give a recipe 1 to 5 stars, with a Top rated sort.
* **Share links** for a recipe, with a link preview. A link shared from one Kinwall imports into
  another with nothing lost.
* **Basics** like a spice blend, sauce or dough that other recipes link to. When you add
  groceries, Kinwall asks if they're made already.
* Choose a meal's recipe from a **searchable picker**, and **swap** a planned meal with another
  one later in the week.

### Lists and groceries

* Grocery items remember their **store, aisle and department**, sort in aisle order, and stay
  crossed off in place until **Checkout** (with undo).
* **Shopping mode**: one store's trip, full screen, in walking order, grouped by aisle. Walk the
  aisles **in reverse** when you come in the other door.
* A to-do's priority shows as a labeled badge.
* **Autocomplete** when adding shopping items.
* The Lists page groups lists into **Shopping, To-dos and Reusable** sections, and you can
  **reorder** them.
* An item's notes get more room to read.
* **Offline**: the app opens without a connection, and list and chore changes sync when it's
  back.

### Chores and rewards

* **Rewards** that kids spend chore points on, with limits, goals on the Board and parent
  approval.
* Optional **parent approval** for chores: a tick waits for a parent's OK before it earns points.
* **Chore checklists**: link a list to a chore, and it's done once every item is ticked.
* **Activity chores** like "5 min of Sight words", done by playing.
* Ticking an Anyone chore asks who did it, so the right person gets the points.
* Chores can be ticked off from a person's day.

### Profiles and family

* A **profile** for each person: chores and points over time, streaks, their bookshelf, badges,
  sticker book and a birthday countdown when it's close.
* **Grown-ups**: mark a member as a grown-up, and their chores never wait for an OK.
* **Transition reminders** for each person before their events, with warning times you pick
  and repeat, and friendly headlines that change from day to day.
* **Start prep by**: a meal's event counts down to when to start cooking, not just when to leave.
* Tap the family name on a phone to filter to one person or open their day.

### Contacts

* A household **contacts directory** for people, services and places, with vCard import and a
  duplicate review.
* Visibility levels that mean something: everyone, grown-ups only, chosen people or parents
  only.

### Trackers

* Track **reading**, **memories** and **health** visits for each person or the whole family.
* **Audiobooks** in the reading tracker, with listening time and a narrator.

### Activities and photos

* **Family photos** for the Board, the screensaver and a Photos page. Save a Paint drawing to
  them.
* Add **activities made by others**, like Sight words and Math practice, from a list reviewed
  for Kinwall. They run sandboxed, away from your family's data.
* Paint has forty colors plus any color you pick.

### Appearance

* **Color schemes**: sixteen built-in ones, including seasons, holidays and a Modern group, plus
  your own with a contrast check. Pick one for the whole family, or a different one on a device.
* **Typefaces**: Modern, Playful, Storybook or Handwritten (and a hyperlegible one), for the whole
  family or per device, picked from a sheet of samples.
* Kinwall follows the device's **light or dark mode** by default.
* **12-hour or 24-hour** clock times, for the family or per device.
* **Easier for colorblind eyes**: a warning when two people's colors look alike, and charts,
  priorities and categories that don't rely on color alone.
* Settings → Features turns off what your family doesn't use, like Paint, Photos or Notes.

### Devices and access

* Pick who a device belongs to when you pair it: shared, or one person's.
* Kids' devices change only their own calendars, and each calendar has a switch for whether
  wall screens and kids' devices can edit it.
* Wall screens and kids' devices can tick chores off but can't add, edit or delete them, and
  can't change family settings.
* Works inside the Kinwall app for iPhone and iPad.
* Phones get a new header, a More tab when there are more than five screens, landscape support
  and an install prompt.
* Old iPads (iOS 12 to 16.3) get a compatibility build.
* A **Help** button in the same spot on every screen.
* **Use as a wall screen**, per device: a **Night screen** button, a night screen during quiet
  hours with a clock that moves around, and an optional PIN to wake it.
* The **Kinwall app for iPhone and Android**: Live Activities (cooking timers, shopping trips,
  leave-by and medicine due), widgets, and links that open a recipe, contact, check-in or
  shopping trip.

### Calendar sync

* Sync writes only the events that changed instead of rewriting them all.
* Signing in to a calendar account that fails now brings you back to Settings with a message.

### Home Assistant and automations

* Automations can keep their own events in sync on a local calendar, like meal kit
  deliveries.
* A weekly meal kit blueprint imports your HelloFresh meals, plans them as dinners and can put
  them on a calendar.
* Recipe, meal, contact and reward events for webhooks, and chore events carry who and how many
  points.
* A guide for connecting Kinwall to n8n.
* Start and end the **night screen** on wall screens from Home Assistant, for example when
  nobody's home.

### Privacy and security

* **Health data is encrypted at rest**, always, on every host: health visits, medicines, Temp
  check sleep and feelings, goal checks, journal entries and drained check-ins.
* **Connected apps** (AI assistants and MCP) get no health data unless the family turns it on in
  Settings → Access → Connected apps.

### Fixed

* Deleting a chore keeps the points already earned from it.
* Marking a chore not done asks first, so a stray tap doesn't take points back.
* The update banner no longer gets stuck behind cooking mode or shopping mode.
* Recipe ratings and steps no longer show twice.
* Foggy weather shows a cloud instead of a gray square on iPhone and iPad.
* Profile sections no longer squash on short screens.
* Contact phone numbers survive a vCard import with a photo.
* Merged contacts stay as private as the stricter copy.
* Passkeys work behind Home Assistant's ingress, and other proxies, when Home Assistant serves
  https itself.
* Going back in first-time setup keeps the people already added.
* The Cloudflare setup script runs on Windows.
* Tapping to wake the night screen no longer taps what's underneath.
* Returning to the Board when idle no longer pulls a kid out of an activity or a parent's phone
  away from what they're reading.

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
* Self-hosters can see how to delete their family's data in Settings.
* **Cloudflare Workers**: deploy with this release's `wrangler.toml`, which adds the routes for
  recipe share links and activities.
* Wall screens and kids' devices lose some write access (family settings, adding or editing
  chores, and events on other people's calendars). Parent devices are unchanged.
* The old accent and background presets are replaced by color schemes; an accent you set carries
  over.
