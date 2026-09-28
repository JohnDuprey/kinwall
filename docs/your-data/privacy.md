# Privacy & what's encrypted

Kinwall runs on your server or your Cloudflare account. The code includes no analytics or tracking, and your family's data goes nowhere except the calendar providers you connect.

## Encrypted at rest (AES-256-GCM)

These are encrypted with `ENCRYPTION_KEY`, using the row ID as additional data so a blob can't be moved to another row:

* Calendar account credentials: Google/Microsoft refresh tokens and CalDAV passwords.
* Calendar configs, including **ICS feed URLs** (they often contain a secret token).
* Webhook secrets.
* Web Push subscription keys, and the VAPID private key.
* Google/Microsoft client secrets entered in the UI.
* The admin key handed to a display during pairing (short-lived).

None of these is ever returned by the API. Error messages have secrets redacted.

## Stored as one-way hashes (SHA-256)

* API keys, passkey sessions and OAuth access/refresh tokens. Keys are shown once.
* Recovery codes.
* The setup code, and display pairing poll tokens.

## Stored in plain form

Your family's content: member names, events, chores, lists, settings, [trackers](../using/trackers.md) (including health visits) and [photos](../using/photos.md) (stored in the database itself, never sent anywhere else). On Docker that's in `kinwall.sqlite`, and on Workers it's in D1. Protect the host or account accordingly.

## Leaving your server

| Goes to | When |
|---|---|
| Google / Microsoft / your CalDAV server | Syncing and writing connected calendars. Google gets only calendar scopes. |
| ICS feed hosts | Fetching subscribed feeds. |
| Browser push services (Apple, Google, Mozilla) | Notification payloads, encrypted end to end with the device's keys (RFC 8291). |
| Your webhook URLs | Change events you subscribed to. |
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`) | Only if a weather location is set: the **server** fetches the forecast for its coordinates (at most hourly) and looks up place names you search for in Settings → General. Your device's address is not sent; no account or key is used. |
| Google Fonts | Each browser loads the Nunito font from `fonts.googleapis.com` / `fonts.gstatic.com`. |
| The Metropolitan Museum of Art / Lorem Picsum | Only if a display's [quiet-hours screensaver](../using/quiet-hours.md#screensaver) is set to Art or Nature, or it shows the calendar's [Board view](../using/calendar.md#board-view) (nature photos when no screensaver sources are chosen and the family has no photos): that display fetches pictures directly (its IP address, nothing else). Off by default. |

## Shared recipe links

A parent can [share a recipe](../using/meals.md#sharing-a-recipe) as a public link (`/r/…`). Anyone with the link sees that recipe only: its name, photo, description, servings, times, ingredients, steps (and their photos) and source link. The page never includes your family's name, members, ratings, planned meals, meal notes or the recipe's preparation notes, and it asks search engines not to list it. Photos on the page are fetched through your Kinwall, so viewers don't contact the photo's original site; the recipe data in the page (for importing it elsewhere) does name the original photo addresses.

The link's random token (192 bits) is stored in plain form so the same link can be shown again; it isn't in the data export. **Stop sharing** deletes it, and so does deleting the recipe.

## In the browser

Kinwall runs with a strict Content-Security-Policy. Event text from external calendars is shown as plain text, never as HTML. The service worker caches nothing. Each device stores its key and its own preferences (appearance overrides, navigation position, category filter, leaderboard period) in local storage.

See also [Sign-in & security](../using/sign-in-and-security.md).
