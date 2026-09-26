# Settings → General → Only on this device

The second group of cards on **Settings → General**. Everything here applies to **this device only** and is stored in the browser, not on the server. It isn't in exports.

## This display

What this screen shows and how you get around it.

| Item | Notes |
|---|---|
| **Paired as *name*** | Shown on paired displays. |
| **Show only** | Pin this screen to one member, which is handy for a display in a bedroom. Picks a member, or **Everyone**. |
| **Also show things for everyone** | Only shown once a member is picked. On (default): shared events, chores and lists (nobody assigned) still show alongside that member's own. Off: only their items. |
| **Lock view** | Fixes the calendar to one view (Board, Day, Week/3 Day, Month, Schedule) and hides the view switcher, so a pinned display can't be bumped into a different view. **Off** leaves the switcher free. |
| **Navigation position** | **Auto**, **Bottom**, **Left** or **Right**: where the Calendar, Chores and Lists buttons sit, as a bottom tab bar or a side rail. Phones always use the bottom bar. |

A paired wall display also locks its own viewport (no pinch-zoom), so it can't be zoomed by a stray touch.

## Appearance on this device

Mode, Color scheme, Text size and Density, each starting on **Household** to follow the family's setting, plus **Typeface** and **Low-stimulation mode**. Color scheme has a **Household · *scheme*** chip, the same schemes as the family setting (including the family's own), **Customize**, and **Use household colors** to go back to the family's. See [Appearance](../using/appearance.md#per-device-overrides).

## Time cues

| Item | Notes |
|---|---|
| **Now / Next** | On by default. What's on now and what's next today, with a countdown, above the calendar on every view. On a wall display it hides when nothing is left today. On a phone it's a fixed two-line strip that reads "Nothing more today" when the day is done, so the screen never jumps. |
| **Transition warnings** | Off, or one or more of 10, 5, 1 minute(s) before the next event (or its leave-by time). A calm banner; never shows during quiet hours. With any minute picked, a **Sound** toggle appears. |

## Night screen

What this display shows during the household's [quiet hours](../using/quiet-hours.md): **Clock only**, or a slideshow of **Drawings**, **Family photos**, **Art (The Met)** and **Nature**, with how often the picture changes, brightness and a corner clock. **Preview screensaver** shows it for 20 seconds.

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
