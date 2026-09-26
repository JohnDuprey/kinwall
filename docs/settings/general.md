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

### Appearance

Mode, dark schedule, color scheme (including the family's own schemes), text size and density. See [Appearance](../using/appearance.md).

### Quiet hours

**Off** or **On**, with **Quiet from** and **Quiet to**. Paired wall displays show a dim clock (or a slideshow, set per display under **Night screen**) between these times. Phones are never affected. See [Quiet hours](../using/quiet-hours.md).

## Only on this device

**This display**, **Appearance on this device**, **Time cues**, **Night screen**, **Notifications** and **Troubleshooting**. See [This device](this-display.md).

Chore settings (late completion credit, streak grace, leaderboard and sticker shop) live on the **Family** tab. See [Family](family.md) and [Chores](../using/chores.md).
