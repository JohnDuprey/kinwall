# Appearance

![Board view with the Midnight skin](../screenshots/ipad-board-midnight.png)

![Week view in dark mode](../screenshots/ipad-week-dark.png)

Appearance works on two levels:

* **Household**: **Settings → General → Appearance**. It applies to every device, and it's also used on the sign-in and pairing screens before a device has a key.
* **Per device**: **Settings → General → Appearance on this device**. It overrides the household value on this device only.

## Household settings

Quiet hours are a separate card, right after Appearance. See [Quiet hours](quiet-hours.md).

| Setting | Options | Default |
|---|---|---|
| **Mode** | Light, Dark, Auto (follows the device's system setting), Scheduled | Light |
| **Dark from / Dark to** (Scheduled) | Two times. The window can cross midnight. | 20:00 → 07:00 |
| **Color scheme** | Seasonal, or one of ten skins. See [Color schemes](#color-schemes). | Meadow |
| **Custom colors** | Your own accent, background, card and text colors on top of the scheme | None |
| **Text size** | Small, Medium, Large, Extra large | Medium |
| **Density** | Comfortable, Compact (shorter hour rows in the time grid) | Comfortable |

Changes save as you make them, and other devices pick them up within about 30 seconds.

### Dark schedule

**Scheduled** switches to dark between **Dark from** and **Dark to** in the device's local time, and it re-checks every minute. It's a good fit for a wall display that should dim in the evening without going dark all day. **Auto** follows the operating system's light/dark setting instead.

## Per-device overrides

Under **Appearance on this device**:

* **Mode**, **Text size** and **Density** are menus. The first option is **Household (*current value*)**, which follows the family setting.
* **Color scheme** has the same chips as the household setting, plus a first chip, **Household · *scheme***, which follows the family setting. **Custom colors** work the same way too. See [Color schemes](#color-schemes).
* **Typeface**: Default (Nunito), Hyperlegible (Atkinson Hyperlegible Next) or Dyslexia-friendly (Lexend).
* **Low-stimulation mode**: a toggle that reduces motion and visual noise on this device.

Overrides are saved in the browser's local storage on that device. They're never sent to the server and aren't in exports. A kitchen iPad can use Extra large text and the Midnight scheme while phones stay on the household defaults.

**Navigation position** (Auto, Bottom, Left, Right) for tablets and desktops is in the **This display** card. Phones always use the bottom bar. See [This device](../settings/this-display.md).

## Color schemes

A color scheme (a "skin") changes the whole palette: backgrounds, cards, text and accent. The household picks one for every device under **Appearance**. Any device can follow it or pick its own under **Appearance on this device**, so the kitchen wall can use Midnight while phones keep the family's scheme.

**Color scheme** offers ten skins, each with its own light and dark palette:

| Skin | Notes |
|---|---|
| 🌿 Meadow | The default look. Nothing changes if you never touch this. |
| 🍂 Autumn, ❄️ Winter, 🌸 Spring, ☀️ Summer | The four seasons. |
| 🌊 Ocean, 💜 Lavender | |
| 🌌 Midnight | A deep navy that looks the same in light and dark mode. |
| 🎃 Harvest, 🎄 Festive | For the holidays. |

Every skin meets WCAG AA contrast (4.5:1) for text on its backgrounds.

**Seasonal** changes the scheme through the year for you:

* Winter: December to February
* Spring: March to May
* Summer: June to August
* Autumn: September to November
* Harvest takes over from November 15 to 30, and Festive from December 15 to January 2.

It checks once an hour, so it switches on the same day a season changes.

**Custom colors** (tap to open it under the scheme chips) lets you set your own accent, background, card and text colors on top of the scheme. Each field shows a live badge with the contrast ratio: "AA ✓" when it's readable, or "Low contrast". The accent is always safe, because buttons darken it as needed to keep white text readable. **Reset** clears one field.

How the two levels combine:

* A device that follows the household scheme also gets the household's custom colors. Its own custom colors go on top of those.
* A device that picks its own scheme starts from that scheme alone, and only its own custom colors apply.
* **Reset to Meadow** (household) sets the family back to the default look. **Use household colors** (device) clears the device's scheme and custom colors so it follows the family again.

Low-stimulation mode always uses the scheme's own, pre-checked backgrounds, cards and text. Only a custom accent still applies while it's on.
