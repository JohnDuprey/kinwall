# Photos

**Activities → Photos** keeps a small album of family pictures. They show up on the calendar's [Board view](calendar.md#board-view) picture card and, if you choose, in a display's [Night screen slideshow](night.md#screensaver).

An admin can turn off **Photos** in **Settings → General** (tap **Change** under **Features**): Activities → Photos is hidden and the photos are kept. The Board's picture card shows Google Photos (if it's connected) or nature pictures instead, and a night screen set to **Family photos** shows nature pictures. See [Features](../settings/general.md#features).

![Photos on the wall iPad](../screenshots/ipad-photos.png)

A [memory](trackers.md#memories)'s own photo isn't a family photo unless its **Also in family photos** switch is on. Until then it shows only in that memory, and the count here lists it separately ("+3 in memories").

## Adding photos

<img src="../screenshots/phone-photos.png" width="32%" alt="Photos on a phone" />

Tap **Add photos** (the button at the top, or the **Add photos** tile at the start of the grid) and pick one or more pictures. On an iPhone or iPad this opens your Photos library.

Before uploading, your browser shrinks each photo to at most 1280 pixels on its long edge and saves it as WebP (or JPEG on browsers that can't make WebP). A typical phone photo ends up around 150–300 KB. The original stays on your device.

Adding photos from the Photos page, and captioning and deleting them, needs a parent (admin) sign-in. A paired wall display can look at the photos but not change them.

The one exception is [Paint](activities.md): its **♥ Save to family photos** button adds the drawing here, and it works on wall displays too. The photo is captioned with the drawing's name and who drew it. Only a parent can edit or delete it afterward.

## Captions and owners

Tap a photo to see it full size. Swipe, tap **‹** and **›**, or use the arrow keys to move to the previous or next photo. A parent can also:

* add or edit a **caption** (shown under the picture on the Board and the screensaver),
* mark who it's **for**, or leave it for **Everyone**,
* **Delete** it after you confirm.

## Limits

| Limit | Value |
|---|---|
| One photo, after shrinking | 600 KB |
| Photos per family | 200 |
| Total storage | 100 MB |

[Profile pictures](profiles.md#profile-pictures) and memories' own photos count toward these too.

The Photos page shows how much you've used, for example "23 photos · 6 MB of 100 MB".

## Formats

JPEG, PNG, WebP and anything else your browser can open. HEIC photos straight from an iPhone's files may not open in every browser. If you see "This photo format can't be read here", pick the photo from the Photos library instead (the iPhone converts it for you) or export it as JPEG first.

## Where photos show up

* **Board view**: the picture card rotates through this display's screensaver sources (its own, or the family's). If none are chosen, it shows your family photos and [Google Photos](#google-photos) when it's connected (or nature photos until there are some).
* **Screensaver**: turn on **Family photos** under **What they show** (**Settings → General**, tap **Change** under **Night**, for the whole family or under **Night screen on this device** for one screen).

## Google Photos

> **Not available yet.** Google only lets accepted Photos partners use the Ambient API that this needs (Google answers other apps with "permission denied" and points to its partner program), and a self-hosted server can't be a partner. So Google Photos is switched off; it only appears on a server with `GOOGLE_PHOTOS_ENABLED=1` and a partner-approved Google project. Add [family photos](#adding-photos) instead.

A parent can also show albums from Google Photos on the Night screen and the Board's picture card, without copying them into Kinwall. The photos stay in Google Photos; Kinwall keeps only which ones to show.

**Connect it** from a parent device: **Settings → General → For the whole family**, tap **Change** under **Night**, then **Connect Google Photos**.

Before you connect, the sheet says what Kinwall asks Google for: **see the photos in albums you choose** (to show them on the Night screen and the Board) and **see your name and email** (to show which Google account is connected). Kinwall never changes, uploads or shares your photos.

1. Sign in to the Google account whose photos you want. Google asks for permission to show the photos you pick on a device, and to share your name and email with Kinwall. That's its own permission: it doesn't use or change your [Google Calendar](../calendars/google.md) connection, and connecting Calendar never asks for Photos.
   * Usually Google's sign-in opens in the same tab, like connecting a calendar, and brings you back to this sheet. On a wall screen the sheet stays put: tap **Continue to Google** and sign in on that screen. The sign-in has to finish on the device that started it, so there's no QR code for it: to sign in on your phone instead, cancel on the wall and connect from Settings on your phone. In the Kinwall phone app, Google's page opens in the app's own browser; tap **Open in the Kinwall app** at the end to finish.
   * If your server uses a [TV client](../self-hosting/configuration.md#google-photos), Kinwall shows a short code instead: on a phone or computer, go to `google.com/device` (the link, or the QR code on a big screen) and enter it.
2. Pick albums for "Our Family Kinwall" (your family's name): tap **Choose albums in Google Photos** (or scan its QR code). With the code sign-in, Google usually opens this page for you. The sheet says "Waiting for you to choose albums…" until you're done.
3. Once albums are picked, the sheet says **Connected to Google Photos** with the account's name and email (on a wall screen, only its initial), how many photos there are, and **Google Photos** appears under **What they show**. Turn it on there for every wall screen, or on a screen that picks its own under **Night screen on this device**. The Board's picture card shows them on displays that haven't picked any sources.

It's one connection for the whole family: every screen can show the photos, but only a parent device can connect, change albums or disconnect. Wall screens and kids' devices can't.

* **Change albums in Google Photos** opens the same Google Photos page to pick different albums. New picks show up within the hour.
* **Disconnect Google Photos** (it asks first) removes Kinwall from the Google Photos device list, cancels its access to your Google account and forgets the list of photos and the account's name and email. Your photos and Google Calendar aren't touched. You can also remove access in your Google Account under **Security → Third-party apps & services**.
* **"Google didn't allow Photos with this app."** Google turned down the Photos permission for the server's Google app. The person who runs the server can switch to a TV client: see [Google Photos](../self-hosting/configuration.md#google-photos) in Configuration.
* **Reconnect.** If Google stops sharing (you removed the permission in your Google Account, or deleted the device in Google Photos), screens quietly go back to their other picks (nature pictures if Google Photos was the only one), and the sheet shows **Reconnect Google Photos** to parents.
* **Connected before the account was shown?** A connection made before Kinwall kept the account says **Connected to Google Photos** without it. **Reconnect to show the account** signs in again (you choose albums again); nothing forces it.
* Google Photos leaves out screenshots, receipts, blurry shots and pictures it considers too personal for a shared screen. Kinwall shows photos only and skips videos.
* There are no webhooks or MCP tools for Google Photos: it only picks pictures for screens.

The [demo](../self-hosting/demo-build.md) has a pretend Google Photos connection with sample pictures, so you can see the sheet and the slideshow without Google.

**Self-hosting?** The server needs its own Google Cloud project with the Photos Ambient API turned on. See [Google Photos](../self-hosting/configuration.md#google-photos) in Configuration.

What Google sees and what's stored: see [Privacy](../your-data/privacy.md#google-photos).

## Backing up and moving photos

Photos aren't part of the JSON [export](../your-data/export-import.md). They back up as their own zip:

* **Download all (zip)** saves `kinwall-photos-YYYY-MM-DD.zip`. It has a `photos/` folder, with each file named by the date it was added and its ID, plus `manifest.json` listing every photo's caption, owner, size and date. Paint's [coloring pages](activities.md#adding-your-own-pages) are in it too (marked `"coloring": true`) and come back as coloring pages, not photos. So are [profile pictures](profiles.md#profile-pictures) (marked `"picture": true`): each comes back as that person's picture, matched by ID or name, and is skipped when nobody here has that name.
* **Import zip** adds the photos from such a zip to this family. Captions and owners come back from `manifest.json`. An owner is matched by member ID, or else by name, so photos land on the right person in a new family too. Photos already here (same ID) are skipped, so importing the same zip twice doesn't double anything. The per-photo and storage limits still apply, and anything over them is skipped. A zip you unpacked and zipped again with another tool still imports.

Both buttons are on the Photos page and need a parent (admin) sign-in.

API: `GET /api/photos/export.zip` (a download link from `POST /api/photos/export-link` works once, within a minute), `POST /api/photos/import` with the zip as the body (`Content-Type: application/zip`).

## Privacy

Photos are stored in your Kinwall database, next to the rest of your family's data, and are only served to your own signed-in devices. They're never sent to any other service. They aren't in the JSON [export file](../your-data/export-import.md). Use **Download all (zip)** to keep a copy (see above), or back up the database itself (see [Backups](../your-data/backups.md)).

API: see [REST API](../integrations/rest-api.md) (`/api/photos`).
