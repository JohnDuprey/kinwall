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
| **On this day** | From Wikipedia: today's **holidays & observances**, **birthdays**, and **history**. Holidays and birthdays are on by default when you turn this on. History leaves out wars, disasters and crimes, but it's the least kid-proof of the three. Saints' feast days are left out. Shows "From Wikipedia" on the card. |
| **Trivia question** | From [Open Trivia DB](https://opentdb.com): a multiple-choice question in one of the categories you pick (Animals, Science & nature, Geography and General knowledge by default; one category a day, taking turns), at **Easy**, **Medium**, **Hard** or **Mixed** difficulty. The answer is highlighted for the second half of its half hour, or when someone taps **Show the answer**. |

On this day and trivia are off until you turn them on. Your Kinwall server fetches each once a day (they're kept with the weather cache) and screens never contact Wikipedia or Open Trivia DB themselves. Nothing about your family is sent. If they can't be reached, the built-in quotes and facts fill in.

API: `tidbits` `{ sources, factCategories, onThisDay, triviaCategories, triviaDifficulty }` in `GET` / `PATCH /api/settings`, where `sources` is any of `quotes`, `facts`, `onthisday`, `trivia` (`[]` hides the card), `factCategories` any of `animals`, `space`, `science`, `body`, `plants`, `words` (`[]` = all), `onThisDay` any of `holidays`, `births`, `events`, and `triviaCategories` [Open Trivia DB category ids](https://opentdb.com/api_category.php). Today's online items: `GET /api/tidbits`.

### Appearance

Mode, dark schedule, color scheme (including the family's own schemes), text size and density. See [Appearance](../using/appearance.md).

### Quiet hours

**Off** or **On**, with **Quiet from** and **Quiet to**. Paired wall displays show a dim clock (or a slideshow, set per display under **Night screen**) between these times. Phones are never affected. See [Quiet hours](../using/quiet-hours.md).

## Only on this device

**This display**, **Appearance on this device**, **Time cues**, **Night screen**, **Notifications** and **Troubleshooting**. See [This device](this-display.md).

Chore settings (late completion credit, streak grace, leaderboard and sticker shop) live on the **Family** tab. See [Family](family.md) and [Chores](../using/chores.md).
