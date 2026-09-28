# Settings → General → Only on this device

The second group of cards on **Settings → General**. Everything here applies to **this device only** and is stored in the browser, not on the server. It isn't in exports.

## This display

What this screen shows and how you get around it.

| Item | Notes |
|---|---|
| **Paired as *name*** | Shown on paired displays. |
| **Show only** | Pin this screen to one member, which is handy for a display in a bedroom. On a display an admin paired, this follows **Who uses it** and reads "Set by a parent": change it under [Access → Wall screens & kids' devices](access.md). Displays paired before that option existed pick a member, or **Everyone**, here. |
| **Also show things for everyone** | Only shown once a member is picked. On (default): shared events, chores and lists (nobody assigned) still show alongside that member's own. Off: only their items. |
| **Lock view** | Fixes the calendar to one view (Board, Day, Week/3 Day, Month, Schedule) and hides the view switcher, so a pinned display can't be bumped into a different view. **Off** leaves the switcher free. |
| **Navigation position** | **Auto**, **Bottom**, **Left** or **Right**: where the tab buttons (Calendar, Chores, Lists, Meals, Trackers, Activities, Settings; fewer if some are turned off) sit, as a bottom tab bar or a side rail. Phones use the bottom bar, and a slim rail down the left side when turned sideways. |

A paired wall display also locks its own viewport (no pinch-zoom), so it can't be zoomed by a stray touch.

On a phone's bottom bar, only the first four tabs get their own button; the rest sit under a **More** button (⋯) that opens a menu listing them.

## Appearance on this device

The card reads **Following the family**, or lists what this device overrides (for example "Midnight · text L · dark mode"). Tap **Change** under **Appearance on this device** for the settings: Mode, Color scheme, Text size and Density, each starting on **Household** to follow the family's setting, plus **Typeface** and **Low-stimulation mode**. Color scheme has a **Household · *scheme*** chip, the same schemes as the family setting (including the family's own and **+ New scheme**), and **Use household colors** to go back to the family's. See [Appearance](../using/appearance.md#per-device-overrides).

## Time cues

The card lists the cues that are on (for example "Now / Next on · warnings at 10 min, plus every 1 min in the last 5 · back to the calendar when idle"). Tap **Change** under **Time cues** for these:

| Item | Notes |
|---|---|
| **Keep the screen on** | Stops the screen from dimming and locking while Kinwall is open. On by default on wall screens and kids' devices, off on parents' phones and computers, which lock as usual. Shopping mode keeps the screen on either way. On iPad walls, also set Auto-Lock to Never. |
| **Back to the calendar when idle** | After 2 minutes without a tap, closes what's open and shows today's calendar, but never while an activity (Paint, the sticker book or an added activity) is open. On by default on wall screens and kids' devices, off on parents' phones and computers. |
| **Now / Next** | On by default. What's on now and what's next today, with a countdown, above the calendar on every view. On a wall display it hides when nothing is left today. On a phone it's a fixed two-line strip that reads "Nothing more today" when the day is done, so the screen never jumps. |
| **Transition warnings** | A calm banner before the next event (or its leave-by time), such as "Soccer practice in 10 minutes" or "Leave for Soccer practice in 5 minutes". Tap **10 min**, **5 min** or **1 min**, or **Add…** your own time (1 to 120 minutes before; up to 8 times in all). Tap a time you added to remove it. **Repeat as it gets close** adds a warning every few minutes near the end, for example every minute during the last 5, on top of the times you picked. Times the repeat already covers are grayed out. **Off** clears them all. With any warning set, a **Sound** toggle adds a soft chime. Never shows during quiet hours. |

Everyone handles switching activities differently, so these are per device: a bedroom tablet can count down every minute while the kitchen wall only warns at 10 and 5. For warnings that follow a person to their own phone or tablet, see [Transition reminders](family.md#transition-reminders).

## Night screen

The card reads **Clock only** or sums up the slideshow (for example "Drawings and family photos, every 5 min, clock on"); tap **Change** under **Night screen** to set it. What this display shows during the household's [quiet hours](../using/quiet-hours.md): **Clock only**, or a slideshow of **Drawings**, **Family photos**, **Art (The Met)** and **Nature**, with how often the picture changes, brightness and a corner clock. **Preview screensaver** shows it for 20 seconds.

## Notifications

This device's push notifications: **Turn on notifications**, **Event reminders**, **Daily summary**, **Chore reminder**, **List updates**, **Which family members?**, **Send test** and **Turn off**. See [Notifications](../using/notifications.md).

## Troubleshooting

| Item | Notes |
|---|---|
| **Clear cache and reload** | "Loads the latest version of Kinwall if this device seems stuck on an old one. You stay signed in." It clears caches, asks the service worker to update (without removing it, since push depends on it) and reloads from the network. |
| **Unpair this display** | On displays. Removes the key from this device. You'll need to pair it again from an admin device. |

## What a display sees in Settings

A device with a display key gets two tabs:

* **General**: both groups, without Default reminder under Household.
* **Family**: Members (read-only) and Categories.

**Calendars** and **Access** are never shown to a display, not even briefly. Settings shows the display view until the server confirms the device is an admin.
