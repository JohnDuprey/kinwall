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

Also under **This display → Appearance on this device**, per device only — there's no household-wide skin.

**Color scheme** picks one of ten preset "skins", each with its own light and dark palette: Meadow (the default look — nothing changes if you never touch this), Autumn, Winter, Spring, Summer, Ocean, Midnight (a deep navy that looks the same in light and dark mode), Lavender, and two holiday ones, Harvest and Festive. Every skin passes WCAG AA contrast (4.5:1) for text on its backgrounds.

**Follow the seasons** switches the skin automatically through the year instead of using a fixed pick: Winter (Dec–Feb), Spring (Mar–May), Summer (Jun–Aug), Autumn (Sep–Nov), with Harvest taking over Nov 15–30 and Festive from Dec 15 to Jan 2. It re-checks once an hour, so it catches up the same day a season turns over.

**Custom colors** (a disclosure under the skin picker) lets you override the accent, background, card and text colors with your own hex values, layered on top of whichever skin is active. Each field shows a live "AA ✓" or "Low contrast" badge with the actual ratio, so you can see before saving whether it stays readable; the accent field is always safe since buttons darken it automatically to keep white text legible. **Reset** clears one field, and **Reset to Meadow** clears the skin, seasonal switch and all custom colors on this device.

Low-stimulation mode always uses the flat, pre-vetted skin colors — custom colors don't apply while it's on.
