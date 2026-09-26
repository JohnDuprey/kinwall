# Quiet hours (displays only)

Quiet hours turn a wall display into a dim, slowly drifting clock overnight. That saves the screen, avoids burn-in and keeps the hallway dark.

## Set it up

**Settings → General → Appearance → Quiet hours (displays)**: choose **On**, then set **Quiet from** and **Quiet to**. Turning it on starts you at 22:00 → 06:00. The window can cross midnight.

## Behaviour

* It applies **only to paired wall displays** (devices using a display key). Phones and admin devices are never dimmed.
* During the window, the display shows only the time on a dark screen. The clock moves slightly now and then so no pixels stay lit in one place.
* **Tap the screen** to wake it. It returns to the clock after **five minutes** without a touch.
* The times are read on the display's own clock. The setting syncs to every display within about 30 seconds.

## Screensaver

Instead of the bare clock, a display can show a slow, dim slideshow overnight. It's set **per display**: **Settings → General → This display → During quiet hours show**. Turn on one or more sources. With more than one on, the pictures take turns (drawing, then family photo, then art, then nature, and so on). **Clock only** (the default) turns them all off.

* **Drawings**: pictures from this display's own [Paint gallery](activities.md#my-drawings), shuffled. If there are none yet, the display skips drawings (or shows the clock if drawings is the only source).
* **Family photos**: your family's [photos](photos.md), shuffled, with their captions. They come from your own Kinwall server.
* **Art (The Met)**: public-domain highlight paintings from [The Metropolitan Museum of Art](https://metmuseum.github.io/) open-access collection (CC0), with the title, artist and date in the corner.
* **Nature**: photos from [Lorem Picsum](https://picsum.photos), which serves free-to-use Unsplash photos.

Options once any source is on:

* **Change picture every** 2, 5 (default), 10 or 20 minutes. Pictures crossfade; with reduced motion turned on they switch without a fade.
* **Brightness**: **Low** (default) or **Medium**. It's a night mode, so pictures are always dimmed, never full brightness.
* **Show clock**: a small time and date in a corner. The corner changes with each picture, and the picture shifts slightly, so nothing stays lit in one place.

Tapping wakes the display as usual. **Preview screensaver** shows the quiet-hours screen for 20 seconds on whatever device you're using, so you can check it from a phone; tap or press Escape to end it early.

**Privacy:** Art and Nature are off by default. When chosen, the display fetches pictures **directly** from that service (no Kinwall server in between), so the service sees the display's IP address. Nature makes one request per picture. Art fetches the list of highlight paintings once a night, then looks up one artwork and loads its image per change. Nothing about your household is sent. Drawings never leave the device, and family photos come only from your Kinwall server. If a service can't be reached, the display skips it for that change and uses the next source. If none can be used, it quietly shows the clock and tries again at the next change.

## API

`quietFrom` / `quietTo` (`HH:MM`) in `PATCH /api/settings`. Send both, set or cleared together (`""` or `null` turns quiet hours off).

Quiet hours are separate from the [dark schedule](appearance.md#dark-schedule). A display can switch to dark at 20:00 and dim to the clock at 22:00.
