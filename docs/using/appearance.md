# Appearance

![Board view with the Midnight skin](../screenshots/ipad-board-midnight.png)

![Week view in dark mode](../screenshots/ipad-week-dark.png)

Appearance works on two levels:

* **Household**: **Settings → General → Appearance**. It applies to every device, and it's also used on the sign-in and pairing screens before a device has a key.
* **Per device**: **Settings → General → This display → Appearance on this device**. It overrides the household value on this device only.

## Household settings

| Setting | Options | Default |
|---|---|---|
| **Mode** | Light, Dark, Auto (follows the device's system setting), Scheduled | Light |
| **Dark from / Dark to** (Scheduled) | Two times. The window can cross midnight. | 20:00 → 07:00 |
| **Accent color** | Preset swatches, or a custom color (the rainbow swatch) | `#FF9E7A` |
| **Light background** | Warm, White, Gray, Sage | Warm |
| **Dark background** | Cocoa, Charcoal, Midnight | Cocoa |
| **Text size** | Small, Medium, Large, Extra large | Medium |
| **Density** | Comfortable, Compact (shorter hour rows in the time grid) | Comfortable |
| **Quiet hours (displays)** | Off / On, with Quiet from and Quiet to | Off. See [Quiet hours](quiet-hours.md). |

Changes save as you make them, and other devices pick them up within about 30 seconds.

### Dark schedule

**Scheduled** switches to dark between **Dark from** and **Dark to** in the device's local time, and it re-checks every minute. It's a good fit for a wall display that should dim in the evening without going dark all day. **Auto** follows the operating system's light/dark setting instead.

## Per-device overrides

Under **This display → Appearance on this device**:

* **Mode**, **Text size** and **Density** are menus. The first option is **Household (*current value*)**, which follows the family setting.
* **Accent**, **Light bg** and **Dark bg** are chip rows. **Household** follows the family setting, and any other chip overrides it.
* **Typeface**: Default (Nunito), Hyperlegible (Atkinson Hyperlegible Next) or Dyslexia-friendly (Lexend).
* **Low-stimulation mode**: a toggle that reduces motion and visual noise on this device.

Overrides are saved in the browser's local storage on that device. They're never sent to the server and aren't in exports. A kitchen iPad can use Extra large text and the Midnight background while phones stay on the household defaults.

The same section has **Navigation position** (Auto, Bottom, Left, Right) for tablets and desktops. Phones always use the bottom bar. See [This display](../settings/this-display.md).

## Color schemes

A color scheme (a "skin") changes the whole palette: backgrounds, cards, text and accent. It's set **per device** under **This display → Appearance on this device**. There's no household-wide skin, so the kitchen wall can use Midnight while phones keep the default look.

**Color scheme** offers ten skins, each with its own light and dark palette:

| Skin | Notes |
|---|---|
| 🌿 Meadow | The default look. Nothing changes if you never touch this. |
| 🍂 Autumn, ❄️ Winter, 🌸 Spring, ☀️ Summer | The four seasons. |
| 🌊 Ocean, 💜 Lavender | |
| 🌌 Midnight | A deep navy that looks the same in light and dark mode. |
| 🎃 Harvest, 🎄 Festive | For the holidays. |

Every skin meets WCAG AA contrast (4.5:1) for text on its backgrounds.

**Follow the seasons** changes the skin through the year for you:

* Winter: December to February
* Spring: March to May
* Summer: June to August
* Autumn: September to November
* Harvest takes over from November 15 to 30, and Festive from December 15 to January 2.

It checks once an hour, so it switches on the same day a season changes.

**Custom colors** (tap to open it under the skin picker) lets you set your own accent, background, card and text colors as hex values, on top of whichever skin is active. Each field shows a live badge with the contrast ratio: "AA ✓" when it's readable, or "Low contrast". The accent is always safe, because buttons darken it as needed to keep white text readable. **Reset** clears one field. **Reset to Meadow** clears the skin, the seasonal switch and all custom colors on this device.

Low-stimulation mode always uses the skin's own, pre-checked colors. Custom colors don't apply while it's on.
