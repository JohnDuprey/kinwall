# Settings → This display

The last section of **Settings → General**. Everything here applies to **this device only** and is stored in the browser, not on the server.

| Item | Notes |
|---|---|
| **Paired as *name*** | Shown on paired displays. |
| **Appearance on this device** | Overrides for Mode, Color scheme, Text size and Density. Leave any of them on **Household** to follow the family setting. See [Appearance](../using/appearance.md#per-device-overrides). |
| **Color scheme** | **Household · *scheme*** follows the family's scheme. Or pick Seasonal or a skin (Meadow, Autumn, Winter, Spring, Summer, Ocean, Midnight, Lavender, Harvest, Festive) for this device, and open **Custom colors** to set your own accent, background, card and text. **Use household colors** goes back to the family's. See [Appearance → Color schemes](../using/appearance.md#color-schemes). |
| **Navigation position** | **Auto**, **Bottom**, **Left** or **Right**: a bottom tab bar or a side rail. "Phones always use the bottom bar." |
| **Clear cache and reload** | "Loads the latest version of Kinwall if this device seems stuck on an old one. You stay signed in." It clears caches, asks the service worker to update (without removing it, since push depends on it) and reloads from the network. |
| **Unpair this display** | On displays. Removes the key from this device. You'll need to pair it again from an admin device. |

## Behavior on this device

Also under **This display**, and also local to the browser:

| Item | Notes |
|---|---|
| **Show only** | Pin this screen to one member, which is handy for a display in a bedroom. Picks a member, or **Everyone**. |
| **Also show things for everyone** | Only shown once a member is picked. On (default): shared events, chores and lists (nobody assigned) still show alongside that member's own. Off: only their items. |
| **Lock view** | Fixes the calendar to one view (Board, Day, Week/3 Day, Month, Schedule) and hides the view switcher, so a pinned display can't be bumped into a different view. **Off** leaves the switcher free. |
| **Now / Next card** | On by default. What's on now and what's next today, with a countdown, above the calendar on every view. On a wall display it hides when nothing is left today. On a phone it's a fixed two-line strip that reads "Nothing more today" when the day is done, so the screen never jumps. |
| **Transition warnings** | Off, or one or more of 10, 5, 1 minute(s) before the next event (or its leave-by time). A calm banner; never shows during quiet hours. With any minute picked, a **Sound** toggle appears. |

A paired wall display also locks its own viewport (no pinch-zoom), so it can't be zoomed by a stray touch.

## What a display sees in Settings

A device with a display key gets two tabs:

* **General**: Household (without Default reminder), Appearance, Notifications, This display.
* **Family**: Members (read-only) and Categories.

**Calendars** and **Access** are never shown to a display, not even briefly. Settings shows the display view until the server confirms the device is an admin.
