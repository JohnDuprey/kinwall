# Put it on the wall

![Board view on the wall iPad](../screenshots/ipad-board.png)

## 1. Pair the display

1. On the iPad, open `https://<your-kinwall>` in Safari and tap **Set up as a wall display**. It shows **Set up this display** with a 6-digit code and a QR code. The code is valid for 10 minutes.
2. Approve it from an admin device, either way:
   * scan the QR code with your phone and approve with your passkey, or
   * on your phone or computer, open **Settings → Access → Displays → Add a display**, then enter the **Code** and a **Name** (default "Wall display") and tap **Pair display**.
3. The display shows "You're connected! 🎉" and loads the calendar. It now holds a **display** key, which can't manage members, accounts, keys or webhooks.

You can also tap **Enter a key manually** on the sign-in screen and paste any API key.

## 2. Install it as an app (PWA)

In Safari, tap **Share → Add to Home Screen**, then always launch Kinwall from the home screen icon. It runs full screen with no browser bars. On Android, Chrome's **Install app** / **Add to Home screen** does the same.

## 3. Lock the iPad to Kinwall

* **Settings → Display & Brightness → Auto-Lock → Never**.
* **Settings → Accessibility → Guided Access → On**. Open Kinwall and triple-click the side/top button to start it. This keeps the iPad on Kinwall and disables the home gesture.
* Optional: turn on [Quiet hours](../using/quiet-hours.md) so the screen shows only a dim clock overnight.

## How the wall display behaves

* After 2 minutes without a touch it goes back to today's calendar and closes any open sheet.
* It checks for changes every 30 seconds (`GET /api/rev`), so edits from phones show up within about 30 seconds.
* When a new version is deployed, a **Kinwall updated — tap to reload** banner appears.
* **Settings** on a display shows **General** (the family cards and this device's cards) and **Family** (Members read-only, Categories). The **Calendars** and **Access** tabs are hidden. See [This display](../settings/this-display.md).

## Unpair or replace a display

* On the display: **Settings → General → Troubleshooting → Unpair this display**.
* From an admin device: **Settings → Access → Displays**, then remove the display. It's signed out at once and needs pairing again.
