# Add to Kinwall from your phone

Share something from any app on your iPhone or Android phone and Kinwall puts it in the right place:

| You share | It becomes |
|---|---|
| A recipe's web page | A recipe in the [recipe library](meals.md) |
| A restaurant's website, a place in Apple Maps, or a photo of a menu | A restaurant in the [binder](meals.md#restaurants) |
| A book's barcode or ISBN, or a photo of its cover | A book in the family's [library](trackers.md#library) |
| A flyer, an invite or a screenshot with a date | An event on the calendar you pick, after you check it |

Links are read by Kinwall, which tells a recipe page from a restaurant's by the details the page publishes for search engines. For a photo or some text, you're asked **What is this?** (Restaurant, Book or Event); Kinwall never guesses what a photo is.

When it's done, you see one line, such as "Imported Lemon chicken", "Added Wool to the library" or "Check the event: Spring fair, Sat May 9 at 10 AM". In the Kinwall app's share sheet, a recipe, a restaurant or a book shows what will be saved first, and nothing is added until you tap **Add to Kinwall** (below). Shortcuts, Siri and the API save it straight away.

* **Recipes** are saved like **Import from a link**. Sharing the same page again updates that recipe.
* **Restaurants** work as in [Add restaurants from your phone](meals.md#add-restaurants-from-your-phone): Kinwall finds the place by name or adds it, fills in only empty details and adds menu items that aren't there yet.
* **Books** with an ISBN (the barcode's number, read off a photo, with or without dashes) are added like **Scan**: looked up on [Open Library](https://openlibrary.org), and a book that's already in the library isn't added twice. Without an ISBN, Kinwall searches Open Library for the title and author and adds the book only when there's one clear match. Otherwise it opens **Add a book** with the title filled in, so you can look it up and pick the right one.
* **Events are never saved without you.** Kinwall reads the title, date, time and place it can find, and a date without a year is the next one coming up. With the Kinwall app, the share sheet shows them for you to fix and add to a calendar right there (below). Otherwise Kinwall opens the new event sheet with them filled in: check them, pick the calendar and who it's for, and tap **Add event**. Anything it couldn't find is left for you. Only a parent's phone adds events.

Meals and Reading have switches in **Settings → General → Features**. While one is off, Kinwall says so ("Meals is turned off in Settings → General → Features") and adds nothing there.

## With the Kinwall app

With the [Kinwall app](https://github.com/JohnDuprey/kinwall-mobile) on your iPhone or Android phone, signed in as a grown-up, there's nothing to set up and no key to make.

### From the iPhone share sheet

In Safari, Maps, Photos, the Camera, or any app with a **Share** button, tap **Share** and pick **Kinwall**. If Kinwall isn't in the row of apps, tap **More** and turn it on.

* **A link or a place in Maps** goes to Kinwall straight away, to be read.
* **A photo or some text** is read on the iPhone first ("Reading the photo…"); nothing leaves the phone for that.
  * **Several photos** work too, up to 10: a menu that's double-sided or doesn't fit in one picture. Select them all in Photos, then **Share → Kinwall**. They're read one at a time ("Reading photo 2 of 3…") and go to Kinwall together, in the order you picked them, as one menu (or one event). The sheet guesses a menu when it can't tell ("Looks like a menu"). If the restaurant is already in Kinwall, its card says so, and only the items that aren't there yet are added.
  * A book's barcode means a book, and it goes straight to the book's card (below).
  * On an iPhone with Apple Intelligence (iOS 26 or later), the on-device model works out what it is and sorts the words into the lines Kinwall reads best. The sheet goes straight to what Kinwall read, under its guess ("Looks like a menu"), with **Not a menu?** to pick Restaurant, Book or Event yourself. An event goes straight to its fields (below), with **Not an event?** under them.
  * Without Apple Intelligence, or when the model isn't sure or takes more than about 20 seconds, the sheet asks **What is this?** (Restaurant, Book or Event) and sends the words as they were read. That works for most covers and menus; busy flyers come out better with the model.
* **A recipe, a restaurant or a book** shows a card with what will be saved, before anything is added: the photo or cover, the name, and a few short lines.
  * A recipe: how many it serves, its number of ingredients and steps, how long it takes and the site it's from.
  * A restaurant: its cuisine, phone, address, and how many menu items and sections were read. One that's already in Kinwall says what's new, such as "Already in Kinwall: 12 new items will be added, 30 are already there."
  * A book: its author, Book or Audiobook, and the shelf it goes on (Auto picks Kids or Grown-ups, as in the [library](trackers.md#library)). One that's already there says "Already in the library."

  **Add to Kinwall** saves it, then the sheet shows Kinwall's one line and closes by itself. The ✕ at the top right closes the sheet without adding anything. When the sheet guessed what a photo is, the card's title says so ("Looks like a menu") and **Not a menu?** (or **Not a book?**) sits under **Add to Kinwall**.
* **An event** shows what Kinwall read, ready to fix in the sheet: **Title**, **Date**, **All day** (on when there's no time), **Starts** and **Ends**, **Place**, and **Notes** (anything else worth knowing, like what to bring, costs or how to RSVP; saved as the event's [notes](events.md#event-notes)). Under them, **Calendar** lists the family's calendars you can add to, starting with the family's [default calendar for new events](../settings/calendars.md#calendars). **Calendar** sits right above **Add to calendar**, which saves it there without opening the app; to add people, a reminder or a repeat, edit the event in Kinwall afterward. The ✕ at the top right closes the sheet without adding anything.
* **Books Kinwall couldn't pick on its own** wait in Kinwall: the sheet says **Open Kinwall to check it**, and the book is there to pick the next time you open the app. An event waits there the same way when there's no calendar this phone can add to (or it's offline).
* **Anything saved** (an event, a recipe, a restaurant, a book) shows Kinwall's one line, such as "Added Spring fair to Family, Sat May 9", and the sheet closes after about 3 seconds unless you touch it. There's no **Open** button on the iPhone: iOS doesn't let a share sheet open its own app.
* A contact still opens the contact review ([Contacts](contacts.md)).

Only a grown-up's phone can add things, on iPhone and Android. On a wall screen or a kid's device, or when the app isn't signed in, the sheet says to open Kinwall and sign in as a grown-up.

### In Shortcuts and Siri

The app adds an **Add to Kinwall** action to the Shortcuts app. It has three settings, all optional:

* **What it is**: **Automatic** (the default), **Recipe**, **Restaurant**, **Book** or **Event**. With Automatic, a link is read by Kinwall; for a photo or text, a book's barcode or Apple Intelligence's guess decides, and otherwise it asks "What is this?".
* **Photos**: one image or several, such as **Shortcut Input**, a photo from **Take Photo**, or the pages of a menu from **Select Photos** with **Select Multiple** on. Several photos go as one menu (or one event).
* **Text or link**: some text, or a web or Maps link.
* **Calendar**: for an event, the calendar to add it to (it starts on the family's default calendar). With a calendar, the event is saved there straight away; without one, the action passes on a link that opens the event sheet filled in, to check first.

It saves straight away, with no card to check first, then shows Kinwall's one line and passes on a link that opens the Kinwall app at what was added (or at what to check), for **Open URLs**. For a share-sheet shortcut of your own, set **Receive** to **Images**, **Text** and **URLs**, add **Add to Kinwall**, and set **Photos** or **Text or link** to **Shortcut Input**.

Add to Kinwall has no Siri phrase, since Siri can't take a photo or text by voice. Use it in a shortcut, or from the share sheet. The app's other Shortcuts actions are listed in [the Kinwall app's Siri and Shortcuts](https://github.com/JohnDuprey/kinwall-mobile/blob/main/docs/WIDGETS-AND-WATCH.md#siri-shortcuts-and-spotlight-app-intents).

### From the Android share sheet

In Chrome, Photos, the Camera, Messages or any app with a **Share** button, tap **Share** and pick **Kinwall**. A small Kinwall sheet opens over the app you're in.

* **A link** goes to Kinwall straight away, to be read.
* **A photo or some text** is read on the phone first ("Reading the photo…"); nothing leaves the phone for that.
  * **Several photos** work as on the iPhone, up to 10: select them in Photos, tap **Share** and pick **Kinwall**. They're read one at a time ("Reading photo 2 of 3…") and go together as one menu (or one event), guessed a menu when nothing else can tell.
  * A book's barcode means a book, and it goes straight to the book's card.
  * The phone picks out dates and times, addresses, phone numbers, websites and ISBNs and passes them to Kinwall as the lines it reads best (such as `Date:`, `Time:` and `Place:` for an event). A time it can't tell is AM or PM is left for Kinwall to read from the words themselves. The first time, it downloads a small language file for this (about 5 MB).
  * On newer phones with Gemini Nano (Google's on-device model, such as recent Pixel and Galaxy phones), the model works out what it is and tidies the words, like Apple Intelligence on the iPhone.
  * The sheet goes straight to what Kinwall read, under its guess ("Looks like a menu"), with **Not a menu?** to pick Restaurant, Book or Event yourself; an event goes straight to its fields. A date with no phone number looks like an event; prices or a phone number with an address look like a menu. When it can't tell, or Gemini Nano is unsure or takes more than about 20 seconds, it asks **What is this?** (Restaurant, Book or Event).
* **A recipe, a restaurant or a book** shows the same card as on the iPhone, with **Add to Kinwall** under it and **Cancel** to close the sheet without adding anything.
* **An event** shows what Kinwall read, ready to fix, with **Calendar** and **Add to calendar** as on the iPhone, plus **Open in Kinwall** to finish it in the app (to add people, a reminder or a repeat).
* **Books Kinwall couldn't pick on its own** open in the Kinwall app to choose.
* **Anything saved** shows Kinwall's one line with an **Open** button (unlike the iPhone's), and the sheet closes after about 3 seconds unless you touch it.
* A contact still opens the contact review ([Contacts](contacts.md)).

Reading photos needs Google Play services. Picking out dates and places, and Gemini Nano, need Android 8 or later; on older phones the sheet asks **What is this?**. There's nothing to turn on.

## Without the app: a shortcut with an API key

No Kinwall app on your phone, or a script of your own? The **Add to Kinwall** shortcut below does the same with a parent API key.

### Before you start: make a parent API key

On a parent's device, open **Settings → Access → API Keys**, tap **New admin key** and copy the key (it's shown once). See [API Keys](../settings/access.md#api-keys). The shortcut sends it with every request; anyone with the key can change your Kinwall, so keep the shortcut on your own phone. Removing the key turns the shortcut off. Wall screens and kids' devices can't use this.

Below, `https://your-kinwall` is your Kinwall address (the one in your browser's address bar) and `YOUR-KEY` is the key.

### Make the shortcut

1. In Shortcuts, tap **+** and name the shortcut **Add to Kinwall**. In its details (ⓘ), turn on **Show in Share Sheet**. At the top, set **Receive** to **Images**, **Text**, **URLs**, **Safari web pages** and **Locations**.
2. **Get Type** of **Shortcut Input**.
3. **If** the **Type** is `Image`: **Extract Text from Image** with **Shortcut Input**, then **Set Variable** `Shared Text` to the **Extracted Text**. **Otherwise**, **If** the **Type** is `Text`: **Set Variable** `Shared Text` to **Shortcut Input**. Close both **If** blocks.
4. **If** `Shared Text` **has any value** (a photo or text):
   1. **Choose from Menu** with the prompt "What is this?" and three items: **Restaurant**, **Book** and **Event**.
   2. In each item, add **Text** with the item's name in lowercase (`restaurant`, `book` or `event`) and **Set Variable** `Kind` to it.
   3. Optional, on an iPhone with Apple Intelligence on iOS 26: in each item, before the **Text**, add **Use Model** (**On-Device** or **Private Cloud Compute**) with that item's prompt below, then **Set Variable** `Shared Text` to the model's **Response**.
5. **Otherwise** (a link or a place): **If** the **Type** is `Location`, **Get Details of Locations** on **Shortcut Input** twice: **URL** (then **Set Variable** `Link`) and **Name** (then **Set Variable** `Place Name`). **Otherwise**, **Set Variable** `Link` to **Shortcut Input**. Close the **If** blocks.
6. **Get Contents of URL** to `https://your-kinwall/api/share`. Tap **Show More**: **Method** `POST`; under **Headers**, add `Authorization` with `Bearer YOUR-KEY` (the word Bearer, a space, then the key); **Request Body** **JSON** with four **Text** fields: `kind` (the `Kind` variable), `url` (`Link`), `text` (`Shared Text`) and `name` (`Place Name`). Fields left empty are fine.
7. **Get Dictionary Value**: **Value** for `summary` in **Contents of URL**, then **Show Notification** with that **Dictionary Value**.
8. **Get Dictionary Value**: **Value** for `link` in **Contents of URL**. **If** it **has any value**, **Open URLs** with it.

To open Kinwall only when there's something to check (an event, or a book to pick), use `review` instead in step 8: **If** `review` is true, **Open URLs** with `link`.

Then share from any app: a page in Safari, a place in Maps, a photo in Photos or the Camera, or text you've selected. Pick **Add to Kinwall**.

### Prompts for Use Model

Put the `Shared Text` variable where each prompt says *Shared Text*. Kinwall reads the lines it asks for and skips the ones the model leaves out.

**Restaurant:** the menu prompt in [From a menu photo](meals.md#from-a-menu-photo).

**Book:**

```
This is text from a photo of a book's cover or back. Answer in exactly this format and nothing else, and leave out any line you can't find:
ISBN: the ISBN, from the barcode's number
Title: the book's title
Author: its author

Shared Text
```

**Event:**

```
This is text from a flyer, an invitation or a screenshot. Answer in exactly this format and nothing else, and leave out any line you can't find:
Title: a short name for the event
Date: its date, like Saturday, May 9, 2026
Time: its start and end time, like 10:00 AM - 2:00 PM
Place: the venue's name and its full street address and town on one line, like The Rivers Residence, 12 Elm Road, Springfield
Notes: anything else worth knowing, like what to bring, costs, or how to RSVP

Shared Text
```

Without the model, Kinwall reads the photo's text as it is: the first line that isn't a date or a time is the title, a line naming a school, park, hall or street is the place, and the other lines worth knowing (what to bring, costs, how to RSVP, a phone number or a link) become the notes. Decoration like "join us to celebrate" is left out. The model does better with busy flyers.

You can send both: the model's lines, then a line with only `---`, then the photo's text as it was read. The model's lines win, with a few fixes from the photo's text (as the Kinwall app does): a `Place` with no street address gets the street line, a `Place` that's only a street gets the "at …" venue line right above it, a `Time` with no AM or PM or no end takes the photo's fuller time for the same start ("3:00 - 5:00pm"), and an RSVP or phone line the model left out of `Notes` is added.

### The restaurant-only shortcut

If you made the older **Add a restaurant to Kinwall** shortcut from [Add restaurants from your phone](meals.md#add-restaurants-from-your-phone), it keeps working; it sends to `/api/restaurants/import`, which hasn't changed. This one does restaurants too, so you can keep either.

### The request

Any script can send the same request:

```
POST https://your-kinwall/api/share
Authorization: Bearer YOUR-KEY
Content-Type: application/json

{ "kind": "event", "text": "Title: Spring fair\nDate: Saturday, May 9\nTime: 10 AM - 2 PM\nPlace: Lincoln Elementary" }
```

To add the event straight away, send `"save": true` and the `calendarId` of a calendar you can add to (from `GET /api/calendars`; leave it out for the family's default calendar, the one marked `"default": true`). The answer's `link` then opens the saved event. Without `save`, an event's answer also has `event` (`title`, `date`, `time`, `end`, `place` and `notes`, as read), and you can send `event` back, changed, instead of `text`.

To check a recipe, restaurant or book before saving it, as the app's share sheet does, send `"preview": true`. Nothing is saved: the answer has `review: true` and `preview` (`title`, `imageUrl`, `exists`, `lines`, `already`, a `token` for a link, and the details for its kind). Send the same request again without `preview` to save it, with `"token"` from the preview for a link so the page isn't read twice.

The answer is always `{ kind, summary, link, review }`. Errors come back as `{ error, summary }`, so the notification still says what went wrong. See [REST API](../integrations/rest-api.md).
