# Appearance

![Week view in dark mode](../screenshots/ipad-week-dark.png)

Appearance works on two levels:

* **Household**: **Settings → General → Appearance**. It applies to every device, and it's also used on the sign-in and pairing screens before a device has a key.
* **Per device**: **Settings → General → This display → Appearance on this device**. It overrides the household value on this device only.

## Household settings

| Setting | Options | Default |
|---|---|---|
| **Mode** | Light, Dark, Auto (follows the device's system setting), Scheduled | Light |
| **Dark from / Dark to** (Scheduled) | Two times. The window can cross midnight. | 20:00 → 07:00 |
| **Accent color** | Preset swatches, or a custom colour (the rainbow swatch) | `#FF9E7A` |
| **Light background** | Warm, White, Gray, Sage | Warm |
| **Dark background** | Cocoa, Charcoal, Midnight | Cocoa |
| **Text size** | Small, Medium, Large, Extra large | Medium |
| **Density** | Comfortable, Compact (shorter hour rows in the time grid) | Comfortable |
| **Quiet hours (displays)** | Off / On, with Quiet from and Quiet to | Off. See [Quiet hours](quiet-hours.md). |

Changes save as you make them, and other devices pick them up within about 15 seconds.

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
