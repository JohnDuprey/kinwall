# Settings → General

Every device sees this tab. It has two groups of cards:

* **For the whole family**: saved on the server, so every screen and phone in the household uses them.
* **Only on this device**: saved in this browser, so other devices aren't affected. See [This device](this-display.md).

The Kinwall version ("Kinwall v…") shows at the bottom.

## For the whole family

### Household

| Setting | Notes |
|---|---|
| **Family name** | Shown in the header. Default "Our Family". Saves when you leave the field. |
| **Timezone** | The household timezone. Chores, reminders, summaries and "today" use it. If it's not set, the first device to load the app sets it from its own timezone. |
| **Week starts on** | Sunday or Monday. Applies to the Week and Month views and the weekly leaderboard. |
| **Default reminder** | *Admin only.* The reminder used for events that have none of their own: None, 5, 10, 15, 30 minutes, 1 hour or 1 day. Default 30 minutes. |

### Weather

| Setting | Notes |
|---|---|
| **Weather location** | A town or city for the forecast in [snapshots](../using/snapshot.md). **Set** / **Change** searches by name; **Remove** turns weather off. The Kinwall server does the lookup and the forecast fetch (Open-Meteo, cached for an hour), not this device. API: `location` `{ name, lat, lon, countryCode? }` or `null`. |
| **Temperature** | °F or °C, shown once a location is set. Defaults to °F for a US location (or a US timezone), °C elsewhere. API: `temperatureUnit` `fahrenheit` / `celsius`. |

### Quotes & facts

What the Board's quote card shows. The row shows what's on; **Change** opens a sheet with the choices. The card takes turns through every source that's on, changing every half hour, and every screen shows the same one. Turn everything off to hide the card. API: `tidbits` (see below).

| Source | Notes |
|---|---|
| **Quotes** | Built in: authors, scientists and storytellers. On by default. |
| **Fun facts** | Built in, for all ages. On by default. Pick categories: Animals, Space, Earth & science, Human body, Plants & food, Words, or **All**. |
| **On this day** | From Wikipedia: today's **holidays & observances**, **birthdays**, and **history**. Holidays and birthdays are on by default when you turn this on. History leaves out wars, disasters and crimes, but it's the least kid-proof of the three. Saints' feast days are left out. **Birthdays of people born** limits birthdays to people born since 1800, 1900 (the default), 1950, 1970 or 1990, or any time. Shows "From Wikipedia" on the card. |
| **Trivia question** | From [Open Trivia DB](https://opentdb.com): a multiple-choice question in one of the categories you pick (Animals, Science & nature, Geography and General knowledge by default; one category a day, taking turns), at any mix of **Easy**, **Medium** and **Hard** (Easy by default). Tap a choice to guess: the card says whether it's right and highlights the answer, and **Try again** resets it for the next person. |

On this day and trivia are off until you turn them on. Your Kinwall server fetches each once a day (they're kept with the weather cache) and screens never contact Wikipedia or Open Trivia DB themselves. Nothing about your family is sent. If they can't be reached, the built-in quotes and facts fill in.

API: `tidbits` `{ sources, factCategories, onThisDay, birthsAfter, triviaCategories, triviaDifficulties }` in `GET` / `PATCH /api/settings`, where `sources` is any of `quotes`, `facts`, `onthisday`, `trivia` (`[]` hides the card), `factCategories` any of `animals`, `space`, `science`, `body`, `plants`, `words` (`[]` = all), `onThisDay` any of `holidays`, `births`, `events`, `birthsAfter` a year or `null` for any, `triviaCategories` [Open Trivia DB category ids](https://opentdb.com/api_category.php), and `triviaDifficulties` one or more of `easy`, `medium`, `hard`. Today's online items: `GET /api/tidbits`.

### Features

*Admin only.* Turn off what your family doesn't use. It's hidden on every screen and phone; nothing is deleted, and turning it back on brings everything back as it was. Every feature is on by default.

| Switch | When it's off |
|---|---|
| **Chores & points** | No **Chores** tab, no chores card on the Board, no chores or points in a member's day and the family sheet, no **Chores** card under Settings → Family, no **Chore reminder** notification setting, and no **Sticker book** (it spends chore points). The daily summary leaves chores out and the chore reminder isn't sent. The leaderboard and sticker shop keep their own switches under **Settings → Family → Chores**. |
| **Lists** | No **Lists** tab, no **Due soon** card on the Board, no to-dos in a member's day or week, no **Tasks** in an event's detail sheet, and no **List updates** notification setting. "List updated" notifications stop, and the daily summary leaves list items out. |
| **Paint** | No **Paint** in Activities. |
| **Photos** | No **Photos** in Activities and no picture card on the Board. A display whose night screen shows **Family photos** shows nature pictures instead. |
| **Notes** | No notes on events and no **Discussion** on list items, and no note counts (💬) on events or list items. A list item's own **Notes** field still shows. |
| **Family messages** | No **Send a message** in the bell or in Settings → Access → Notifications. Messages already sent stay in the bell. `POST /api/notify` (and the MCP tool `send_notification`) answers 403. |

When every activity is off (Paint, Photos, and the Sticker book, which is off when Chores or the sticker shop is), the **Activities** tab goes too. A link to a screen that's off, such as a bookmark or an old notification, opens the calendar instead. The Board rearranges its cards so a hidden one leaves no gap.

Apart from sending messages, the API keeps answering for features that are off (like the leaderboard switch), so nothing is lost and integrations keep working.

API: `features` `{ chores, lists, paint, photos, notes, messages }` (all booleans) in `GET` / `PATCH /api/settings`. A `PATCH` sends the whole object. Display keys can't change it (403).

### Appearance

Mode, dark schedule, color scheme (including the family's own schemes), text size and density. See [Appearance](../using/appearance.md).

### Quiet hours

**Off** or **On**, with **Quiet from** and **Quiet to**. Paired wall displays show a dim clock (or a slideshow, set per display under **Night screen**) between these times. Phones are never affected. See [Quiet hours](../using/quiet-hours.md).

## Only on this device

**This display**, **Appearance on this device**, **Time cues**, **Night screen**, **Notifications** and **Troubleshooting**. See [This device](this-display.md).

Chore settings (late completion credit, streak grace, leaderboard and sticker shop) live on the **Family** tab, while **Chores & points** is on. See [Family](family.md) and [Chores](../using/chores.md).
