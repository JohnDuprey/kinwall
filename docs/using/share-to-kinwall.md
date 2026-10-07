# Add to Kinwall from your iPhone

One **Add to Kinwall** shortcut in the Shortcuts app sends whatever you share to the right place in Kinwall:

| You share | It becomes |
|---|---|
| A recipe's web page | A recipe in the [recipe library](meals.md) |
| A restaurant's website, a place in Apple Maps, or a photo of a menu | A restaurant in the [binder](meals.md#restaurants) |
| A book's barcode or ISBN, or a photo of its cover | A book in the family's [library](trackers.md#library) |
| A flyer, an invite or a screenshot with a date | A new event, which you check before it's saved |

Links are read by Kinwall, which tells a recipe page from a restaurant's by the details the page publishes for search engines. For a photo or some text, the shortcut asks **What is this?** (Restaurant, Book or Event); Kinwall never guesses what a photo is.

When it's done, the shortcut shows one line, such as "Imported Lemon chicken", "Added Wool to the library" or "Check the event: Spring fair, Sat May 9 at 10 AM", and opens Kinwall at what was added.

* **Recipes** are saved like **Import from a link**. Sharing the same page again updates that recipe.
* **Restaurants** work as in [Add restaurants from your iPhone](meals.md#add-restaurants-from-your-iphone): Kinwall finds the place by name or adds it, fills in only empty details and adds menu items that aren't there yet.
* **Books** with an ISBN (the barcode's number, read off a photo, with or without dashes) are added like **Scan**: looked up on [Open Library](https://openlibrary.org), and a book that's already in the library isn't added twice. Without an ISBN, Kinwall searches Open Library for the title and author and adds the book only when there's one clear match. Otherwise it opens **Add a book** with the title filled in, so you can look it up and pick the right one.
* **Events are never saved on their own.** Kinwall reads the title, date, time and place it can find and opens the new event sheet with them filled in. Check them, pick the calendar and who it's for, and tap **Add event**. Anything it couldn't find is left for you, and a date without a year is the next one coming up. Only a parent's phone opens the event sheet.

Meals and Reading have switches in **Settings → Features**. While one is off, Kinwall says so ("Meals is turned off in Settings → Features") and adds nothing there.

## Before you start: make a parent API key

On a parent's device, open **Settings → Access → API Keys**, tap **New admin key** and copy the key (it's shown once). See [API Keys](../settings/access.md#api-keys). The shortcut sends it with every request; anyone with the key can change your Kinwall, so keep the shortcut on your own phone. Removing the key turns the shortcut off. Wall screens and kids' devices can't use this.

Below, `https://your-kinwall` is your Kinwall address (the one in your browser's address bar) and `YOUR-KEY` is the key.

## Make the shortcut

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
Place: where it is

Shared Text
```

Without the model, Kinwall reads the photo's text as it is: the first line that isn't a date or a time is the title, and a line naming a school, park, hall or street is the place. The model does better with busy flyers.

## The restaurant-only shortcut

If you made the restaurant shortcut from [Add restaurants from your iPhone](meals.md#add-restaurants-from-your-iphone), it keeps working; it sends to `/api/restaurants/import`, which hasn't changed. This one does restaurants too, so you can keep either.

The Kinwall app for iPhone and Android also has **Kinwall** in the share sheet for recipe links ([Sharing from your phone](meals.md#sharing-from-your-phone)); that opens the import to check before saving, where this shortcut saves right away.

## The request

Any script can send the same request:

```
POST https://your-kinwall/api/share
Authorization: Bearer YOUR-KEY
Content-Type: application/json

{ "kind": "event", "text": "Title: Spring fair\nDate: Saturday, May 9\nTime: 10 AM - 2 PM\nPlace: Lincoln Elementary" }
```

The answer is always `{ kind, summary, link, review }`. Errors come back as `{ error, summary }`, so the notification still says what went wrong. See [REST API](../integrations/rest-api.md).
