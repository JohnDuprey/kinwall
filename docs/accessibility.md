# Accessibility

Kinwall is used by whole families: kids, grandparents, people with low vision, motor or cognitive differences, and neurodivergent family members who rely on a predictable wall calendar. The web app (the wall display and the phone/computer admin) aims at **WCAG 2.2 level AA**. This page says what works today, what doesn't yet, and how to tell us.

## Keyboard

Everything in the app can be reached and operated without a mouse or touch screen. Focused controls show a 2px ring in your accent color (4.5:1 against the background in light and dark mode).

| Where | Keys |
| --- | --- |
| Anywhere | **Tab** / **Shift+Tab** move between controls. The first stop is **Skip to content**. |
| View switchers and option groups (Week/Day/Month/Schedule, Settings sections, Mode, Text size, Repeat…) | One Tab stop. **←/→** (or **↑/↓**) move and select, **Home/End** jump to the ends. |
| Color and emoji pickers, chips, day toggles, the family avatars, the Chores date strip | **←/→** move along the row, **Enter** or **Space** picks. |
| Calendar week and month | Tab to the day headers (week) or day numbers (month). **←/→** move a day, **↑/↓** a week (month view), **Home/End** jump to the ends, **Enter** opens that day. Events are buttons: **Enter** or **Space** opens one. |
| Chores | **Space** or **Enter** ticks a chore off or back on. To edit it, press **Tab** once more to reach its **Edit** button, or use **Shift+F10** / the Menu key. |
| Lists | **Space** ticks an item; **Enter** on an item opens its editor. To reorder, focus an item's grip and press **Alt+↑** / **Alt+↓** (the new position is announced). The item editor also has **Move up** / **Move down**. |
| Sheets and dialogs | **Esc** closes. **Tab** stays inside while it's open, and focus goes back to where you were when it closes. |
| An event's **+ Add task** | **Enter** adds the task and keeps the field open for another; **Esc** folds it away. |

Dragging is never the only way to do something: sheets have a Close button, the calendar has Previous/Next next to swiping, and list items can be moved with the keyboard or the Move buttons.

## Screen readers

- Landmarks: a header, a "Main" navigation (the current page is marked), and the main content, which starts with a heading for the page. Settings sections, sheet titles and list names are headings too.
- Every control has a name. Event blocks read as a sentence: "4:00 PM Soccer Practice, Sam, Park field, Sports". Day cells read like "Friday, September 25, 2 events. Open day". Color swatches are named ("Peach", "Sky blue"), not hex codes.
- Selected states are exposed: segmented controls as radio buttons or tabs, chips and swatches as pressed toggle buttons, on/off settings as switches, chores and list items as checkboxes.
- Messages are announced: saving and saved, confirmations ("Event added"), a completed chore ("Make bed done, 5 points"), a moved list item, the "Signed in with a recovery code" banner, and import results. Errors are announced immediately and stay on screen until you tap them away.
- Confirmations and prompts ("Delete this event?", the ICS feed-URL prompt) are in-app dialogs with proper dialog semantics, not browser pop-ups.
- Form fields have visible labels tied to the field; field errors are linked to the field they belong to.

## Seeing the screen

- **Contrast**: body text, secondary ("dim") text, links, buttons and error text meet 4.5:1 on every color scheme, light and dark. Buttons filled with your accent color are deepened automatically so their white text stays at 4.5:1, whatever accent you pick.
- **Not color alone**: events show the family member's avatar or initial as well as their color; selected chips carry a check mark; the current page's tab has a bar as well as a color; done chores and list items show a tick.
- **Color vision**: see below.
- **Increased contrast**: with your device's "Increase contrast" setting on, dim text becomes full-strength, borders and dividers get stronger, and links are underlined.
- **Text size and zoom**: pinch-zoom is never blocked. Settings → Appearance → Text size (or per device: tap Change under Appearance on this device) scales all text up to 130%, and layouts hold at 200% browser zoom. Text never goes below 16px in form fields.
- **Dark mode**: follows the device, a schedule, or a fixed choice, per household or per device.

## Color vision

About 1 in 12 men and 1 in 200 women have some color blindness, most often red-green. Kinwall's defaults work without telling colors apart, with no setting to turn on:

