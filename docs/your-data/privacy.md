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

### Health entries

[Health](../using/trackers.md#health-) entries are always encrypted at rest, on every host, with no setting to turn it off. Each entry's **title** and **fields** (type, time, provider, notes, height, weight, temperature, follow-up and its calendar event link) are encrypted with `ENCRYPTION_KEY`, bound to the entry and the column, and stored as `enc:v1:…`. The database, its backups and anyone reading them see only ciphertext. The app and the API show them to the people allowed to see them, exactly as before.

What stays readable in the database, so the list can be filtered and sorted: the entry's ID, that it's a health entry, whose it is (the member, or a removed member's name), its date, and when it was created and changed.

* Entries saved before encryption was added are encrypted after the update, when the server answers its first request. Nothing to do.
* Without an `ENCRYPTION_KEY`, the server refuses to save health entries rather than store them in plain form. Docker and the Home Assistant add-on always have one (see [Configuration](../self-hosting/configuration.md)).
* Health request and response bodies are never written to the server logs.
* Webhooks get only that a health entry changed (its ID and kind), never what's in it.
* Claude and other connected apps (MCP, and a connected app's sign-in on the REST API) can't see or change health entries until a parent turns on **Let connected apps see health entries** in **Settings → Access → Connected apps**. It's off by default. See [MCP server](../integrations/mcp.md#health-entries).
* The [export](export-import.md) is your own backup, so it holds health entries in plain form. Importing it encrypts them again.
* Changing `ENCRYPTION_KEY` isn't supported yet: with a new key, existing health entries (like calendar logins) can't be read. Keep the key with your backups.

### Temp check

[Temp check](../using/snapshot.md#temp-check) answers about **sleep** and **feelings**, and each person's own feelings added with **Other…** (they might name something medical), are health data and get the same treatment as health entries: encrypted with `ENCRYPTION_KEY` (bound to the person, the day and the column), refused without a key, never in the server logs. The **goal** is family content, stored in plain form like a note.

* **Who sees the answers:** the person's own device and parents' devices. A shared wall screen can take answers but shows only that they answered. Another person's device sees only that they answered.
* **Webhooks** get `tempcheck.changed` with the person and the day, never the answers.
* **Claude and other connected apps** get the goal and whether they answered, but not sleep or feelings (or their own feelings list) until a parent turns on **Let connected apps see health entries**. There's no MCP tool for Temp check.
* The snapshot, profiles and push notifications never include sleep or feelings.
* The [export](export-import.md) holds them in plain form (it's your backup); importing encrypts them again.

The **evening goal check** answer and its notes (what helped, what got in the way, next time) get the same treatment as sleep and feelings. The push and the bell's feed say "Did you finish your goal? 🎯" with the goal (family content), never the answer. With **Keep answers in the journal** off, only Yes, Partly or Not today is stored.

### Journal

A person's [journal](../using/journal.md) entries (the words and the mood) are encrypted like health entries: bound to the entry and the column, refused without a key, never in the server logs. Who wrote them and which day stay plain so the journal can list them.

* **Who can open it:** the person's own device and parents' devices. Never a shared wall screen or another person's device.
* **Webhooks** get `journal.changed` with the person, the day and the entry ID, never the words.
* **Claude and other connected apps** get nothing from the journal until a parent turns on **Let connected apps see health entries**. There's no MCP tool for it.
* The [export](export-import.md) holds entries in plain form; importing encrypts them again.

## Stored as one-way hashes (SHA-256)

* API keys, passkey sessions and OAuth access/refresh tokens. Keys are shown once.
* Recovery codes.
* The setup code, and display pairing poll tokens.

## Stored in plain form

Your family's content: member names, events, chores, lists, settings, [trackers](../using/trackers.md) (reading and memories; health entries are encrypted, above) and [photos](../using/photos.md) (stored in the database itself, never sent anywhere else). On Docker that's in `kinwall.sqlite`, and on Workers it's in D1. Protect the host or account accordingly.

### Contacts

[Contacts](../using/contacts.md) hold other people's details: babysitters, grandparents, the pediatrician, a neighbor's phone and address. They're stored in plain form like the rest of your family's content (not encrypted like health entries), so the same care for the host applies. Who sees them:

* Parent devices see every contact. Members' own devices and shared wall screens see only what each contact's **Who can see it** setting allows. A wall screen sees only contacts marked **Show on wall**, and only their phone numbers or address when those wall switches are on. Device keys never get a contact's notes.
* Claude and other connected apps (MCP) read contacts with their own access: one with full access sees every contact, like a parent device. One with everyday access sees what its owner's own device would, or what a wall screen sees when it has no owner.
* Webhooks get only that a contact changed (its ID and what happened), never its details.
* The [export](export-import.md) includes every contact. An imported vCard file isn't kept: the server reads it, you review the contacts, and only the ones you import are saved.

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

A parent can [share a recipe](../using/meals.md#sharing-a-recipe) as a public link (`/r/…`). Anyone with the link sees that recipe only: its name, photo, description, servings, times, ingredients, steps (and their photos) and source link. The page never includes your family's name, members, ratings, planned meals, meal notes or the recipe's preparation notes, and it asks search engines not to list it. Photos on the page are fetched through your Kinwall, so viewers don't contact the photo's original site; the recipe data in the page (for importing it elsewhere) does name the original photo addresses. That data comes twice: as standard schema.org Recipe data for any app, and as a Kinwall copy (a `kinwall-recipe` block) so another Kinwall imports it exactly. Both hold the same recipe fields the page shows, with each ingredient's and step's details; neither has preparation notes, ratings, members, meals, the link's token or your Kinwall's own ids and dates. When you paste the link into a message, the app (iMessage, Discord, Slack and others) fetches the page to show a preview card with the recipe's name, description and photo.

The link's random token (192 bits) is stored in plain form so the same link can be shown again; it isn't in the data export. **Stop sharing** deletes it, and so does deleting the recipe.

## In the browser

Kinwall runs with a strict Content-Security-Policy. Event text from external calendars is shown as plain text, never as HTML. The service worker caches nothing. Each device stores its key and its own preferences (appearance overrides, navigation position, category filter, leaderboard period) in local storage.

See also [Sign-in & security](../using/sign-in-and-security.md).
