# Settings → General → Only on this device

The second group of cards on **Settings → General**. Everything here applies to **this device only** and is stored in the browser, not on the server. It isn't in exports.

## This display

What this screen shows, how you get around it, and whether it stays on and resets itself.

| Item | Notes |
|---|---|
| **Paired as *name*** | Shown on paired displays. |
| **Show only** | Pin this screen to one member, which is handy for a display in a bedroom. On a display an admin paired, this follows **What is this device?** and reads "Set by a parent": change it under [Access → Paired devices](access.md#paired-devices). Displays paired before that option existed pick a member, or **Everyone**, here. |
| **Also show things for everyone** | Only shown once a member is picked. On (default): shared events, chores and lists (nobody assigned) still show alongside that member's own. Off: only their items. |
| **Lock view** | Fixes the calendar to one view (Board, Day, Week/3 Day, Month, Schedule) and hides the view switcher, so a pinned display can't be bumped into a different view. **Off** leaves the switcher free. |
| **Board quotes & facts** | **Family's choice** (the default) shows the family's quote card from [Quotes & facts](general.md#quotes--facts). **Own picks** gives this screen up to 3 cards of its own, each with its own sources and categories (the same choices as the family's sheet), for example a **Trivia** card in Science & nature and Animals at Easy, a **Tips** card for focus and routines, and an **On this day** card. Each card has a **Change** button; **Add a card** adds another, and **Remove this card** is at the bottom of its sheet. A card with everything off is hidden. Only this screen changes. A phone, or a tablet on its side, shows the first card. |
| **Board layout** | **Family wall (default)** fits the cards to the screen by itself. **Kids**, **Kitchen**, **Parents** and **Simple** are built-in layouts, the family's [Board presets](general.md#board-presets) are marked 🏠, and **Own layout** opens the [layout editor](../using/calendar.md#board-layouts) for this screen alone (kept on this device; **Edit this screen's layout** changes it later). |
| **Board chores & to-dos** | **Auto**, **Counts** or **Full lists**: whether the [Board](../using/calendar.md#board-view) shows chores and to-dos as count tiles or as the full Chores today and Due soon cards. **Auto** shows the full cards only on a big screen. Only for the family wall layout: a layout shows Chores today and Due soon when it has them, and their tiles when it doesn't. |
| **Use as a wall screen** | Not shown on paired displays (wall screens and kids' devices), which always act as wall screens, so a kid can't switch the Night screen off. Off by default; a device paired as a wall screen turns it on by itself. On: this device acts like a wall screen. It stays awake, returns to the calendar when idle, and shows the [Night screen](#night-screen) during [quiet hours](../using/quiet-hours.md), dimming the same way a paired display does. It doesn't change what the device can do: a parent's device keeps parent access. Works on any device, phones included, for an old phone or tablet mounted on the wall. |
| **Navigation position** | **Auto**, **Bottom**, **Left** or **Right**: where the tab buttons (Calendar, Chores, Lists, Meals, Trackers, Activities, Settings; fewer if some are turned off) sit, as a bottom tab bar or a side rail. Phones use the bottom bar, and a slim rail down the left side when turned sideways. |
| **Keep the screen on** | Stops the screen from dimming and locking while Kinwall is open. On by default on wall screens (including devices with **Use as a wall screen** on) and kids' devices, off on parents' phones and computers, which lock as usual. Shopping mode and an open recipe keep the screen on either way. On iPad walls, also set Auto-Lock to Never. |
| **Add a Quick Settings tile** | Only in the Kinwall app for Android 13 and later. A tile is a button in the panel you swipe down from the top of the screen. **Add to Groceries** (with Lists on) opens Kinwall ready to add to the Groceries list; **Night screen** starts the [Night screen](#night-screen). Android asks before adding it. |
| **Back to the calendar when idle** | After 2 minutes without a tap, this screen closes what's open and shows today's calendar, but never while an activity (Paint, the sticker book or an added activity) is open. On by default on wall screens (including devices with **Use as a wall screen** on) and kids' devices, off on parents' phones and computers. |

A paired wall display also locks its own viewport (no pinch-zoom), so it can't be zoomed by a stray touch.

On a phone's bottom bar, only the first four tabs get their own button; the rest sit under a **More** button (⋯) that opens a menu listing them.

## Appearance on this device

The card shows this device's look as chips, one per setting (for example "🌊 Ocean", "Aa Medium", "Compact", "🔤 Hyperlegible"). A chip marked 🏠 follows the family's setting. Tap **Change** under **Appearance on this device** for the settings: Mode, Color scheme, Text size, Density, Typeface and Time format, each starting on **Household** to follow the family's setting, plus **Low-stimulation mode**. Time format is **Use the family's**, **12-hour (3:40 PM)** or **24-hour (15:40)**, and its chip (for example "🏠 🕒 12-hour") shows the format in effect. Typeface opens a sheet with a sample line in each typeface and **Use the family's typeface** first. Color scheme opens the same sheet as the family setting, with **Use the family's scheme** first, the same schemes (including the family's own and **＋ New scheme**), and **Reset this device's appearance** at the bottom to go back to the family's look. See [Appearance](../using/appearance.md#per-device-overrides).

## Time cues

The card shows the cues that are on as chips (for example "Now / Next", "At 10 min", "Every 1 min in the last 5", "Sound"). Tap **Change** under **Time cues** for these:

| Item | Notes |
|---|---|
| **Now / Next** | On by default. What's on now and what's next today, with a countdown, above the calendar on every view. On a wall display it hides when nothing is left today. On a phone it's a fixed two-line strip that reads "Nothing more today" when the day is done, so the screen never jumps. Once the next event (or its leave-by) is inside this display's earliest **Transition warning**, the Next row lights up in the accent color, and a screen reader counts down from then (10 minutes when no warnings are set). |
| **Transition warnings** | A calm banner before the next event, or before it's time to leave, such as "Soccer practice in 10 minutes" or "Leave for Soccer practice in 5 minutes". Tap **10 min**, **5 min** or **1 min**, or **Add…** your own time (1 to 120 minutes before; up to 8 times in all). Tap a time you added to remove it. **Repeat as it gets close** adds a warning every few minutes near the end, for example every minute during the last 5, on top of the times you picked. Times the repeat already covers are grayed out. **Off** clears them all. With any warning set, a **Sound** toggle adds a soft chime. Never shows during quiet hours. |

Everyone handles switching activities differently, so these are per device: a bedroom tablet can count down every minute while the kitchen wall only warns at 10 and 5. For warnings that follow a person to their own phone or tablet, see [Transition reminders](family.md#transition-reminders).

## Night screen

The card shows the choices as chips: **Clock only**, or the slideshow's pictures, how often they change and the clock (for example "Drawings", "Nature", "Every 5 min", "Clock on"); tap **Change** under **Night screen** to set it. What this display shows during the household's [quiet hours](../using/quiet-hours.md): **Clock only**, or a slideshow of **Drawings**, **Family photos**, **Google Photos** (once it's connected), **Art (The Met)** and **Nature**, with how often the picture changes, brightness and a corner clock. **Clock position** is **Moves around** (the default, which protects the screen from burn-in) or a fixed spot: **Center** or a corner. **Preview screensaver** shows it for 20 seconds. The Night screen shows on its own only on wall screens: paired displays, and devices with **Use as a wall screen** on. Wall screens also get a moon button in the header, next to the bell and help, that starts the Night screen right away with these settings and keeps it on until a tap or key press. Home Assistant can start and end it the same way: see [Start it from Home Assistant](../using/quiet-hours.md#start-it-from-home-assistant).

On a parent device, the bottom of the sheet connects **Google Photos** for the whole family: **Connect Google Photos**, then **Choose albums in Google Photos** (a link, with a QR code on bigger screens), **Change albums** and **Disconnect Google Photos**. While connecting it goes to Google's sign-in (a wall screen shows a QR code to sign in on a phone instead), or with a TV client shows the code to enter at `google.com/device`, then "Waiting for you to choose albums…". If Google won't allow Photos with the server's Google app, it says so. If Google stops sharing, parents see **Reconnect Google Photos** here. Wall screens and kids' devices don't see this part. See [Google Photos](../using/photos.md#google-photos).

## Notifications

This device's push notifications: **Turn on notifications**, **Event reminders**, **Daily summary**, **Chore reminder**, **List updates**, **Show medicine names in notifications on this device** (with [medications](../using/medications.md) on; off by default, so reminders say only "Time for Leo's medicine"), **Which family members?**, **Send test** and **Turn off**. See [Notifications](../using/notifications.md).

In the Kinwall phone app this section instead says how the app's own reminders work, whether countdowns are on (Live Activities on iPhone, ongoing notifications on Android), and, with medications on, **Show medicine names on this device** for the medicine countdown (off by default). In the Android app, with medications on, **Let medicine reminders through Do Not Disturb** opens Android's settings for Kinwall's Medicine notifications, where you turn on **Override Do Not Disturb** (see [Medications → Reminders](../using/medications.md#reminders)).

## Troubleshooting

| Item | Notes |
|---|---|
| **Clear cache and reload** | "Loads the latest version of Kinwall if this device seems stuck on an old one. You stay signed in." It clears caches, asks the service worker to update (without removing it, since push depends on it) and reloads from the network. |
| **Unpair this display** | On displays. Removes the key from this device. You'll need to pair it again from an admin device. |

## What a display sees in Settings

A device with a display key gets two tabs:

* **General**: only **Only on this device**. The family settings are for parent devices.
* **Family**: Members (read-only), Categories and, with Meals on, the usual meal times (read-only). Chore settings are for parent devices.

**Calendars** and **Access** are never shown to a display, not even briefly. Settings shows the display view until the server confirms the device is an admin.
