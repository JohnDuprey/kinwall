# Night

One family schedule, the **night hours** (once called quiet hours), and what it does overnight: wall screens rest on a dim Night screen, and reminders wait until morning. Each can be turned off on its own.

## Set it up

**Settings → General → For the whole family → Night**, tap **Change**. Under **Night hours** choose **On**, then set **Night from** and **Night to**. Turning it on starts you at 22:00 → 06:00. The window can cross midnight. The card sums it up as chips, for example "10:00 PM–6:00 AM", "Walls rest", "Reminders held" and "PIN".

The same sheet has:

* **Wall screens**: **Rest at night** (on by default), **What they show** (see [Screensaver](#screensaver)), [Google Photos](photos.md#google-photos), and the [PIN to wake](#pin-to-wake).
* **Notifications**: **Hold reminders at night** (on by default). See [Reminders at night](#reminders-at-night).

A family that had quiet hours before keeps both effects on, so nothing changes. [Dark mode](appearance.md#dark-schedule) is set apart, under Appearance, but its schedule can be **Same as night** so most families set one time.

## Walls rest at night

* It applies **only to wall screens**: paired displays (devices using a display key), and any other device with **Use as a wall screen** on under [Settings → This display](../settings/this-display.md#this-display). Other phones and parent devices are never dimmed. A parent's iPad or a kitchen laptop can be a wall screen and keep its parent access.
* During the night hours, with **Rest at night** on, the display shows the Night screen: the time on a dark screen, or the pictures picked under **What they show**. By default the clock moves around: every few minutes it fades in at a new spot, so no pixels stay lit in one place.
* **Tap the screen** to wake it (or enter the [PIN](#pin-to-wake), if the family set one). It returns to the Night screen after **five minutes** without a touch.
* With **Rest at night** off, walls stay on overnight. The [moon button](#night-screen-now) and [Home Assistant](#start-it-from-home-assistant) can still start the Night screen.
* The times are read on the display's own clock. The setting syncs to every display within about 30 seconds.

## Reminders at night

With **Hold reminders at night** on (the default), these wait until the night hours end:

* [transition reminders](notifications.md) and each screen's [time cues](../settings/this-display.md) banners,
* Live Activities on iPhone,
* the evening [low battery](battery.md) alert (it goes out that morning instead),
* the morning [last night's check-in](snapshot.md#last-nights-check-in) reminder.

These always come through, at night too: event reminders, [medicine reminders](medications.md), the evening goal check, daily summaries, chore reminders and family messages. They're at times the family picked on purpose.

Turn it off and the held ones come through at night too.

## PIN to wake

So little ones can't turn the wall on at night, a parent can set a PIN under **Settings → General → Night → PIN to wake at night** (shown while night hours and **Rest at night** are on) (4 to 8 digits, asked twice). It's off by default and only set from a parent device, never from a wall screen or a connected app.

* During the night hours, a tap on a wall screen's Night screen shows a keypad instead of waking it. That includes a parent's own device with **Use as a wall screen** on: being a parent device doesn't skip the PIN. The right PIN wakes it as usual; it goes back to sleep after five minutes without a touch, and asks again.
* A wrong PIN says "Try again". After 5 wrong tries in a row the keypad waits a minute, then longer after each further wrong try (up to 30 minutes). The server also allows only 5 wrong tries per 15 minutes from each screen, so one screen guessing doesn't lock the others out, and 30 for the whole family across every screen, so even a 4-digit PIN would take days to guess. Past that every screen waits, a parent's device too (or set a new PIN, which ends the wait). The right PIN never counts.
* The keypad hides after 30 seconds without a touch. If the server can't be reached, the screen stays asleep.
* Outside the night hours there's no PIN. The Night screen button and **Preview screensaver** never ask for it either, unless it's night and the screen has already gone back to sleep.
* **Forgot it?** Remove it under **More… → Remove PIN** on any parent device.
* Only a salted hash of the PIN is stored, and it isn't in the [export](../your-data/export-import.md): set it again after a restore. See [Privacy](../your-data/privacy.md).

## Night screen now

Wall screens have a moon button in the header, next to the bell and help. Tap it to show the Night screen right away, at any time of day, with this screen's Night screen settings (its own, or the family's). It stays on, and keeps the screen awake, until you tap the screen or press a key, then shows today's calendar. Unlike **Preview screensaver**, it doesn't end on its own.

## Start it from Home Assistant

Home Assistant (or a parent's device, or a connected app) can start the Night screen on every wall screen, or on chosen paired displays, and end it again. For example: start it when nobody's home, wake the walls when someone gets back. The [Home Assistant integration](../integrations/home-assistant.md) has a `kinwall.night_screen` action, a switch per wall screen and a ready-made blueprint for this.

* **On** works like the moon button: each wall uses its Night screen settings (its own, or the family's), and the screen stays awake. Walls pick it up within 30 seconds.
* **Off** ends it. While it's on, walls check every 10 seconds, so they wake within about 10 seconds of someone getting home. During the night hours a wall follows them as usual.
* **A tap still wakes a wall**, the same as always (the [PIN](#pin-to-wake) only during the night hours). It stays awake even though the remote Night screen is still on. It goes back to the Night screen only on the next remote change (off then on, or a new "on"), or at night hours.
* **It runs out on its own** after 12 hours (or the `hours` sent), so a forgotten "on" can't keep the walls dark for days.
* Wall screens that use a parent's sign-in (**Use as a wall screen** on) follow the "every wall screen" setting only; a single screen can be picked only if it's a paired display.
* Only parent devices, admin keys and connected apps can start or end it. Wall screens and kids' devices can't.

API: `POST /api/displays/night-screen` and `GET /api/displays/night-screen`, see the [REST API](../integrations/rest-api.md#night-screen). MCP: `set_night_screen`. Webhook: `display.night_screen`.

## Screensaver

Instead of the bare clock, wall screens can show a slow, dim slideshow overnight. A parent sets it for the whole family: **Settings → General → For the whole family**, tap **Change** under **Night**, then **What they show**. A screen can pick its own instead under **Only on this device → Night screen on this device** (**Night screen: This screen's own**); otherwise every screen follows the family's choice. Turn on one or more sources. With more than one on, the pictures take turns (drawing, then family photo, then art, then nature, and so on). **Clock only** (the default) turns them all off.

* **Drawings**: pictures from this display's own [Paint gallery](activities.md#my-drawings), shuffled. If there are none yet, the display skips drawings (or shows the clock if drawings is the only source).
* **Family photos**: your family's [photos](photos.md), shuffled, with their captions. They come from your own Kinwall server.
* **Google Photos** (not available yet; see [Google Photos](photos.md#google-photos)): albums a parent picked in Google Photos, shuffled. Shown once a parent has [connected Google Photos](photos.md#google-photos) (in the Night sheet) and picked albums. The pictures come through your Kinwall server, sized for this screen.
* **Art (The Met)**: public-domain highlight paintings from [The Metropolitan Museum of Art](https://metmuseum.github.io/) open-access collection (CC0), with the title, artist and date in the corner.
* **Nature**: photos from [Lorem Picsum](https://picsum.photos), which serves free-to-use [Unsplash](https://unsplash.com) photos.

Options once any source is on:

* **Change picture every** 2, 5 (default), 10 or 20 minutes. Pictures crossfade; with reduced motion turned on they switch without a fade.
* **Brightness**: **Low** (default) or **Medium**. It's a night mode, so pictures are always dimmed, never full brightness.
* **Show clock**: a small time and date. When it moves around it keeps to the corners, and the picture shifts slightly, so nothing stays lit in one place.

## Clock position

**Clock position**, in the same sheet, sets where the clock sits: the big clock, and the small one over a slideshow.

* **Moves around** (the default): every few minutes the clock fades in at a new spot, never the same one twice in a row. Over a slideshow it keeps to the corners. This protects OLED and LCD screens from burn-in. With reduced motion or [low-stimulation mode](appearance.md#per-device-overrides) on, it jumps without the fade.
* **Center**, **Top left**, **Top right**, **Bottom left** or **Bottom right**: the clock stays put.

The clock stays fully on screen at any size and in either orientation.

Tapping wakes the display as usual. **Preview screensaver** shows the Night screen for 20 seconds on whatever device you're using, so you can check it from a phone; tap or press Escape to end it early.

**Privacy:** Art and Nature are off by default. When chosen, the display fetches pictures **directly** from that service (no Kinwall server in between), so the service sees the display's IP address. Nature makes one request per picture. Art fetches the list of highlight paintings once a night, then looks up one artwork and loads its image per change. Nothing about your household is sent. Drawings never leave the device, and family photos come only from your Kinwall server. Google Photos pictures come through your Kinwall server too, so Google sees your server, not the display (see [Privacy](../your-data/privacy.md#google-photos)). If Google Photos needs reconnecting, has no photos or can't be reached, the display shows its other picks meanwhile (nature pictures if Google Photos is the only one). If a service can't be reached, the display skips it for that change and uses the next source. If none can be used, it quietly shows the clock and tries again at the next change.

## API

The night hours are `quietFrom` / `quietTo` (`HH:MM`) in `GET` / `PATCH /api/settings`, as before, so Home Assistant, the app and existing scripts keep working. Send both, set or cleared together (`""` or `null` turns the night hours off). `nightRest` and `nightHoldReminders` (booleans, `true` unless turned off) are the two effects; `darkWithNight` makes the [dark schedule](appearance.md#dark-schedule) use the night hours (`darkFrom` / `darkTo` then read as them). `nightLook` is what wall screens show. The PIN: `PUT /api/quiet-pin` and `DELETE /api/quiet-pin` from a parent device, `POST /api/quiet-pin/verify` from a wall screen; `settings.quietPin` is `true` while one is set. See the [REST API](../integrations/rest-api.md) and [General](../settings/general.md#night).