- **People**: every event, chore column and Board row shows the person's avatar or name as well as their color bar. The one exception is the phone's month view, where chips show only the title (tap the day to see who).
- **Family colors**: Settings → Family warns when two people's colors would look alike ("Sam and Maya may look alike to someone with red-green color blindness") and suggests a palette color that stands out for one of them. The member editor says the same when you pick a clashing color. See [Members](settings/family.md#members).
- **List priority**: a badge with a mark of its own shape and the word, "‼ Urgent", "! High" or "↓ Low", not a colored dot.
- **Categories**: an event shows its category's emoji before the title, or the category's name when it has no emoji. The calendar filter and pickers show names.
- **Charts**: parts differ by fill, not only by shade. Goals met are solid, partly met striped, not met an outline, and no check yet a dashed outline; the battery's days ahead are dashed.

- **Color schemes**: some built-in schemes use an accent close to a status color: Spring's green is almost the green of a done tick, Festive's red is close to the red of "1 overdue", and Autumn, Harvest and Ink's orange is close to the High badge (Harvest and Ink only with red-green color blindness). Every status also carries a word, tick or mark, so nothing depends on telling them apart.

How the check works: each color is run through the Machado, Oliveira and Fernandes (2009) simulations of protanopia, deuteranopia and tritanopia (full severity, in linear RGB), and two colors count as alike when they're closer than 10 ΔE (CIE76, the distance in CIELAB) under any of them, or with typical vision. CIE76 is enough for "can you tell these apart at a glance?", which is a much bigger difference than the fine steps CIEDE2000 was made for.

## Motion and timing

- With **Reduce Motion** on, page and sheet slides, the chore confetti, the leaderboard crown bounce, sheet drag spring-back and the quiet-hours clock drift are all turned off.
- A wall display returns to today's calendar after 2 minutes without a touch or key press, but never while you're typing in a field.
- **Transition support** for people who find switching activities hard (ADHD, autism, or just being deep in play). Each screen can show calm transition warnings at any times you pick, repeated every few minutes as an event gets close, with an optional soft chime ([Time cues](settings/this-display.md#time-cues)). Each person can also get transition reminders on their own phone or tablet, counting down to when to leave when there's travel time ([Transition reminders](settings/family.md#transition-reminders)). Both are quiet during quiet hours, and everything is adjustable, since everyone is different.
- Information doesn't vanish on a timer: short confirmations fade after 4 seconds (and are repeated to screen readers); errors and results stay until tapped.

## Touch

Controls are at least 44 × 44 px on phones (color swatches, switches, list checkboxes and the list grips included), except the month-view chips noted below. Week-view events are at least 24px tall.

## Known gaps

We'd rather list these than pretend they aren't there:

- Tapping an empty time slot to start a new event at that time is pointer-only. With a keyboard or screen reader, use **Add event** and set the time in the form.
- On a phone's month view, event chips are small; tap the day to open it instead.
- In the default look, input, chip and card borders are softer than the 3:1 WCAG asks for non-text boundaries. Turn on your device's Increase contrast setting to get solid borders.
- The quiet-hours clock is deliberately dim (it's a night light, not a screen to read).
- Scrollbars are hidden and text outside form fields can't be selected, because the app is designed for a wall-mounted touch screen.
- The quick-add fields in a list ("Add an item…") and on an event ("Add task…") are labeled for screen readers but show only a placeholder on screen.
- Emoji avatars are read by their Unicode names ("fox", "bear face").
- Testing so far has used the browser's accessibility tree and keyboard-only runs. It has not yet been tested end to end with VoiceOver, TalkBack or NVDA.
- Shipped since this audit, per device under Settings: a low-stimulation mode, a typeface choice (Nunito, Atkinson Hyperlegible, Lexend), an icon-first density, and time-blindness aids (Now / Next countdown, leave-by times, transition warnings you can repeat as an event gets close, and per-person transition reminders). See [Appearance](using/appearance.md) and [Calendar](using/calendar.md).

## Finding help

Help is in the same place on every screen (WCAG 2.2 SC 3.2.6 *Consistent Help*): the **?** button at the top right of the header on the wall and on phones, of the sign-in screen and of the setup wizard opens a Help sheet with the docs, the accessibility page, **Report a problem**, **Suggest a feature** and, on hosted Kinwall, your hosting portal. Hosted Kinwall (coming soon) will carry a **Help & docs** link first in the footer of its own pages.

## Reporting a problem

If something in Kinwall is hard or impossible for you or someone in your family to use, please use **Report a problem** in the Help sheet (or [open an issue on GitHub](https://github.com/JohnDuprey/kinwall/issues/new) directly) with "Accessibility" in the title. Tell us what you were trying to do, what happened, and what you use (device, browser, screen reader or other assistive technology, text size). Screenshots or a short recording help but aren't required. Accessibility bugs are treated as bugs, not feature requests.
