# Put it on the wall

![Board view on the wall iPad](../screenshots/ipad-board.png)

## 1. Pair the display

1. On the iPad, open `https://<your-kinwall>` in Safari and tap **Set up a wall screen or kid's device**. It shows **Set up this screen** with a 6-digit code and a QR code. The code is valid for 10 minutes.
2. Approve it from a parent's phone or computer (a device signed in with a passkey, which has admin rights), either way:
   * scan the QR code and tap **Approve as a parent**, or
   * open **Settings → Access → Paired devices → Add a wall screen or kid's device**, then enter the **Code** and a **Name** (default "Wall screen") and tap **Add it**.

   Either way you also pick **What is this device?**:
   * **🖼️ Wall screen (whole family)** for a kitchen wall. It turns on **Use as a wall screen** by itself.
   * **A kid's device**: one kid (say Maya, for her tablet or bedroom screen). It shows only her things.

   A paired device is never a grown-up's: whoever approves a code would otherwise get a device that opens that grown-up's [private journal](../using/journal.md#private-journals). Grown-ups sign in on their own phone or computer with a passkey (or the Kinwall app with full access), then pick themselves under **Whose device is this?**.

   Only a parent can change it later, under **Settings → Access → Paired devices**.
3. The display shows "You're connected! 🎉" and loads the calendar. It now holds a **display** key, which can't manage members, accounts, keys or webhooks.

You can also tap **Enter a key manually** on the sign-in screen and paste any API key.

## 2. Install it as an app (PWA)

In Safari, tap **Share → Add to Home Screen**, then always launch Kinwall from the home screen icon. It runs full screen with no browser bars. On Android, Chrome's **Install app** / **Add to Home screen** does the same.

On phones, Kinwall also offers this itself. From the second visit in a browser, a card above the tab bar says **Add Kinwall to your Home Screen**. On Android its **Install** button opens the install dialog; on iPhone and iPad **Show me how** walks through Share → **Add to Home Screen**. **Not now** hides it for 30 days, and it never shows once Kinwall runs from the Home Screen. The same option is always under **Settings → General → This display → Add to Home Screen**.

There are also native Kinwall apps for iPhone, iPad, Apple Watch and Android, in a separate [kinwall-mobile](https://github.com/JohnDuprey/kinwall-mobile) repository. They aren't on the App Store or Play Store yet, so this Home Screen install is the way to get Kinwall on a phone today; see [MCP server → Native apps](../integrations/mcp.md#native-apps) for how they sign in once you do build one.

### Requirements

| | To run Kinwall | To add it to the Home Screen | Push notifications |
|---|---|---|---|
| **iPhone / iPad** | iOS / iPadOS **16.4 or later** for everything; **12 or later** in Safari with basic features (see [Older devices](#older-devices)) | iOS / iPadOS **16.4 or later**, in **Safari**: Share → **Add to Home Screen**. Chrome and Edge also offer it from their Share button. | Only from the Home Screen icon, iOS / iPadOS 16.4 or later |
| **Android** | A current **Chrome**, **Edge**, **Samsung Internet** or **Firefox** | Chrome, Edge or Samsung Internet: **Install app** / **Add to Home screen** (or Kinwall's own **Install** button) | In the browser or installed |
| **Computer** | Chrome or Edge 111+, Firefox 114+, Safari 16.4+ (older versions get the basic-features build) | Optional: the install icon in Chrome's or Edge's address bar | Any browser with Web Push |

### Offline

Once a device has opened Kinwall with a connection, it opens without one too, showing the calendar, chores, lists and meals as they last were. Shopping-list changes and chore ticks made offline wait on the device and sync when the connection returns; other changes need a connection. See [Offline shopping](../using/lists.md#offline-shopping).

* **Browsers and Home Screen apps**: Safari and Chrome on iPhone, iPad and Android, and desktop browsers. Private browsing windows may not keep the offline copy.
* **Older devices** (iOS / iPadOS 12 to 16.3, in a Safari tab): the same, as long as the browser keeps the offline copy.
* **The Kinwall app**: while the app is open, changes made without a connection wait and sync, as in a browser. Opening the app from scratch with no connection needs a version of the app that allows offline start-up.

### Older devices

An old iPad (one stuck on iOS 12 or iPadOS 15, say) can still be a wall display: open Kinwall in **Safari** and use it in the browser tab. Kinwall detects the older browser and loads a compatibility version of the app, so the calendar, events, chores, lists, photos, Paint and settings all work. What's different before iOS / iPadOS 16.4:

* **Not installable.** Home Screen web apps have existed since iOS 11.3, but Kinwall's installed-app features and push notifications need 16.4, so keep it in a Safari tab. The [notification feed](../using/notifications.md#notification-feed) under the bell still shows everything.
* **No push notifications.**
* **Passkeys** need iOS / iPadOS 14.5 or later, and on the oldest versions the passkey buttons don't appear at all. [Pair the display](#1-pair-the-display) from your phone instead (that works on any version), or sign in with a recovery code or **Enter a key manually**.
* **Some visual polish is missing**, mostly before iOS 14.5: spacing between some buttons and chips can be tighter, a few tinted highlights are flat, and form fields use Safari's default look. Relative times ("5 minutes ago") are in English only before iOS 14.
* **Slower first load.** The compatibility version is larger, and an old iPad is slower to start it.

Older than iOS 12 isn't supported.

### Installed vs. in the browser

Installing changes how Kinwall opens, not what it can do. Everything (calendar, events, chores, lists, photos, Paint, settings, the notification bell) works the same in a browser tab. Only these differ:

| | From the Home Screen | In a browser tab |
|---|---|---|
| Screen | Full screen with its own icon, no address bar or tabs | Browser bars and tabs stay visible |
| Push notifications on iPhone / iPad | Yes (iOS 16.4+) | No. Safari tabs can't receive push; the [notification feed](../using/notifications.md#notification-feed) under the bell still shows everything. |
| Push notifications on Android and computers | Yes | Yes |
| The **Add Kinwall to your Home Screen** card | Never shown | Shown on phones from the second visit |

In both cases Kinwall asks the browser to keep the screen awake while it's showing. Browsers without that feature let the screen sleep, so on a wall iPad set **Auto-Lock → Never** (below) either way.

Kinwall needs a connection to your server whether it's installed or not. It doesn't keep an offline copy.

## 3. Lock the iPad to Kinwall

* **Settings → Display & Brightness → Auto-Lock → Never**.
* **Settings → Accessibility → Guided Access → On**. Open Kinwall and triple-click the side/top button to start it. This keeps the iPad on Kinwall and disables the home gesture.
* Optional: turn on [Night hours](../using/night.md) so the screen shows only a dim clock overnight.

## How the wall display behaves

* After 2 minutes without a touch it goes back to Home (the Board, or its locked view) on today and closes any open sheet.
* It checks for changes every 30 seconds (`GET /api/rev`), so edits from phones show up within about 30 seconds.
* When a new version is deployed, a **Kinwall updated — tap to reload** banner appears.
* **Settings** on a display shows **General** (the family cards and this device's cards) and **Family** (Members read-only, Categories). The **Calendars** and **Access** tabs are hidden. See [This display](../settings/this-display.md).

## Nest Hub and other smart displays (DashCast)

A Google Nest Hub (7", 1024×600), Nest Hub Max (10", 1280×800) or another Cast smart display can show Kinwall too. These displays have no browser of their own: something casts the page to them through [DashCast](https://github.com/madmod/dashcast), a Cast app that opens a web address on the screen. From Home Assistant that's usually [CATT](https://github.com/skorokithakis/catt) (`catt -d "Kitchen display" cast_site <address>`) or the [Continuously Casting Dashboards](https://github.com/b0mbays/continuously_casting_dashboards) integration, which runs CATT for you. The screen stays a touch screen while it shows Kinwall.

1. Cast `https://<your-kinwall>/?screen=cast`. The `?screen=cast` part turns on **cast screen** mode, which this display remembers. Kinwall also turns it on by itself when the display says it's a Cast device, so the address works without it too; `?screen=normal` turns it off again.
2. The first time, the display shows the sign-in screen. Tap **Set up a wall screen or kid's device** on the display and approve its code from a parent's phone, as in [Pair the display](#1-pair-the-display). The display keeps its key, so the next cast opens straight on Home.
3. If you like, pick a [Board layout](../using/calendar.md#board-layouts) with fewer cards for this screen (**Settings → General → This display → Board layout**). Cast screen mode keeps whatever layout the display has.

In cast screen mode Kinwall is drawn bigger, to read from across the kitchen: a bigger clock, Board text and buttons, and a side bar of six big buttons with the rest under **More**. The Board shares out the screen in its layout's columns instead of scrolling, and is drawn a little smaller when its cards still don't fit. Everything else works as on any wall screen: going back to Home after 2 idle minutes, and the [Night screen](../using/night.md) at night.

A cast page closes after a while (about 10 minutes on a Nest Hub, when nothing is playing) or when someone asks the display for something else. Keep it up with an automation that casts the address again when the display isn't showing it, every few minutes; Continuously Casting Dashboards does this on its own.

## Unpair or replace a display

* On the display: **Settings → General → Troubleshooting → Unpair this display**.
* From an admin device: **Settings → Access → Paired devices**, then remove the display. It's signed out at once and needs pairing again.
