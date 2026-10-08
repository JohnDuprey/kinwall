# Meals

The **Meals** tab answers two questions: what are we eating this week, and what do we need to buy? It has a **Week planner**, a **Recipe library** and **Restaurants**, the family's binder of takeout menus. Admins plan and edit; everyone can look.

## Planning the week

The week planner shows the household week (it starts on Sunday or Monday, per [General](../settings/general.md)) with a row per day and a column for **Breakfast**, **Lunch**, **Dinner** and **Snack**. Use the arrows to page through weeks and **This week** to come back. On a phone it opens on **Day**: today as one card with its four slots, the arrows stepping a day at a time and **Today** to come back. Switch to **Week** for the whole week as a card per day.

Tap **+** in a slot (or **Plan meal**) to add a meal. The sheet starts with **What's for dinner?** (or breakfast, lunch or snack): type to find a recipe by name or ingredient and tap it (Enter picks the first one). Not a recipe? Tap **Something else** to plan it by name (like "Leftover soup"; what you typed becomes its name) or **Eating out**. Then the rest of the meal:

* **What are we eating?**: **A recipe** (from the library), **Something else** (just a name) or **Eating out** (like "Pizza place"). Change it here if you picked the wrong one.
* For eating out, **Restaurant** picks a place from the [binder](#restaurants) (its name becomes the meal's name) or **Somewhere else**, and **How** is **Eating there**, **Pickup** or **Delivery**. A night from the binder gets everyone's [orders](#ordering-together).
* **Recipe**: tap it to choose one. The picker opens with a search box (recipe name or ingredient; arrow keys and Enter work too) and lists recipes A to Z with their photo, time and family rating ("★ 4.5"). Archived recipes stay out unless the meal already uses one. Choosing a recipe fills in the meal's name and servings. The meal's sheet doesn't list the ingredients: **Open recipe** shows them, scaled to any number of servings.
* **Meal name**, then **Date** and **Meal** (breakfast, lunch, dinner or snack, filled in from the slot you tapped).
* **Servings**, an optional **Time** ("7:30 PM"; left empty, the meal is at the family's usual time for that meal, shown under the field) and **Cooking** (who's making it). Eating out has only the time: who's eating is who gets asked for their order, and a place that isn't in the binder can have an optional website.
* **Who's eating**: tap family members. Picking people sets **Servings** to how many (you can still change servings). With nobody picked, a note says how many people the servings are for ("2 servings: pick 2 people"); it's only a hint and never stops you saving.
* **Status**: **Planned** or **Cooked** (**Ordered** when eating out). A cooked meal shows dashed. Then **Notes**.

Only recipe meals add to the grocery list; something else and eating out don't.

To trade two meals around, open a planned meal's sheet and tap **Swap with…**, right under the meal's name: it lists the other meals from today through the end of that meal's week, and picking one swaps their days and slots (Tuesday's dinner and Thursday's dinner change places). A calendar event Kinwall made for either meal moves with it; an event you linked yourself stays put.

A slot can hold more than one meal. Tap a meal with a recipe to see the recipe (with **Edit meal** or, for a non-admin, **Meal details** to open the meal sheet); tap a meal without one to open its sheet directly, where you can also delete it. A night out from the [binder](#restaurants) opens its [orders](#ordering-together) instead, with **Edit meal** (parents) for the meal's sheet. A planned meal shows small avatars of who's eating.

Can't decide? Start a [family poll](polls.md) for that meal: it shows **🗳 Vote open** in the slot until it closes, and **Plan it** fills the meal in with the winner.

When the header is filtered to one person, the planner and the Board's **Today's meals** show the meals that person is eating or cooking, plus meals with nobody picked.

## Recipes

The **Recipe library** lists the family's recipes. Search by name or ingredient, filter by ingredient category, or show archived ones. A recipe has a name, description, default servings, how long it takes (total and prep minutes, both optional), instructions, preparation notes, a source link and its ingredients: name, quantity, unit, preparation ("diced"), a quantity note ("15 oz cans") and a category ("Produce").

Tap a recipe to see it: its times, the ingredients (with **−** and **+** to see them for more or fewer servings), the numbered steps, preparation notes and its source link. Admins get **Edit** (the editor, where **More…** next to **Save recipe** also archives or deletes it) and **Plan this meal**, which opens a new meal with the recipe chosen. A kid's device doesn't get **Plan this meal**: a grown-up plans the meals. **Open recipe** in a meal's sheet opens the same view. A wall display sees the view without **Edit**.

A link to `#/meals?recipe=<recipe id>` opens that recipe's view, the same as tapping it in the library (Spotlight and Siri in the phone app use it). An id that doesn't exist just opens Meals.

A recipe with a time shows it as **⏱ 35 min · 10 min prep** in its sheet and the meal's sheet, and as a quiet "35 min" on the recipe card, the planned meal in the week planner and the Board's **Today's meals** card. When the meal has a time, its sheet also says when to start ("Start by 5:25 PM").

### Basics

A **basic** is a recipe for something you make to use in other recipes: a seasoning blend, a sauce, a dough, a stock. In the recipe editor, set **Type** to **Basic** (it's **Meal** otherwise, and every recipe from before basics is a meal). A basic has **Makes** ("about ¼ cup", "2 crusts") instead of default servings, and its view shows "Makes about ¼ cup" with a small **Basic** tag, without the servings buttons: a basic is made as written.

* The library's **Type** filter shows **All**, **Meals** or **Basics**, and a basic's card has a **Basic** tag.
* Basics stay out of meal planning: the meal sheet's recipe picker lists meals only until you switch its **Show** to **Meals and basics** (a prep session, say). A basic already planned as a meal is left out of **Swap with…** the same way.
* An ingredient can be **made from a basic**. In the editor, each ingredient has **Made from a basic** (shown once the family has a basic): tap it to pick one from a list, or **Not from a basic** to unlink it (a long list has a search box), and when an ingredient's name matches a basic Kinwall offers **Link to basic: Taco seasoning** right under the name. Names match in any case and spacing, and words like "blend", "mix" and "homemade" don't count ("Taco Seasoning Blend" matches "Taco seasoning"); when two basics match, nothing is offered.
* In a recipe's view, a linked ingredient's name is a link: tap it to open the basic, and **Back to Tuesday Tacos** returns to the recipe.
* In [cooking mode](#start-cooking), a linked ingredient in **This step's ingredients** has **Make it**, which opens the basic's own cooking mode on top. Closing it (**✕** or **Done**) comes back to the step you were on.
* Deleting a basic, or changing it back to a meal, unlinks the lines made from it; their text stays. Planned meals keep their own copy as usual.
* A basic added after the recipes that use it can catch up once: in its editor, **More… → Link to recipes that use it** links every other recipe's ingredient that names it and isn't linked yet (same matching as above), and says how many it linked. Kinwall doesn't do this on its own when a basic is created or renamed.
* [Adding to the grocery list](#adding-to-the-grocery-list) asks whether a basic is made already.

### Ratings

Everyone in the family can rate a recipe: the recipe's view shows a one-line summary ("★ 4.3 · 3 ratings", or **Rate this recipe** with none yet) that expands to a row for each person with five big stars. On a kid's own device it starts open as **How did you like it?**, with their own row first. Tap a star to rate, tap the same star again to clear it. The family average also shows on the recipe's card in the library (with how many have rated it) and next to its name when you pick a recipe for a meal. **Sort: Top rated** in the library puts the family's favorites first.

Rating is an everyday action like ticking off a chore: a wall display rates for anyone, and so does a grown-up's own phone. A kid's own device, or a wall screen set to one person, rates only for that person. Deleting a recipe or a person removes their ratings. The API's `PUT /api/recipes/{id}/rating` (`{ "memberId": "…", "stars": 1-5 }`, `null` or `0` clears it) and the MCP tool `rate_recipe` do the same.

### Steps and cooking along

A typed recipe's instructions show as a numbered list, one line per step. An imported recipe (or one with steps added through the API) has structured steps instead: each is a numbered card with the step's title (when it has one) as a small heading, its text and its short instructions as bullets, and the step's photo when it has one, beside the text when there's room and above it on a phone. A photo that can't be loaded just isn't shown.

Tap a step when it's done: it dims with a check, so you can see where you are while cooking. Tap it again to undo it, or **Reset** to clear them all. The checks are only kept while the recipe is open, on that screen; closing it starts fresh next time. With a keyboard, Tab to a step and press Space or Enter.

### Start cooking

A recipe with steps has a **Start cooking** button near the top of its view. It fills the screen with one step at a time in big type you can read across the kitchen, with the step's photo when it has one and **Step 2 of 7** above it. **Next** and **Back** move between steps (so do swiping left and right, and the arrow keys); the last step has **Done**, and **×** leaves. A typed recipe's instructions become one step per line (or per sentence, for a single paragraph).

**This step's ingredients** lists the ingredients the step mentions, right under the step's photo (above the step's text when it has no photo), so they're in view without scrolling, for the servings you picked in the recipe view. **All ingredients** shows the whole list without leaving the step.

A step's title shows above its text. When a step comes with its own timers (an imported meal kit's "Chicken · 25 min"), those are its timer buttons, named. Otherwise, when a step mentions a time ("10 minutes", "1 hour", "5-7 min"), tap its timer to start it; for a range, the timer runs to the shorter time so you can check. Running timers stay in a bar at the top as you move between steps, and you can run several at once. They're the same [timers](timers.md) as the header's: each has **Pause**, **Reset** and **×**, they ring with a red banner and a beep until you tap **OK**, and they keep running (and ring) after you close cooking mode, with the time left on the header's timer button.

In the Kinwall app for iPhone, a running timer is also a Live Activity on the Lock Screen and in the Dynamic Island: the recipe, the timer's name and step, and a countdown ("+1 more" when several are running). When it's up it says "Done: Rice", and it goes away when you tap **OK**. A paused timer isn't on the Lock Screen until you resume it.

The screen stays on while you cook. Kinwall remembers which step you were on for each recipe on this device, so the button says **Resume cooking · step 4** next time; **Start over** goes back to step 1, and **Done** forgets it.

In the recipe editor, a recipe with structured steps edits them as a list: each step has its text and its bullets (one per line), **Move up**, **Move down** and **Remove step**, and **Add step** adds one at the end. **Remove photo** drops a step's photo. A recipe with plain instructions keeps the one **Instructions** box.

Amounts read the way a recipe prints them: "½ cup", "1½ cups", "2 ounces". Units that are abbreviations (oz, tsp, tbsp, lb, g) stay as they are.

### Recipe links

The meal and recipe sheets show their links as rows:

* **Open recipe** (in a meal's sheet) opens the recipe in the app.
* **Recipe card (PDF)**, when the source link is a PDF (like a meal kit's recipe card), opens the card in the app: every page, fit to the screen's width, scrolling down. **+** and **−** zoom (double-tap zooms too), and **Open in browser** opens the original link. If the card can't be shown (the site is down, or the link isn't really a PDF), the viewer says so and offers **Open in browser**.
* **Recipe website** (or **Website** for dining out) opens any other source link in the browser, with the site's name under it.
* **Linked calendar event** opens the meal's event in the calendar.

To show a recipe card, the Kinwall server fetches it from the recipe's own source link: only public `https` addresses, a PDF of at most 15 MB. A recipe website is only read when you import it (see [Import from a link](#import-from-a-link)).

### Recipe photos

An imported recipe usually comes with a photo. It shows at the top of the recipe, on its card in the library, as a small picture on the planned meal in the week planner and the Board's **Today's meals** card, and beside the ingredients in the meal's sheet. A recipe without a photo (or whose photo can't be loaded) just shows no picture. In the recipe editor, **Remove photo** drops it; you can't upload your own photo yet.

Like recipe cards, photos are fetched by the Kinwall server from the recipe's own image link: only public `https` addresses, a JPEG, PNG, WebP or GIF of at most 8 MB, and your browser keeps a private copy for a week.

When you plan a recipe, the meal keeps its own copy of the ingredients. Editing, archiving or deleting the recipe later doesn't change meals already planned. To pick up the recipe's changes, tick **Refresh from the current recipe when saving** in the meal's sheet.

### Sharing a recipe

To send a recipe to someone outside the family, open it and tap **Share recipe** (parents' devices only). Kinwall makes a link like `https://your-kinwall/r/…` (your Kinwall address) and shows it with **Copy link** and, on phones and tablets, **Share**. Tapping **Share recipe** again shows the same link.

The link opens a simple page that works in any browser, no Kinwall needed: the recipe's name, photo, description, servings (or, for a basic, how much it makes) and times, ingredients (amounts as in Kinwall, like "1½ cups"), numbered steps (with their photos) and its source link, with "Shared from Kinwall" at the bottom (linking to kinwall.family). It follows the viewer's light or dark setting, and printing it leaves out the save form. Recipe apps and websites that read recipe links can import it too (with the standard recipe data: ingredients as lines of text, and steps with their titles and photos). Under the recipe, **Save to my Kinwall** asks for the other family's Kinwall address (like `theirfamily.kinwall.family`, or their own server's), then opens their Kinwall's **Import from a link** with the recipe ready to save. The browser remembers that address for next time.

The page shows the recipe and nothing else: never your family's name, who's in it, ratings, planned meals, meal notes or the recipe's preparation notes. Search engines are asked not to list it, and the link is long and random, so it can't be guessed.

**More… → Stop sharing…** turns the link off for everyone who has it (a copy someone already saved stays theirs). Sharing again later makes a new link. Deleting the recipe also turns its link off. Links aren't part of your data export.

## Import from a link

Most recipe websites describe their recipes in a standard, machine-readable form (schema.org Recipe data) alongside the page, and Kinwall can read it. In the **Recipe library**, an admin taps **Import from a link**, pastes the page's address and taps **Get recipe**. Kinwall shows what it found before saving anything:

* The name and servings, which you can change here.
* Its times and the website's name, the description, and **N ingredients** and **N steps**, which open to show them.
* A note for anything missing ("No servings found", "No steps found"). A recipe without servings is saved for 4.
* The photo isn't shown yet: it appears once the recipe is saved.
* When you already have a recipe from that address, **This updates your recipe “…”** at the top, and the button says **Update recipe**.

**Save recipe** adds it to the library and opens it. Ingredient lines are split into amount, unit and name the same way as other imports (see [Importing recipes](#importing-recipes)); section headings in the steps ("For the sauce") go in front of their first step. A step keeps its title when the site gives it one (not when the title just repeats the step's first words) and its own photo (`https` only), and a step written as several lines stays one step, with the lines as its bullets. Importing the same page again updates that recipe instead of adding a copy (so it replaces edits you made to it). A page says its own address, so a page could claim another recipe's; that's why the preview names the recipe it will update. To keep that recipe as it is, tap **Save as a new recipe** under the note: the new one keeps the source link and photo but isn't tied to the address, so importing the page again still updates the older one. The recipe's source link is the page, and its photo comes from the site like any recipe photo.

A link someone [shared from their Kinwall](#sharing-a-recipe) comes through exactly as they have it (a basic stays a basic, with how much it makes; an ingredient made from a basic links to your basic of the same name, if you have one): each ingredient's amount, unit, name, quantity note, preparation, category and whether it comes in the kit, and each step's title, text, bullets, timers and photo. Its source link is the recipe's original source (or the shared link, when it had none). Their preparation notes, ratings and meals never come along, because the page doesn't have them.

A few things to know:

* Only public `https` pages are read (an `http://` link is tried as `https://`), at most 3 MB, following up to 3 redirects, each one checked. A self-hosted server with `ALLOW_PRIVATE_FEED_URLS=1` can also read pages on the home network.
* Some sites block servers from reading their pages, and some pages don't include recipe data at all (a blog post with the recipe only in its text). Then Kinwall says **This page has no recipe data Kinwall can read. Paste the recipe text instead.**

### Paste the recipe text instead

**Paste the recipe text instead** (under the link, and after an error) swaps the link for a text box. Paste or type the recipe:

```
Grandma's pancakes
Serves 4

Ingredients
2 cups flour
1 1/2 cups milk

Directions
1. Mix.
2. Cook on a hot griddle.
```

The first line is the name. A line that says **Ingredients** starts the ingredients, one per line (leading bullets are dropped). A line that says **Directions**, **Instructions**, **Method** or **Steps** starts the steps, one per line or paragraph (numbers like "1." or "Step 2:" are dropped). A "Serves 4" line before the ingredients sets the servings. Headings may end with a colon. **Read recipe** shows the same preview as a link, then **Save recipe**. If you had typed a link first, it's kept as the recipe's source link. **Use a link instead** switches back.

### Sharing from your phone

To save a recipe straight from the share sheet without checking it first, use the [Add to Kinwall](share-to-kinwall.md) shortcut.

In the Kinwall app for iPhone, share a recipe page to Kinwall: in Safari (or any app with a Share button), tap **Share** and pick **Kinwall**. The recipe is saved there and then, and the sheet says so ([Add to Kinwall from your phone](share-to-kinwall.md#with-the-kinwall-app)). If Kinwall isn't in the share sheet's row of apps, tap **More** and turn it on.

In the Kinwall app for Android, share a recipe page from Chrome (or any app with a Share button) and pick **Kinwall**. The recipe is saved there and then, and the sheet says so ([Add to Kinwall from your phone](share-to-kinwall.md#from-the-android-share-sheet)).

Any browser can do the same with a link to `#/recipes/import?url=<the page address, URL-encoded>` on your Kinwall address. Importing is for parents' devices: on a wall screen or a child's device the sheet says **Ask a grown-up to import this recipe**.

## Importing recipes

Recipes can come in from a website (above) or from another app instead of being typed. The [Home Assistant integration](../integrations/home-assistant.md#meal-kits) has a ready-made blueprint that imports each week's HelloFresh box (through the [HelloFresh integration](https://github.com/kedube/ha-hellofresh) for Home Assistant by Katherine Dubé) and plans the meals as dinners from delivery day on. Anything else can call `POST /api/recipes/import` (admin) or the MCP tool `import_recipe`.

* An imported recipe remembers where it came from (`source`, like `hellofresh`, and that app's own id). Importing it again updates the same recipe instead of adding a copy, so edits you make to an imported recipe are replaced the next time it's imported.
* Ingredient lines like "1.5 tablespoon Sour Cream", "½ cup Rice" or "2 unit Garlic Clove" are split into amount, unit and name. Anything Kinwall can't read stays in the name.
* An ingredient whose name matches one of your [basics](#basics) links to it, with the same matching as the editor's **Link to basic** ("Taco Seasoning Blend" links to "Taco seasoning"; a name two basics share, or an archived basic, doesn't). Importing again keeps a link you made by hand.
* Ingredient lines that repeat the unit abbreviated ("1 teaspoon (tsp) Cooking Oil") drop the abbreviation.
* Ingredients that ship in the box get the quantity note **in the kit**, shown as an **In the kit** tag. They're on the recipe, but grocery lists leave them off unless you tick them (see below). What you supply yourself (oil, salt, butter) goes on the list like any other ingredient.
* `imageUrl` is the recipe's photo (see [Recipe photos](#recipe-photos)); importing again without one keeps the photo it has.
* Steps become the recipe's structured steps (see [Steps and cooking along](#steps-and-cooking-along)). A step can be text, where a step of several lines (the way a meal kit writes several short instructions in one step) becomes a step of bullets, or `{ text, bullets, imageUrl, title, timers }` with the step's own photo, a short heading and its timers (`[{ name, minutes }]`, `name` may be `null`). Importing again without `steps` keeps the ones it has; `"steps": []` clears them.
* The recipe card link is the recipe's source link (a PDF card opens in the app), and `prepMinutes` / `totalMinutes` are its times.
* With a date and slot it's also planned, unless that slot already has a meal. Then nothing is planned and the answer says why (`planned: false`), so an automation can try the next night. Importing again finds the meal it planned before for that slot in the same week, even if you moved it to another night, and doesn't plan it twice.

## Restaurants

**Restaurants** is the family's binder of the places you order from or eat at. Each card shows the name, the cuisine, how many items are on its menu and how many are family favorites. Search finds a place by name, cuisine or anything on its menu ("lo mein"); **Show** lists archived places too.

Tap a restaurant to open it:

* Buttons for what it has: **Call** (dials its phone), **Order online** (its ordering page), **Website** and **Map** (a Google Maps search for its address).
* **★ Favorites**: the menu items the family starred, pinned above the menu. Parents tap the ☆ next to any item to star it (or ★ to unstar it); it's one star for the whole family.
* The full menu by section, in the order the sections come, with prices and short descriptions. A longer menu has a row of its sections at the top: tap one to jump to it. An item with sizes or choices ("Single $8.99 · Double $11.99") shows them in its description instead of one price. Prices are only shown, never added up.
* **Coming up**: nights planned from here, today on ("Friday dinner · 6:00 PM, Pickup · 3 of 4 orders in"), each opening its meal. Parents also get **Plan a night here**, a new dining-out meal from this place.
* Avatars beside a favorite show who had it last time.
* Notes ("Cash only", "Ask for the crust well done").

Parents add a place with **New restaurant** and change it with **Edit**; **More…** archives (or restores) or deletes it. Wall screens and kids' devices can look but not change the binder.

### Adding the menu

In the editor, **Add item** adds one item at a time: its name, section ("Pizza", "Sides"; a new item starts in the section above it), price, a short description and **★ Family favorite**.

Or paste the whole menu in **Paste a menu** and tap **Add these items**:

* One item per line, with the price at the end: `Large cheese 14.99`, `Pepperoni $16`, `Fries ... 3.25`.
* Several prices keep the first as the item's price and all of them at the start of its description: `Garlic knots (6) $5.10 | (12) $9.20` reads "(6) $5.10 · (12) $9.20", `Classic burger $9.35 (Single) | $12.45 (Double)` reads "Single $9.35 · Double $12.45".
* A line under an item that reads like a description (it starts in lowercase, lists things with commas, or is a sentence) is that item's description, however many lines it takes. `Name $9 — what's in it` works too.
* A heading starts a section: a common one (`Desserts`, `Kids Menu`), a short line over items, a line ending in a colon (`Sides:`) or `Section: Pizza`. A heading with prices (`Specialty Pizza 10" $15.55 | 14" $20.70`) gives them to its items that have none.
* A price alone on the next line belongs to the item above it, which is how text copied off a photo often comes out.
* A price is `$12.45`, `12.45` or `+$5.00` (an add-on), or a plain number at the end of an item's line (`Cheese 12`). Numbers run into letters (`+8t` off a mailing label) are never prices.
* An item's name over two lines right under a heading (`Jumbo Chocolate`, then `Chip Cookie $2.25`) is one item, and a heading misread by one letter (`Pasias`) is spelled right (`Pastas`).
* Add-ons and sides to swap (`Sub French Fries $1.75`, `Add Ons: Bacon $2.00`, an "Add Protein" box) go together in an **Add-ons** section at the end, each saying what it goes with ("For Burgers and Wraps").
* Coupons and deals, opening hours, phone numbers, web addresses and mailing labels are left out.

The items are added below the ones you have, so you can check and fix them before **Save restaurant**. For a paper menu, take a photo and copy its text (Live Text on an iPhone or iPad, Google Lens on Android), then paste it. Or send the photo to your family assistant: through [MCP](../integrations/mcp.md) it can read the menu off the photo and add it with `import_restaurant`. Or add it from your phone with a [shortcut](#add-restaurants-from-your-phone).

### Fill in from website

Type or paste the restaurant's address in **Website** and tap **Fill in from website**. Kinwall reads the details the site publishes for search engines (its name, cuisine, phone, address and menu link) and fills in whichever of those are still empty, for you to check. Nothing is saved until you tap **Save restaurant**, and nothing you typed is changed. Not every site publishes these details; when one doesn't, Kinwall says so and you fill them in by hand. An Apple Maps link works too: Kinwall takes the place's name and address from the link.

### Add restaurants from your phone

With the Kinwall app on your iPhone or Android phone, share a menu photo, a place in Maps or the restaurant's website to **Kinwall**: no shortcut or key needed ([Add to Kinwall from your phone](share-to-kinwall.md#with-the-kinwall-app)). Without the app, the [Add to Kinwall](share-to-kinwall.md) shortcut does all of this and more (recipes, books and events) in one shortcut, so new families can skip the rest of this section. The older restaurant-only shortcut below, **Add a restaurant to Kinwall**, still works.

The **Add a restaurant to Kinwall** shortcut in the Shortcuts app adds a place from the share sheet: a photo of a paper menu, a place in Apple Maps, or the restaurant's website. It sends whatever it has to Kinwall, which:

* Finds the restaurant in the binder by name (capitals, spaces and punctuation don't matter: "corner slice!" is **Corner Slice**) or adds it.
* Fills in only the details that are still empty (cuisine, phone, address, website, ordering link, menu link), so it never changes what a parent typed.
* Adds the menu items to their sections, skipping any item whose name is already in the same section. A section's items stay together, even when a heading comes back on another page ("Pizza (continued)"). So you can send a long menu all at once or one page at a time. Items already there, and their stars, stay as they are.
* Answers with one line for a notification, such as "Added 23 items to Corner Slice" or "Added 4 items to Corner Slice (19 already there)".

**Before you start: make a parent API key.** On a parent's device, open **Settings → Access → API Keys**, tap **New admin key** and copy the key (it's shown once). See [API Keys](../settings/access.md#api-keys). The shortcut sends it with every request; anyone with the key can change your Kinwall, so keep the shortcut on your own phone. Removing the key there turns the shortcut off.

In each recipe below, `https://your-kinwall` is your Kinwall address (the one in your browser's address bar) and `YOUR-KEY` is the key. **Get Contents of URL** is set up the same way each time:

1. Tap **Show More**. **Method**: `POST`.
2. **Headers**: add `Authorization` with the value `Bearer YOUR-KEY` (the word Bearer, a space, then the key).
3. **Request Body**: **JSON**, then add each field the recipe lists as a **Text** field.

Each recipe ends the same way, to show what happened: **Get Dictionary Value** (**Value** for `summary` in **Contents of URL**), then **Show Notification** with that **Dictionary Value**.

#### From a menu photo

1. New shortcut, named **Add a restaurant to Kinwall**. In its details (ⓘ), turn on **Show in Share Sheet**; at the top, set **Receive** to **Images**.
2. **Extract Text from Image** with **Shortcut Input**.
3. Optional, on an iPhone with Apple Intelligence on iOS 26: **Use Model** (**On-Device** or **Private Cloud Compute**) with this prompt, putting the **Extracted Text** variable where it says *Extracted Text*:

   ```
   This is text from a photo of a restaurant menu. Answer in exactly this format and nothing else, and leave out any line you can't find:
   Name: the restaurant's name
   Cuisine: the kind of food, like Pizza or Thai
   Phone: its phone number
   Address: its address on one line
   Website: its website, only when the text shows it
   Menu:
   then the menu, with names, prices and descriptions copied from the text. Write each section of the menu as a line "Section: " and its name, with its prices when the heading shows them, like "Section: Specialty Pizza 10" $15.55 | 14" $20.70". Under it, write each item on one line: its name, all of its prices with their sizes or counts, then " — " and its description when it has one, like "Garden Salad $9.10 Small | $12.50 Large — Lettuce, tomato, cucumber". Leave out coupons, promotions, hours, phone numbers and addresses.

   Extracted Text
   ```

4. Without step 3, add **Ask for Input** (**Text**, prompt "Restaurant name?"), because a menu photo's text usually doesn't say which restaurant it is.
5. **Get Contents of URL** to `https://your-kinwall/api/restaurants/import` with the field `menuText` set to the model's **Response** (or, without step 3, to the **Extracted Text**), plus `name` set to **Provided Input** if you added step 4.

Share a menu photo from Photos (or take one in the Camera, then share it) and pick **Add a restaurant to Kinwall**. Kinwall reads the `Name:`, `Cuisine:`, `Phone:`, `Address:` and `Website:` lines at the top of the model's answer and the menu below them, the same way **Paste a menu** does. The on-device model can take a long time to rewrite a whole menu; **Private Cloud Compute** is quicker, or skip step 3 and send the **Extracted Text**, which Kinwall reads well on its own. For a menu with several pages, or one that doesn't fit in one picture, the [Kinwall app](share-to-kinwall.md#with-the-kinwall-app) takes several photos at once: pick them all in Photos, then **Share → Kinwall**. With this shortcut, share them one at a time: each adds the items that aren't there yet.

#### From a place in Apple Maps

1. New shortcut (or a second one, such as **Add place to Kinwall**). Turn on **Show in Share Sheet** and set **Receive** to **Locations** and **URLs**.
2. **Get Details of Locations** four times on **Shortcut Input**, one for each of **Name**, **Address**, **Phone Number** and **URL**. These are the details Shortcuts lists for a location; if yours doesn't list **Address**, use **Street** and **City** instead and put them together in a **Text** action.
3. **Get Contents of URL** to `https://your-kinwall/api/restaurants/import` with the fields `name` (the **Name**), `address` (the **Address**), `phone` (the **Phone Number**), `website` (the **URL**) and `url` (**Shortcut Input**).

In Maps, open the place, tap **Share** and pick the shortcut. When the shared link is an Apple Maps link, Kinwall takes the place's name and address from it if they're there, without visiting Maps. A Maps link is never saved as the restaurant's website.

#### From a link

1. New shortcut (or a third one). Turn on **Show in Share Sheet** and set **Receive** to **URLs** and **Safari web pages**.
2. **Get Contents of URL** to `https://your-kinwall/api/restaurants/import` with the field `url` set to **Shortcut Input**.

On the restaurant's website in Safari, tap **Share** and pick the shortcut. Kinwall reads the details the site publishes, as **Fill in from website** does, and saves the link as the website when the site doesn't name one. If the site has none of these details, Kinwall needs a name: add **Ask for Input** and send it as `name`.

To keep all three in one **Add a restaurant to Kinwall** shortcut, set **Receive** to **Images**, **Locations**, **URLs** and **Safari web pages**, add **Get Type** of **Shortcut Input**, and put each recipe's steps inside **If** blocks: **If** the type is `Image`, the photo steps; **Otherwise**, **If** it's `Location`, the Maps steps; **Otherwise**, the link steps.

#### The request

The shortcut sends one request. Any script can send the same:

```
POST https://your-kinwall/api/restaurants/import
Authorization: Bearer YOUR-KEY
Content-Type: application/json

{ "name": "Corner Slice", "cuisine": "Pizza", "phone": "555-0100",
  "menu": [{ "section": "Pizza", "name": "Large cheese", "price": "$14.99" }] }
```

Every field is optional, but Kinwall needs a name from `name`, the `Name:` line in `menuText`, the website or the Maps link; without one it answers 400 with "Kinwall needs the restaurant's name". Prices can be `"$12.99"`, `"12.99"`, `"12"` or `12.99`. The answer is `{ restaurant, created, filled, added, skipped, summary }`. See [API and MCP](#api-and-mcp).

## Ordering together

A night out from the binder collects everyone's order before someone calls it in. Tapping it (in the week planner, the Board's **Today's meals**, a person's day or the restaurant's **Coming up**) opens its order view: the restaurant, when ("Friday, Oct 9, dinner at 6:00 PM"), how (**Pickup**, **Delivery** or **Eating there**), its notes, and the orders. **Edit meal** (parents) opens the meal's full sheet; **Cancel** there comes back to the orders. Its calendar event's page, when it has one, shows the same, with **Edit meal** too.

* **Orders** shows how many are in ("3 of 4 orders in"), who it's still waiting on ("Still waiting on Maya.") and the order as the caller reads it: the same item added up with who it's for ("2 × Large cheese pizza: Sam, Leo"), each with a box to tick while you read it out (ticks are only on that screen and clear when it closes), then everyone's notes. **Call** dials the restaurant, **Order online** opens its ordering page and **Copy order** copies the whole order as text, for an ordering page's notes field or a message. The sheet stays open while you're on the phone, so switching back from the call lands on it.
* **Add orders** (or **Change orders**) lists who's eating (everyone, when nobody is picked), each with their order and note. Tap a person to fill in theirs:
  * Tap menu items to add them: favorites first, a row of sections to jump to, and **Find on the menu**, which stays at the top as you scroll. Each tap says what it added ("Added: Garlic knots (6)"), and the item shows how many are in ("✓ 2 added").
  * An item with sizes or choices has a button for each, with its price: **Single $8.99**, **Double $11.99**. The order says which ("Classic burger (Double)").
  * In the order at the top: **−** and **+** for how many, a **Note for this item** ("No onions"), and **Add-ons for** the item when the menu's Add-ons section has some for its section: tap **+ Bacon** to put it in the item's note, so it's read out with the item. Add-ons can still be added on their own from the menu.
  * **Something else** (at the bottom), or **Add "…" anyway** when a search finds nothing, adds what isn't on the menu. **Note for the whole order** is for the person's whole order ("I'll share with Leo").
  * **↺ Same as last time** (or **↺ Usual** in the list) fills in the person's last order from this place in one tap. **Save order** saves it; **Cancel** with changes asks before leaving them behind.
* On a shared wall anyone can enter anyone's order, by tapping that person. A kid's own device shows **Add my order** first, goes straight to their own order (and back to the night when they save or cancel) and can't change anyone else's; it doesn't show Call, Order online, Copy order or the tick boxes.
* **Ask for orders** (parents) sends who's eating a notification in the bell and on their phones, "Corner Slice, Friday dinner: what do you want?", that opens the order sheet. Nothing is sent until a parent taps it. A family can ask 10 times an hour at most.
* **Mark ordered** (parents) sets the meal to **Ordered**: from then on only parents' devices can change an order. **Open orders again** undoes it.

The week planner and the Board's **Today's meals** show how and how many orders are in ("Pickup · 3 of 4 orders in"), then **✓ Ordered**.

## Scaling servings

Change a meal's servings and its ingredients scale with it: a recipe for 4 with 2 cups of flour needs 1 cup for 2 servings. Counts ("12 tortillas") and measures (cups, tbsp, lb, g and so on) scale; "1 dozen" counts as 12.

Some amounts don't scale, and Kinwall shows them as they are with **Check amount for 6 servings (recipe: 4)**:

* containers and handfuls: cans, jars, packages, bunches, pinches, handfuls;
* anything with a quantity note ("15 oz cans"), or no quantity at all ("to taste").

## Adding to the grocery list

**Groceries** (admins) adds up the ingredients of every recipe meal in a date range, the planner's week by default:

1. Pick the range and a grocery list. Only [Groceries lists](lists.md#list-types) can take ingredients (not Shopping lists like the hardware store). If you have just one, it's already chosen; with several, Kinwall picks the one this device used last. The preview shows each ingredient's total, which meals it's for, and any item already on that list with the same name.
2. Untick what you already have (salt, rice in the pantry). Meal-kit ingredients that ship in the box (**in the kit**) start unticked.
3. Tap **Add … items to list**. Optionally, each new item gets a note with the meals it's for.
4. When some of the meals use a [basic](#basics) you make yourself, one sheet asks **Made already?** with a choice for each basic ("Taco seasoning: made already?"): **Made already** leaves it off the list, **Add its ingredients** (the default) adds what goes into it instead of the basic itself, as its recipe writes it (not scaled), once for the whole range even when several meals use it, each with a note saying which basic it's for. Unticking a basic in the preview skips the question for it. Once its ingredients are on the list, adding the range again doesn't ask or add them again.

New items land where your family keeps them: the store, aisle and department [remembered](lists.md#remembered-places) for that ingredient, or the recipe's category as the department when there's nothing remembered yet. A department that matches one of a store's aisles [puts the item in that aisle](lists.md#departments-fill-in-aisles) on a trip. On the list, each one says which meals it's for ("For Taco night"). Checking out a grocery run just clears the items; your meals don't change.

Kinwall remembers which meal's ingredient went to which list. Adding the same week again, or an overlapping range, only adds what hasn't been added yet, so nothing is duplicated, and items already on the list are never rewritten. If a meal changes after its ingredients were added (more servings, a new date), the preview marks it as changed so you can adjust the list by hand.

## The calendar

A meal can have one calendar event. Tap **Add to calendar** in its sheet (**Manage calendar event** once it has one).

**Add to a calendar** puts the meal on the calendar you pick:

* The list has every calendar this device can add events to: the ones on Kinwall first, then synced Google, Outlook and CalDAV calendars, each with its color. The first time, a Kinwall calendar is picked; after that, this device remembers the one you used last. With no Kinwall calendar yet, **A new "Meals" calendar on Kinwall** makes one.
* Kinwall only writes to a synced calendar when you pick it here (or name it in a [meal-kit import](#importing-recipes)). The event then shows up in Google or Outlook too, like any event you add in Kinwall.
* The event is titled like "Dinner · Tuesday Tacos". It's at the meal's time, or the family's usual time for that meal when the meal has none (set in [Settings → Family → Meals](../settings/family.md#meals); 6:00 PM for dinner unless you change it). Events are always timed, never all-day.
* It lasts as long as the recipe takes (its total time), or an hour when that isn't known.
* **When**: **At the meal time** (the default) starts the event when you eat. **Start the event when cooking starts** starts it the recipe's total time earlier, so it ends when you eat. The sheet shows the times before you add it.
* Its people are who's eating plus who's cooking, and the meal's notes become its description.

**Start prep by.** Where other events count down to leaving, a meal's event counts down to starting the cooking: "🍳 Start prep by 5:15 PM" on the Board, Now / Next, the calendar and a person's day, and in [transition reminders](../settings/family.md#transition-reminders) ("Quick one: Tuesday Tacos prep in 15 min. Wash your hands ⏲️", or with the recipe's first step: "Okay, time to cook Tuesday Tacos now. Brown the beef 🍅"). The time is the meal time minus the recipe's total time, or its prep time when it has no total, or 30 minutes when the recipe has neither (or the meal has no recipe). An event that starts when cooking starts is already at that time. It's for the meal's cook when one is set, otherwise for the event's people, and it never adds travel time. This works for an event you linked to a meal yourself too. The API has it as `prepAt` and `cookId` on `GET /api/events`.

**On the calendar.** A meal's event shows 🍽️ before its title, and a ✓ once the meal is **Cooked** or **Ordered** ("6:00 PM · ✓ Cooked" in the week and day grids, just 🍽️✓ in a month cell); an order night shows "3 of 4 orders in" in the Day view, the Schedule and on its event's page until it's ordered. See [Meals on the calendar](calendar.md#meals-on-the-calendar). The API has it as `meal` on `GET /api/events` (`status`, `mealKind`, `restaurantId`, `eaterCount`, `orderCount`), so the calendar doesn't ask for each meal.

An event Kinwall made follows the meal, on whichever calendar it's on. Saving the meal with a new day, slot, time, title, notes or people updates the event, and deleting the meal deletes it. If you wrote your own description on the event, changing the meal's notes leaves it alone. If a synced calendar refuses the change (the account needs reconnecting, say), the meal isn't saved and the sheet says why; **Unlink** the event first if you want to change or delete the meal without it.

**Or link an event you already have** attaches an existing event from any calendar. Kinwall never changes or deletes an event you linked. **Unlink (keep the event)** detaches either kind; an event Kinwall made stays on the calendar and stops following the meal.

## On the wall and in someone's day

* The Board has a **Today's meals** card, with the next one marked and who's eating. Tapping a meal opens it right there, the same sheet as tapping it in the week planner, and closing it leaves you on the Board.
* A person's day (tap their avatar) lists today's meals, which open the same way over their day, and tomorrow's in **Tomorrow at a glance**. See [Daily & weekly snapshot](snapshot.md).
* The morning summary includes the day's meals. See [Notifications](notifications.md).
* **Ask Siri** in the Kinwall app for iPhone: "What's for dinner in Kinwall?" says tonight's dinner ("Dinner tonight is Tacos, at 6:00 PM."). On an order night it says the restaurant and how ("Dinner tonight is pickup from Pizza Palace."). With no dinner planned, it says the next meal still ahead today, or that nothing's planned.

A wall display (a display key) can see the week, the recipes and the restaurant binder, but not plan, edit restaurants, edit recipes or add to the grocery list. A device that belongs to someone can update the **Notes** and **Status** of meals assigned to that person, for example marking dinner **Cooked**. Walls and everyone's own devices can add orders on a dining-out night (a kid's device only their own), until a parent marks it ordered.

## Turning it off

An admin can turn off **Meals** in **Settings → General** (tap **Change** under **Features**). The tab (with the restaurant binder), the Board card, meals in a person's day and the summary's meals line go away; a link to Meals opens the calendar. The recipes and meals are kept and the API keeps answering. See [Features](../settings/general.md#features).

## API and MCP

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/recipes?search=&category=&archived=&kind=` | Recipes with their ingredients; `kind=basic` or `kind=meal` lists only those. |
| `POST` / `PATCH` / `DELETE` | `/api/recipes`, `/api/recipes/{id}` | Add, edit (`archived: true` archives) or delete a recipe (admin). |
| `POST` | `/api/recipes/import` | Import or update a recipe by `{ source, externalId }` and optionally plan it (admin). See below. |
| `POST` | `/api/recipes/{id}/link-uses` | For a basic: link the other recipes' unlinked ingredient lines that name it `{ linked }` (admin). 400 for a meal. |
| `POST` | `/api/recipes/import-url` | Read the recipe on a web page `{ url, save? }` (admin). Answers `{ recipe, warnings }`: `recipe` is `{ name, description, imageUrl, sourceUrl, servings, prepMinutes, totalMinutes, ingredients: [{ text, name, quantity, unit }], steps: [{ text, bullets, title?, imageUrl? }] }`; from a Kinwall share link the ingredients also carry `qualifier`, `preparation` and `category` and the steps their `timers` (`servings` and times `null` when the page doesn't say). Nothing is saved unless `save: true`, which imports it with `source: "web"` and `externalId` the page's address (its canonical link when it has one) and adds `recipeId` and `created`. A preview (without `save`) of an address you already imported also has `updates: { id, name }`, the recipe saving would replace. To save an edited preview instead, send it to `POST /api/recipes/import` with the same `source` and `externalId` and the ingredients' `text` (or, when an ingredient has `qualifier`, the whole ingredient). Public `https` only (`http` is tried as `https`), redirects re-checked (at most 3), `text/html`, at most 3 MB, 15-second timeout. 400 for an address that isn't public `https`, 502 when the fetch fails or isn't a web page, 422 when the page has no schema.org Recipe data. |
| `POST` | `/api/recipes/parse-text` | Read pasted recipe text `{ text, url? }` into the same `{ recipe, warnings }` without saving (admin): the first line is the name, then an "Ingredients" heading and a "Directions" (or Instructions, Method, Steps) heading. 422 without an Ingredients heading. |
| `GET` | `/api/recipes/{id}/image`, `/api/meals/{id}/image` | The photo at that recipe's own `imageUrl` (a meal: its recipe's), fetched by the server (any signed-in key, display keys too; also `?key=` with a [media token](../integrations/rest-api.md) for an `<img src>`). Public `https` only, redirects re-checked (at most 3), JPEG, PNG, WebP or GIF checked by the file's own bytes (served as what the bytes are, never SVG), at most 8 MB, 15-second timeout, `Cache-Control: private, max-age=604800`, the source's `ETag` passed through. 404 when there's no image, 400 when it isn't a public `https` address, 502 when the fetch fails or isn't an image. Clear a recipe's photo with `PATCH /api/recipes/{id}` `{"imageUrl": null}`. |
| `GET` | `/api/recipes/{id}/steps/{n}/image` | Step `n`'s photo (steps count from 1), from that step's own `imageUrl`, fetched and checked exactly like the recipe photo above (also a media token as `?key=`; display keys too). 404 when the step doesn't exist or has no photo. |
| `GET` | `/api/recipes/{id}/source.pdf`, `/api/meals/{id}/source.pdf` | The PDF recipe card at that recipe's or meal's own `sourceUrl`, fetched by the server (any signed-in key, display keys too). Public `https` only, redirects re-checked (at most 3), `application/pdf` (or `application/octet-stream` starting `%PDF`), at most 15 MB, 15-second timeout, `Cache-Control: private, max-age=86400`. 404 when there's no `sourceUrl`, 400 when it isn't a public `https` address, 502 when the fetch fails or isn't a PDF. |
| `GET` | `/api/restaurants?search=&archived=` | The restaurant binder A to Z, each with its `menu` (`[{ id, section, name, description, priceCents, favorite, sort }]`). Display keys too. |
| `GET` | `/api/restaurants/{id}` | One restaurant with its menu. Display keys too. |
| `POST` / `PATCH` / `DELETE` | `/api/restaurants`, `/api/restaurants/{id}` | Add, edit (`archived: true` archives) or delete a restaurant (admin): `{ name, cuisine, phone, address, website, orderUrl, menuUrl, notes, menu }`. Sending `menu` replaces the whole menu; an item that keeps its `id` keeps its star. |
| `POST` | `/api/restaurants/parse-menu` | Read pasted menu text `{ text }` into `{ items: [{ section, name, priceCents, description }] }` to review, without saving (admin), as [Paste a menu](#adding-the-menu) does. |
| `POST` | `/api/restaurants/import` | Add a restaurant from a phone or script (admin), as the [restaurant shortcut](#add-restaurants-from-your-phone) does: `{ name?, cuisine?, phone?, address?, website?, orderUrl?, menuUrl?, url?, menuText?, menu?: [{ section?, name, description?, price? }] }`. Matches a restaurant by name (case, spaces and punctuation ignored; archived places aren't matched) or adds it, fills only empty fields, and adds `menuText` (read like `parse-menu`, with `Name:`, `Cuisine:`, `Phone:`, `Address:`, `Website:`, `Order online:` and `Menu link:` lines at the top filling those fields; a `QR code:` line is only shown on a share preview, never saved) and `menu` items into their sections (a section's items kept together), skipping items whose name is already in that section. Several photos' text can come in one `menuText`, joined by `--- Page 2 ---` lines: a heading seen again ("PIZZA (continued)") is the same section, "Continued on back" lines are skipped, and a later page's header lines fill only what's still empty. `url` (or `website`) is read for the page's schema.org `Restaurant`, `FoodEstablishment` or `LocalBusiness` details (fetched like `import-url`; a failed fetch just fills nothing); an Apple Maps link gives its `name` (or `q`) and `address` without a fetch. `price` is lenient: `"$12.99"`, `"12.99"`, `"12"` or `12.99`. Answers 201 when added, 200 when updated: `{ restaurant, created, filled, added, skipped, summary }`, `summary` one line such as "Added 23 items to Corner Slice". 400 when there's no name from any of them. |
| `POST` | `/api/restaurants/details` | Read a restaurant's details `{ url }` from its web page or an Apple Maps link into `{ details: { name, cuisine, phone, address, website, menuUrl } }`, without saving (admin); all `null` when nothing is found. The editor's **Fill in from website**. |
| `GET` | `/api/meals?from=&to=` | Meals in a date range (at most 367 days). `status` is `planned` or `prepared` (shown as **Cooked**, or **Ordered** when eating out). A dining-out meal has `restaurantId`, `orderType` (`dine_in`, `pickup` or `delivery`) and `orders: [{ memberId, items: [{ menuItemId, name, qty, note }], note, updatedAt }]`. A restaurant read also has `upcoming` (its nights from today on) and `lastOrders` (each person's latest order there from a night already ordered). |
| `PUT` / `DELETE` | `/api/meals/{id}/orders/{memberId}` | Set `{ items, note }` or clear a member's order on a dining-out meal (no items and no note clears it too). Wall and member devices too, a member's own device only for them; once the meal's `status` is `prepared` (Ordered), parents only. |
| `POST` | `/api/meals/{id}/ask-orders` | Ask who's eating (everyone when nobody is picked) for their order: a `meal` notification and a push opening `#/meals?meal=<id>&orders=1` (admin). 403 while Meals is off. |
| `GET` | `/api/events/{id}/meal` | `{ meal }`: the meal linked to that calendar event, or `null`. Display keys too. |
| `POST` / `PATCH` / `DELETE` | `/api/meals`, `/api/meals/{id}` | Plan, edit or delete a meal (admin; an assigned device may `PATCH` `notes` and `status`). `refreshRecipe: true` replaces the meal's ingredients with the recipe's. |
| `GET` | `/api/meals/projection?from=&to=&listId=` | The shopping preview (admin). |
| `POST` | `/api/meals/projection/apply` | Add `{ from, to, listId, omitKeys?, includeNotes?, includeKitItems?, basics? }` to a list (admin). Meal-kit ingredients that ship in the box are skipped unless `includeKitItems: true`. A preview item with `basicId` is made from a basic: `basics: { "<basicId>": "made" }` skips it, `"ingredients"` adds the basic's own ingredients once, as written, instead (a basic left out is added as its line). Safe to repeat. |
| `POST` | `/api/meals/{id}/swap` | Swap `{ otherId }`'s date and slot with this meal's in one step (admin); returns both meals. Events Kinwall created for them follow, as with an edit; 502 when a synced calendar refuses (nothing changes). |
| `POST` / `DELETE` | `/api/meals/{id}/calendar-link` | Link `{ eventId }` or unlink an event (admin). |
| `POST` | `/api/meals/{id}/calendar-event` | Create and link an event `{ calendarId?, eventStart? }` (admin). `calendarId` is any writable calendar, synced ones included (the event is written to the provider the same way `POST /api/events` does); without it the event goes on a Kinwall calendar, never a synced one. `eventStart`: `meal` (default) or `cooking`. The meal's `calendarEventStart` is then set; it's `null` for an event you linked. Changes to the meal update the event; 502 when a synced calendar refuses. |

Meals have `assigneeMemberId` (who's cooking) and `eaterIds` (who's eating, member ids); sending `eaterIds` without `servings` sets servings to how many. Recipes have `steps`: `null` for a recipe that only has `instructions` text, or a list of `{ text, bullets, imageUrl, title, timers }` (`text` may be empty for a step that's only bullets; `title` is `null` and `timers` `[]` when the step has none). A step's `title` leads its line in `instructions` (`1. Roast veggies: …`). Sending `steps` (in `POST` / `PATCH /api/recipes`) makes them the recipe's steps and rewrites `instructions` as the same steps in numbered text (bullets as `- ` lines under their number), so exports and plain-text readers still get them; `steps: null` or `[]` removes them. Sending only `instructions` replaces structured steps with that text. A planned meal doesn't copy the steps: its sheet opens the recipe. Recipes have `prepMinutes` and `totalMinutes` (whole minutes or `null`); a planned meal's `recipeSnapshot` copies them. Each ingredient has `scalable`: whether its amount follows the servings. Webhooks: `recipe.changed`, `meal.changed`.

Recipes have `kind` (`meal`, the default, or `basic`) and `makes` (free text, or `null`). An ingredient has `basicId` (the basic it is made from, or `null`) and a read-only `basicName`. Only a basic can be linked, never the recipe itself; any other id is dropped. When editing, an ingredient sent without `basicId` keeps the link it had (same name and unit), and `basicId: null` unlinks it. Deleting a basic, or changing its `kind` to `meal`, unlinks its lines. In `POST /api/recipes/import`, `kind` and `makes` are optional and an ingredient object may name its basic (`"basic": "Taco seasoning"`): it links to the family's basic of that name, if there is one.

`POST /api/recipes/import` takes:

```json
{
  "source": "hellofresh",
  "externalId": "6819dfd55efe69a088447ef3",
  "name": "Creamy Chicken",
  "description": "optional",
  "sourceUrl": "https://… recipe card",
  "imageUrl": "https://… photo",
  "servings": 2,
  "prepMinutes": 10,
  "totalMinutes": 35,
  "ingredients": ["Salt", { "text": "1.5 tablespoon Sour Cream", "pantry": false, "category": "Dairy" }],
  "steps": ["Boil water.", { "text": "Cook the chicken", "bullets": ["Pat dry.", "Sear 5 minutes a side."], "imageUrl": "https://… step photo" }],
  "plan": { "date": "2026-10-05", "slot": "dinner", "servings": 4, "eaterIds": ["member-id", "member-id"], "calendarId": "calendar-id", "eventStart": "meal" }
}
```

`servings` is what the ingredient amounts are for (the recipe's default servings). `prepMinutes` and `totalMinutes` are optional; leaving them out keeps what an earlier import set. `plan.eaterIds` (optional) is who's eating; without `plan.servings`, the meal's servings are how many. A step is text or `{ text?, bullets?, imageUrl? }` (see [Importing recipes](#importing-recipes)). An ingredient is a line of text, or `{ text, pantry?, category?, name?, quantity?, unit?, qualifier?, preparation? }` where `pantry: false` means it ships in the kit; `name`, `quantity`, `unit`, `qualifier` and `preparation`, when given, are used instead of what the line says (and `qualifier` instead of `pantry`). `plan.calendarId` (optional) also puts the planned meal on that calendar, as if you'd tapped **Add to calendar** and picked it, unless the meal already has an event; `plan.eventStart` is `meal` (default) or `cooking`. It answers `{ recipeId, created, planned, mealId?, reason?, calendarEventId?, calendarError? }`: `created` is false when an earlier import was updated; `planned` is true with the `mealId` when the meal is on the plan (newly, or from an earlier import), and false with a `reason` when the slot was taken. `calendarEventId` is the meal's event; `calendarError` says why it couldn't get one (the meal is still planned).

The [MCP server](../integrations/mcp.md) has `list_recipes`, `get_recipe`, `list_meals`, `get_meal_projection`, `create_recipe`, `update_recipe`, `rate_recipe`, `import_recipe`, `create_meal`, `update_meal` and `apply_meal_projection`.
