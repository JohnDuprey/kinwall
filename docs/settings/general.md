# Settings → General

Parent devices see both groups of cards below. Wall screens and kids' devices see only **Only on this device**: the family settings are for parents, so a device can't change the family name, timezone, weather, quote sources, appearance or night (it can still pick its own look under **Appearance on this device**, and add a new color scheme there, which is saved to the family's list).

* **For the whole family**: saved on the server, so every screen and phone in the household uses them.
* **Only on this device**: saved in this browser, so other devices aren't affected. See [This device](this-display.md).

The Kinwall version ("Kinwall v…") shows at the bottom.

## For the whole family

### Household

| Setting | Notes |
|---|---|
| **Family name** | Shown in the header. Default "Our Family". Saves when you leave the field. |
| **Timezone** | The household timezone. Chores, reminders, summaries and "today" use it. If it's not set, the first device to load the app sets it from its own timezone. Every screen shows its clock in this timezone; a device can show its own instead under [Appearance on this device](this-display.md#appearance-on-this-device). Clocks change right on the minute. Tap it to choose from a list: this device's timezone and the current one come first, each row shows the time there and its UTC offset ("8:04 PM · UTC−4"), and the search finds a city or region ("New York", "America/New_York"). |
| **Week starts on** | Sunday or Monday. Applies to the Week and Month views and the weekly leaderboard. |
| **Time format** | **Automatic** (the default), **12-hour (3:40 PM)** or **24-hour (15:40)**. Every clock time in the app follows it: the Board's clock, the calendar's hour labels and events, Now / Next, meals, medicines, the night screen and leave-by times. Automatic uses each device's language and region, and a device can pick its own under [Appearance on this device](this-display.md#appearance-on-this-device). Notifications and Live Activity headlines the server writes use this setting too; on Automatic they go by the weather location's country (12-hour in the US, Canada, Australia, New Zealand, the Philippines, India, Pakistan, Bangladesh, Egypt, Saudi Arabia and Malaysia, 24-hour everywhere else) and stay 12-hour with no location. Time fields you type into (night hours, meal times) use the device's own clock style, which the browser decides. API: `timeFormat` `auto` / `12` / `24`. |
| **Default reminder** | *Admin only.* The reminder used for events that have none of their own: None, 5, 10, 15, 30 minutes, 1 hour or 1 day. Default 30 minutes. |

### Weather

| Setting | Notes |
|---|---|
| **Weather location** | A town or city for the forecast in [snapshots](../using/snapshot.md). **Set** / **Change** searches by name; **Remove** turns weather off. The Kinwall server does the lookup and the forecast fetch (Open-Meteo, cached for an hour), not this device. API: `location` `{ name, lat, lon, countryCode? }` or `null`. |
| **Temperature** | °F or °C, shown once a location is set. Defaults to °F for a US location (or a US timezone), °C elsewhere. API: `temperatureUnit` `fahrenheit` / `celsius`. |

### Quotes & facts

What the Board's quote card shows. The row shows what's on; **Change** opens a sheet with the choices. The card takes turns through every source that's on, changing every half hour, and every screen on the family's choice shows the same one. Turn everything off to hide the card. A screen can show its own picks, or several cards, instead: see [This display → Board quotes & facts](this-display.md#this-display). API: `tidbits` (see below).

| Source | Notes |
|---|---|
| **Quotes** | Built in: authors, scientists and storytellers. On by default. |
| **Fun facts** | Built in, for all ages. On by default. Pick categories: Animals, Space, Earth & science, Human body, Plants & food, Words, or **All**. |
| **Neurodivergent-friendly tips** | Built in: small, practical ideas that help neurodivergent kids and grown-ups, and everyone else too. Off by default. Pick categories: Routines, Focus, Getting organized, Feelings, Sensory, Communication, or **All**. Shows as **🌱 Try this**. |
| **On this day** | From Wikipedia: today's **holidays & observances**, **birthdays**, and **history**. Holidays and birthdays are on by default when you turn this on. History leaves out wars, disasters and crimes, but it's the least kid-proof of the three. Saints' feast days are left out. **Birthdays of people born** limits birthdays to people born since 1800, 1900 (the default), 1950, 1970 or 1990, or any time. Shows "From Wikipedia" on the card. |
| **Trivia question** | From [Open Trivia DB](https://opentdb.com): a multiple-choice question in one of the categories you pick (Animals, Science & nature, Geography and General knowledge by default; one category a day, taking turns), at any mix of **Easy**, **Medium** and **Hard** (Easy by default). Tap a choice to guess: the card says whether it's right and highlights the answer, and **Try again** resets it for the next person. |

On this day and trivia are off until you turn them on. Your Kinwall server fetches each once a day (they're kept with the weather cache) and screens never contact Wikipedia or Open Trivia DB themselves. Nothing about your family is sent. If they can't be reached, the built-in quotes and facts fill in.

API: `tidbits` `{ sources, factCategories, tipCategories, onThisDay, birthsAfter, triviaCategories, triviaDifficulties }` in `GET` / `PATCH /api/settings`, where `sources` is any of `quotes`, `facts`, `tips`, `onthisday`, `trivia` (`[]` hides the card), `factCategories` any of `animals`, `space`, `science`, `body`, `plants`, `words` (`[]` = all), `tipCategories` any of `routines`, `focus`, `organizing`, `feelings`, `sensory`, `communication` (`[]` = all), `onThisDay` any of `holidays`, `births`, `events`, `birthsAfter` a year or `null` for any, `triviaCategories` [Open Trivia DB category ids](https://opentdb.com/api_category.php), and `triviaDifficulties` one or more of `easy`, `medium`, `hard`. Today's online items: `GET /api/tidbits`, for the family's choice. A screen with its own picks adds them as query params, each a comma-separated list that replaces the family's value for that field: `sources`, `onThisDay`, `birthsAfter` (a year or `any`), `triviaCategories` and `triviaDifficulties`, for example `GET /api/tidbits?sources=trivia&triviaCategories=17,27&triviaDifficulties=easy`. An unknown value is a `400`. Each source is still fetched at most once a day per choice.

### Board presets

Board layouts for the family: which cards, in which columns, how tall and how big their text is. Every screen can pick one under [This display → Board layout](this-display.md#this-display), next to the built-in **Kids**, **Kitchen**, **Parents** and **Simple**. **Add a preset** opens the [layout editor](../using/calendar.md#board-layouts) with a name; **Edit** changes one, and **Delete this preset** is at the bottom of its editor. Screens using a deleted preset go back to the family wall layout. Up to 10, on parent devices only.

API: `boardPresets` in `GET` / `PATCH /api/settings`, the whole list, each `{ id, name, layout }` with `id` `p_` and up to 40 lowercase letters, digits, `_` or `-`, `name` 1 to 40 characters, and `layout` `{ tiles, columns }`: `tiles` a boolean (the count tiles across the top) and `columns` 1 to 4 lists of up to 6 cards, each `{ id, size, density }`. `id` is `clock`, `today`, `meals`, `photo`, `coming`, `due`, `chores`, `tidbit`, `tidbit2` or `tidbit3` (each once), `size` `s`, `m` or `l`, and `density` `big`, `normal` or `small`. A display key gets 403.

### Features

*Admin only.* The card shows how many are on ("All 11 on", or "8 of 11 on" with the ones that are off); tap **Change** under **Features** for the switches. Turn off what your family doesn't use. It's hidden on every screen and phone; nothing is deleted, and turning it back on brings everything back as it was. Every feature is on by default.

| Switch | When it's off |
|---|---|
| **Chores & points** | No **Chores** tab, no chores card on the Board, no chores or points in a member's day and the family sheet, no **Chores** card under Settings → Family, no **Chore reminder** notification setting, and no **Rewards** or **Sticker book** (they spend chore points). The daily summary leaves chores out and the chore reminder isn't sent. The leaderboard and sticker shop keep their own switches under **Settings → Family → Chores**. |
| **Lists** | No **Lists** tab, no **Due soon** card on the Board, no to-dos in a member's day or week, no **Tasks** in an event's detail sheet, and no **List updates** notification setting. "List updated" notifications stop, and the daily summary leaves list items out. |
| **Contacts** | No **Contacts** tab. Contacts stay saved, and the contacts API keeps answering. |
| **Paint** | No **Paint** in Activities. |
| **Photos** | No **Photos** in Activities and no picture card on the Board. A display whose night screen shows **Family photos** shows nature pictures instead. |
| **Notes** | No notes on events and no **Discussion** on list items, and no note counts (💬) on events or list items. A list item's own **Notes** field still shows. |
| **Meals** | No **Meals** tab and no **Today's meals** card on the Board, no meals in a member's day, and the daily summary leaves meals out. |
| **Trackers: Reading** | No **Reading** in Trackers and no reading line in a member's day. |
| **Trackers: Memories** | No **Memories** in Trackers. |
| **Trackers: Health** | No **Health** in Trackers, and no [medication reminders](../using/medications.md) (they're part of it). (Health is never on a wall display anyway.) |
| **Medication reminders** (under Health, off by default) | Medicines in Trackers → Health, their reminders and Take now cards. Turning it on first shows what Kinwall keeps and who sees it. Off hides them everywhere; what's saved is kept. |
| **Family messages** | No **Send a message** in the bell or in Settings → Access → Notifications. Messages already sent stay in the bell. `POST /api/notify` (and the MCP tool `send_notification`) answers 403. |

When every activity is off (Paint, Photos, and the Sticker book, which is off when Chores or the sticker shop is), the **Activities** tab goes too, and the **Trackers** tab goes when Reading, Memories and Health are all off. A link to a screen that's off, such as a bookmark or an old notification, opens the calendar instead. The Board rearranges its cards so a hidden one leaves no gap.

Apart from sending messages, the API keeps answering for features that are off (like the leaderboard switch), so nothing is lost and integrations keep working.

API: `features` `{ chores, lists, contacts, paint, photos, notes, messages, trackersReading, trackersMemories, trackersHealth, meals }` (all booleans) in `GET` / `PATCH /api/settings`. Medication reminders are `medications` and `medicationNamesOnWalls` in the same settings; `medications` reads `false` while `trackersHealth` is off, and a connected app gets 403 changing either. A `PATCH` sends the whole object (older clients may leave out contacts, tracker and meals switches; they then read as on). Display keys can't change it (403).

### Appearance

Mode (Auto, following each device's system setting, until the family picks one), dark schedule (its own times, or **Same as night**), color scheme (including the family's own schemes), typeface, text size and density. See [Appearance](../using/appearance.md).

### Night

One card for the family's night: the **night hours** and what they do. The card sums it up as chips, for example "10:00 PM–6:00 AM", "Walls rest", "Reminders held" and "PIN" (or "Night hours off"); tap **Change** to set it. See [Night](../using/night.md).

* **Night hours**: **Off** or **On**, with **Night from** and **Night to** (once called quiet hours).
* **Wall screens**:
  * **Rest at night** (on by default, shown while night hours are on): wall screens (paired displays, and devices with **Use as a wall screen** on) show the Night screen during the night hours. Other devices are never affected.
  * **What they show**: **Clock only** (the default), or a slideshow of **Drawings** (each screen's own), **Family photos**, **Google Photos** (once connected), **Art (The Met)** and **Nature**, with **Change picture every**, **Brightness** and **Show clock**. **Clock position**: **Moves around** (the default, against burn-in) or a fixed spot. Also used when the Night screen is started from the moon button or Home Assistant. See [Screensaver](../using/night.md#screensaver).
  * **Google Photos**: connect it here for the whole family: **Connect Google Photos**, then **Choose albums in Google Photos** (a link, with a QR code on bigger screens), **Change albums** and **Disconnect Google Photos**. While connecting it goes to Google's sign-in (a wall screen shows a QR code to sign in on a phone instead), or with a TV client shows the code to enter at `google.com/device`, then "Waiting for you to choose albums…". If Google won't allow Photos with the server's Google app, it says so. If Google stops sharing, it shows **Reconnect Google Photos**. After Google's sign-in, Kinwall comes back to this sheet. See [Google Photos](../using/photos.md#google-photos).
  * **PIN to wake at night** (off by default, shown while night hours and **Rest at night** are on): **Set PIN** asks for 4 to 8 digits twice. Then a wall screen asks for it before waking during the night hours. **Change PIN** replaces it; **More… → Remove PIN** turns it off, and is the way out of a forgotten PIN from any parent device. See [PIN to wake](../using/night.md#pin-to-wake).
* **Notifications**: **Hold reminders at night** (on by default, shown while night hours are on). The sheet lists what waits until morning (transition reminders, time cues, Live Activities, low battery alerts, the morning check-in reminder) and what always comes through (event and medicine reminders, the evening goal check, daily summaries, messages). See [Reminders at night](../using/night.md#reminders-at-night).

A family that had quiet hours before keeps **Rest at night** and **Hold reminders at night** on, so nothing changes. Dark mode stays under [Appearance](#appearance), with **Dark hours: Same as night** to use these hours.

Each screen follows this unless it picks its own under [Night screen on this device](this-display.md#night-screen-on-this-device).

API: the night hours are `quietFrom` / `quietTo`, the two effects `nightRest` and `nightHoldReminders` (booleans, `true` unless turned off), and what walls show is `nightLook` `{ sources, every, brightness, clock, clockPosition }`, all in `GET` / `PATCH /api/settings`. In `nightLook`, `sources` from `drawings`, `photos`, `google`, `art`, `nature` (each once; empty = the plain clock), `every` 2, 5, 10 or 20 (minutes), `brightness` `low` or `medium`, `clock` a boolean, `clockPosition` `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right` or `null` (moves around). A `PATCH` sends the whole object. Display keys can't change it (403). It's part of the [export](../your-data/export-import.md).

## Only on this device

**This display**, **Appearance on this device**, **Time cues**, **Night screen on this device**, **Notifications** and **Troubleshooting**. Appearance on this device, Time cues and Night screen on this device show a one-line summary; tap **Change** under one to open its settings. **Keep the screen on** and **Back to the calendar when idle** are under **This display**. See [This device](this-display.md).

Chore settings (late completion credit, streak grace, daily check-in points, leaderboard, sticker shop and sticker prices) live on the **Family** tab, on parent devices, while **Chores & points** is on. See [Family](family.md) and [Chores](../using/chores.md).
