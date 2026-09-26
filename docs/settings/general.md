# Settings → General

Every device sees this tab. The Kinwall version ("Kinwall v…") shows at the bottom.

## Household

| Setting | Notes |
|---|---|
| **Family name** | Shown in the header. Default "Our Family". Saves when you leave the field. |
| **Timezone** | The household timezone. Chores, reminders, summaries and "today" use it. If it's not set, the first device to load the app sets it from its own timezone. |
| **Week starts on** | Sunday or Monday. Applies to the Week and Month views and the weekly leaderboard. |
| **Weather location** | A town or city for the forecast in [snapshots](../using/snapshot.md). **Set** / **Change** searches by name; **Remove** turns weather off. The Kinwall server does the lookup and the forecast fetch (Open-Meteo, cached for an hour), not this device. API: `location` `{ name, lat, lon, countryCode? }` or `null`. |
| **Temperature** | °F or °C, shown once a location is set. Defaults to °F for a US location (or a US timezone), °C elsewhere. API: `temperatureUnit` `fahrenheit` / `celsius`. |
| **Default reminder** | *Admin only.* The reminder used for events that have none of their own: None, 5, 10, 15, 30 minutes, 1 hour or 1 day. Default 30 minutes. |

## Appearance

Mode, dark schedule, color scheme, custom colors, text size, density and **Quiet hours (displays)**. See [Appearance](../using/appearance.md) and [Quiet hours](../using/quiet-hours.md).

## Notifications

This device's push notifications: **Turn on notifications**, **Event reminders**, **Daily summary**, **Chore reminder**, **List updates**, **Which family members?**, **Send test** and **Turn off**. See [Notifications](../using/notifications.md).

## This display

Per-device appearance, navigation position, **Clear cache and reload**, and (on displays) **Unpair this display**. See [This display](this-display.md).

Chore settings (late completion credit, streak grace, leaderboard and sticker shop) live on the **Family** tab. See [Family](family.md) and [Chores](../using/chores.md).
