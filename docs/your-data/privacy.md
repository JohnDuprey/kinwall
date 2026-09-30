# Privacy & what's encrypted

Kinwall runs on your server or your Cloudflare account. The code includes no analytics or tracking, and your family's data goes nowhere except the calendar providers you connect.

## Encrypted at rest (AES-256-GCM)

These are encrypted with `ENCRYPTION_KEY`, using the row ID as additional data so a blob can't be moved to another row:

* Calendar account credentials: Google/Microsoft refresh tokens and CalDAV passwords.
* The [Google Photos](../using/photos.md#google-photos) sign-in (its tokens, and the one-time code while connecting).
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
* **Private journals:** a grown-up's journal is private by default, and a kid's can be when a parent allows it (see [Private journals](../using/journal.md#private-journals)). A private entry's words, and that day's goal check notes, open only on a device that belongs to that person. Everyone else, parents included, sees the mood and that there's an entry.
* **Webhooks** get `journal.changed` with the person, the day and the entry ID, never the words.
* **Claude and other connected apps** get nothing from the journal until a parent turns on **Let connected apps see health entries**. Even then, never a private entry's words or notes. There's no MCP tool for it.
* The [export](export-import.md) holds entries in plain form, except private ones: their words and goal check notes are left out for everyone, the mood and day stay. Importing encrypts them again, and never overwrites a private entry that's already there.

#### What a private journal protects

A private journal is an access rule in Kinwall, not a lock only you hold a key to.

It keeps your words from:

* the rest of the family: brothers, sisters and the other parent, on their own phones and computers;
* parent devices that don't belong to you, wall screens, and any device that belongs to no one;
* Claude and other connected apps, whatever their settings;
* the export and anything restored from one;
* someone who has a copy of the database or a backup but not the encryption key.

It doesn't keep your words from:

* **whoever runs the server.** On a self-hosted Kinwall, anyone with `ENCRYPTION_KEY` and the database can decrypt every entry. On hosted Kinwall, the operator holds the key the family's key is made from.
* **a parent who sets things up to read it.** Full access can pair a new device as yours or say a phone is yours. Kinwall doesn't prevent that, but it shows every change of whose device something is in the family's notifications, so it can't happen quietly.
* **someone holding your unlocked device.**

Moods, sleep, feelings, whether you answered and goal check outcomes are still seen by parents: that's what keeps Insights and the energy battery working.

### Insights

[Insights](../using/insights.md) are built from Temp check answers, goal checks and journal moods, so they're treated like the journal:

* **Computed on request, never stored.** Nothing new is saved, so there's nothing extra to encrypt, back up or delete: the server opens the encrypted answers, works out the charts and sentences for that one request and forgets them. Journal **words are never read**, only how many entries there were and their mood emoji.
* **Who can open them:** the person's own device and parents' devices (for kids, parents can see them too). Never a shared wall screen (403, and it shows no link) or another person's device.
* **Claude and other connected apps** get nothing (403) until a parent turns on **Let connected apps see health entries**. There's no MCP tool for Insights. Everything is plain arithmetic on the server: no AI writes or reads the insights.
* Never in the server logs, webhooks, the snapshot, profiles or push text. The [export](export-import.md) doesn't include them: they're worked out from data it already has.

### Energy battery

The [energy battery](../using/battery.md) is worked out from sleep and feelings, so it's treated like Insights:

* **Computed on request, never stored.** The only new things saved are the person's on/off setting, for the heads-up push a one-way hash that says a push was handled (not who it was for or which day), and their evening **How drained do you feel?** answers. Those are health data: encrypted with `ENCRYPTION_KEY` like sleep and feelings (bound to the person, the day and the column), refused without a key, and never in the server logs, webhooks or push text. The adjustment they make is worked out each time, never stored.
* **Who can see it:** the person's own device and parents' devices. Never a shared wall screen, the Board, a profile or another person's device.
* **Claude and other connected apps** get nothing (403, and no MCP tool) until a parent turns on **Let connected apps see health entries**.
* **Push text** comes from the calendar and chores only ("Tomorrow looks full: 5 events and a late evening…"), never sleep or feelings, and goes only to the person's own devices. It isn't added to the family's notification feed.
* Never in the server logs, webhooks, the snapshot or the export. The drained answers are in a parent's [export](export-import.md) with the rest of Temp check.

### Medications

[Medication reminders](../using/medications.md) are off until a parent turns them on. A medicine's name, dose, times, weekdays, end (a last day or a number of doses) and how late it can be taken, and each day's log of doses marked taken, skipped or snoozed (when, and on which device), are encrypted like health entries: bound to the row, refused without a key, never in the server logs. Only who the medicine is for and which day a log is for stay plain (the log row's "updated" column holds the day, never the time). For a **When I start my day** medicine, when that person's day started is kept too, since it's when the dose is due; it says when someone woke up, so it's sealed inside that day's log with the rest, kept only on days such a dose is scheduled and only until its latest time, and deleted with the medicine. Reminder bookkeeping stores a one-way hash, not the medicine or the time. Nothing about conditions or diagnoses is asked or kept.

* **Who sees what:** parent devices see everyone's medicines and history and are the only ones that add, change or delete them. A person's own device sees and marks their own (a kid's too). A shared wall screen shows **Take now** cards for whoever is due, as "Meds" unless the family turns on **Show medicine names on shared screens**, and can mark them; it never shows the list or history. Other people's devices see nothing about someone else's medicines, in the app or in the bell's feed.
* **Push text** is generic ("Time for Maya's medicine", "Still time for Maya's medicine (until 8 PM)"; for parents, "Maya's 8:00 AM medicine hasn't been marked yet") unless that device turns on **Show medicine names in notifications on this device**. Push text passes through Apple or Google and shows on lock screens.
* **Webhooks and Home Assistant** get no medication events at all.
* **Claude and other connected apps** get nothing (403, and no MCP tool) until a parent turns on **Let connected apps see health entries**. They can't turn medications on or change its settings either.
* **Snapshots, profiles and share links** never include medicines. A profile only links to the medicines page, on the person's own device and parents' devices.
* The [export](export-import.md) holds medicines and their log in plain form (it's your backup); importing encrypts them again. **Delete all medication data** (Trackers → Health → Medicines → More…) removes every medicine, its log and its notifications. Deleting one medicine removes its log.

## Stored as one-way hashes (SHA-256)

* API keys, passkey sessions and OAuth access/refresh tokens. Keys are shown once.
* Recovery codes.
* The setup code, and display pairing poll tokens.

The [quiet-hours PIN](../using/quiet-hours.md#pin-to-wake) is stored as a salted PBKDF2-SHA256 hash (100,000 rounds). The PIN and its hash never go to any device, webhook or connected app, and never into the server logs or the export. A PIN is only 4 to 8 digits, so the hash alone wouldn't stop someone with a copy of the database from working it out; it's there to keep kids from waking the wall, not to guard secrets.

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
| Google / Microsoft / your CalDAV server | Syncing and writing connected calendars. The calendar sign-in asks only for calendar scopes. |
| Google Photos | Only once a parent [connects Google Photos](../using/photos.md#google-photos): the **server** lists the picked photos (about hourly while a screen shows them) and fetches each picture to pass it to the screen. See [below](#google-photos). |
| ICS feed hosts | Fetching subscribed feeds. |
| Browser push services (Apple, Google, Mozilla) | Notification payloads, encrypted end to end with the device's keys (RFC 8291). |
| Your webhook URLs | Change events you subscribed to. |
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`) | Only if a weather location is set: the **server** fetches the forecast for its coordinates (at most hourly) and looks up place names you search for in Settings → General. Your device's address is not sent; no account or key is used. |
| Google Fonts | Each browser loads the Nunito font from `fonts.googleapis.com` / `fonts.gstatic.com`. |
| The Metropolitan Museum of Art / Lorem Picsum | Only if a display's [quiet-hours screensaver](../using/quiet-hours.md#screensaver) is set to Art or Nature, or it shows the calendar's [Board view](../using/calendar.md#board-view) (nature photos when no screensaver sources are chosen and the family has no photos): that display fetches pictures directly (its IP address, nothing else). Off by default. |

### Google Photos

[Google Photos](../using/photos.md#google-photos) is off until a parent connects it, with its own Google permission (`photosambient.mediaitems`: see the photos picked for a device). Connecting Google Calendar never asks for it, and connecting Photos never touches Calendar: even when both use the same Google app, Photos is its own consent and its own sign-in, stored apart from calendar accounts.

* **What Google sees:** that your Kinwall server is showing the albums you picked on a device named after your family ("Our Family Kinwall"), and your server's address when it asks for the list and the pictures. Displays never contact Google for photos; the pictures pass through your server. Nothing else about your family is sent.
* **What Kinwall stores:** the sign-in, encrypted like calendar credentials, in its own record apart from calendar accounts; Google's ID for the family's Photos device and its album page link; and for each picked photo only its Google ID, the date it was taken, its size and when it was last shown, plus Google's temporary link to it, which stops working within an hour. **Never the pictures:** each one goes straight from Google to the screen, is marked not to be cached, and isn't kept on the server. None of it is in the [export](export-import.md).
* **Who can use it:** parent devices connect, change albums and disconnect. Wall screens and kids' devices can only show the pictures.
* **Disconnect** (in the Night screen sheet) deletes the Photos device in your Google account, cancels the permission and deletes everything above. You can also remove Kinwall under your Google Account's **Security → Third-party apps & services**; screens then stop showing Google Photos and parents see **Reconnect Google Photos**.
* Tokens and codes are never logged or returned by the API.

## Shared recipe links

A parent can [share a recipe](../using/meals.md#sharing-a-recipe) as a public link (`/r/…`). Anyone with the link sees that recipe only: its name, photo, description, servings, times, ingredients, steps (and their photos) and source link. The page never includes your family's name, members, ratings, planned meals, meal notes or the recipe's preparation notes, and it asks search engines not to list it. Photos on the page are fetched through your Kinwall, so viewers don't contact the photo's original site; the recipe data in the page (for importing it elsewhere) does name the original photo addresses. That data comes twice: as standard schema.org Recipe data for any app, and as a Kinwall copy (a `kinwall-recipe` block) so another Kinwall imports it exactly. Both hold the same recipe fields the page shows, with each ingredient's and step's details; neither has preparation notes, ratings, members, meals, the link's token or your Kinwall's own ids and dates. When you paste the link into a message, the app (iMessage, Discord, Slack and others) fetches the page to show a preview card with the recipe's name, description and photo.

The link's random token (192 bits) is stored in plain form so the same link can be shown again; it isn't in the data export. **Stop sharing** deletes it, and so does deleting the recipe.

## In the browser

Kinwall runs with a strict Content-Security-Policy. Event text from external calendars is shown as plain text, never as HTML. The service worker caches nothing. Each device stores its key and its own preferences (appearance overrides, navigation position, category filter, leaderboard period) in local storage.

See also [Sign-in & security](../using/sign-in-and-security.md).
