# Meals

The **Meals** tab answers two questions: what are we eating this week, and what do we need to buy? It has a **Week planner** and a **Recipe library**. Admins plan and edit; everyone can look.

## Planning the week

The week planner shows the household week (it starts on Sunday or Monday, per [General](../settings/general.md)) with a row per day and a column for **Breakfast**, **Lunch**, **Dinner** and **Snack**. On a phone each day is a card with its four slots listed. Use the arrows to page through weeks and **This week** to come back.

Tap **+** in a slot (or **Plan meal**) to add a meal:

* **Meal type**: **Recipe** (from the library), **Free-form meal** (just a name, like "Leftover soup") or **Dining out** (like "Pizza place").
* **Recipe**: tap it to choose one. The picker opens with a search box (recipe name or ingredient; arrow keys and Enter work too) and lists recipes A to Z with their photo, time and family rating ("★ 4.5"). Archived recipes stay out unless the meal already uses one. Choosing a recipe fills in the meal's name and servings. The meal's sheet doesn't list the ingredients: **Open recipe** shows them, scaled to any number of servings.
* **Who's eating**: tap family members. Picking people sets **Servings** to how many (you can still change servings). With nobody picked, a note says how many people the servings are for ("2 servings: pick 2 people"); it's only a hint and never stops you saving.
* **Servings**, an optional **Time** ("7:30 PM"; left empty, the meal is at the family's usual time for that meal, shown under the field), **Cooking** (who's making it), **Notes** and an optional website.
* **Status**: **Planned**, **Prepared** or **Handled**. A meal that's done shows dashed.

To trade two meals around, open a planned meal and tap **Swap with…**: it lists the other meals from today through the end of that meal's week, and picking one swaps their days and slots (Tuesday's dinner and Thursday's dinner change places). A calendar event Kinwall made for either meal moves with it; an event you linked yourself stays put.

A slot can hold more than one meal. Tap a meal with a recipe to see the recipe (with **Edit meal** or, for a non-admin, **Meal details** to open the meal sheet); tap a meal without one to open its sheet directly, where you can also delete it. A planned meal shows small avatars of who's eating.

When the header is filtered to one person, the planner and the Board's **Today's meals** show the meals that person is eating or cooking, plus meals with nobody picked.

## Recipes

The **Recipe library** lists the family's recipes. Search by name or ingredient, filter by ingredient category, or show archived ones. A recipe has a name, description, default servings, how long it takes (total and prep minutes, both optional), instructions, preparation notes, a source link and its ingredients: name, quantity, unit, preparation ("diced"), a quantity note ("15 oz cans") and a category ("Produce").

Tap a recipe to see it: its times, the ingredients (with **−** and **+** to see them for more or fewer servings), the numbered steps, preparation notes and its source link. Admins get **Edit** (the editor, where **More…** next to **Save recipe** also archives or deletes it) and **Plan this meal**, which opens a new meal with the recipe chosen. **Open recipe** in a meal's sheet opens the same view. A wall display sees the view without **Edit**.

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

Everyone in the family can rate a recipe: the recipe's view shows a one-line summary ("★ 4.3 · 3 ratings", or **Rate this recipe** with none yet) that expands to a row for each person with five big stars. Tap a star to rate, tap the same star again to clear it. The family average also shows on the recipe's card in the library (with how many have rated it) and next to its name when you pick a recipe for a meal. **Sort: Top rated** in the library puts the family's favorites first.

Rating is an everyday action like ticking off a chore: a wall display rates for anyone, and a device that belongs to one person rates only for them. Deleting a recipe or a person removes their ratings. The API's `PUT /api/recipes/{id}/rating` (`{ "memberId": "…", "stars": 1-5 }`, `null` or `0` clears it) and the MCP tool `rate_recipe` do the same.

### Steps and cooking along

A typed recipe's instructions show as a numbered list, one line per step. An imported recipe (or one with steps added through the API) has structured steps instead: each is a numbered card with the step's title (when it has one) as a small heading, its text and its short instructions as bullets, and the step's photo when it has one, beside the text when there's room and above it on a phone. A photo that can't be loaded just isn't shown.

Tap a step when it's done: it dims with a check, so you can see where you are while cooking. Tap it again to undo it, or **Reset** to clear them all. The checks are only kept while the recipe is open, on that screen; closing it starts fresh next time. With a keyboard, Tab to a step and press Space or Enter.

### Start cooking

A recipe with steps has a **Start cooking** button near the top of its view. It fills the screen with one step at a time in big type you can read across the kitchen, with the step's photo when it has one and **Step 2 of 7** above it. **Next** and **Back** move between steps (so do swiping left and right, and the arrow keys); the last step has **Done**, and **×** leaves. A typed recipe's instructions become one step per line (or per sentence, for a single paragraph).

**This step's ingredients** lists the ingredients the step mentions, right under the step's photo (above the step's text when it has no photo), so they're in view without scrolling, for the servings you picked in the recipe view. **All ingredients** shows the whole list without leaving the step.

A step's title shows above its text. When a step comes with its own timers (an imported meal kit's "Chicken · 25 min"), those are its timer buttons, named. Otherwise, when a step mentions a time ("10 minutes", "1 hour", "5-7 min"), tap its timer to start it; for a range, the timer runs to the shorter time so you can check. Running timers stay in a bar at the top as you move between steps, and you can run several at once. When one is up, a red banner flashes, the device beeps (and vibrates on a phone), and **OK** clears it. Timers only run while cooking mode is open.

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

To send a recipe to someone outside the family, open it and tap **Share recipe** (parents' devices only). Kinwall makes a link like `https://yourfamily.kinwall.family/r/…` and shows it with **Copy link** and, on phones and tablets, **Share**. Tapping **Share recipe** again shows the same link.

The link opens a simple page that works in any browser, no Kinwall needed: the recipe's name, photo, description, servings and times, ingredients, numbered steps (with their photos) and its source link, with "Shared from Kinwall" at the bottom (linking to kinwall.family). Recipe apps and websites that read recipe links can import it too (with the standard recipe data: ingredients as lines of text, and steps with their titles and photos). Under the recipe, **Save to my Kinwall** asks for the other family's Kinwall address (like `theirfamily.kinwall.family`, or their own server's), then opens their Kinwall's **Import from a link** with the recipe ready to save. The browser remembers that address for next time.

The page shows the recipe and nothing else: never your family's name, who's in it, ratings, planned meals, meal notes or the recipe's preparation notes. Search engines are asked not to list it, and the link is long and random, so it can't be guessed.

**More… → Stop sharing…** turns the link off for everyone who has it (a copy someone already saved stays theirs). Sharing again later makes a new link. Deleting the recipe also turns its link off. Links aren't part of your data export.

## Import from a link

Most recipe websites describe their recipes in a standard, machine-readable form (schema.org Recipe data) alongside the page, and Kinwall can read it. In the **Recipe library**, an admin taps **Import from a link**, pastes the page's address and taps **Get recipe**. Kinwall shows what it found before saving anything:

* The name and servings, which you can change here.
* Its times and the website's name, the description, and **N ingredients** and **N steps**, which open to show them.
* A note for anything missing ("No servings found", "No steps found"). A recipe without servings is saved for 4.
* The photo isn't shown yet: it appears once the recipe is saved.

**Save recipe** adds it to the library and opens it. Ingredient lines are split into amount, unit and name the same way as other imports (see [Importing recipes](#importing-recipes)); section headings in the steps ("For the sauce") go in front of their first step. A step keeps its title when the site gives it one (not when the title just repeats the step's first words) and its own photo (`https` only), and a step written as several lines stays one step, with the lines as its bullets. Importing the same page again updates that recipe instead of adding a copy (so it replaces edits you made to it). The recipe's source link is the page, and its photo comes from the site like any recipe photo.

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

In the Kinwall app for iPhone and Android, share a recipe page to Kinwall: in Safari or Chrome (or any app with a Share button), tap **Share** and pick **Kinwall**. The app opens the import sheet with the link filled in and reads it straight away. On the iPhone, if Kinwall isn't in the share sheet's row of apps, tap **More** and turn it on.

Any browser can do the same with a link to `#/recipes/import?url=<the page address, URL-encoded>` on your Kinwall address. Importing is for parents' devices: on a wall screen or a child's device the sheet says **Ask a grown-up to import this recipe**.

## Importing recipes

Recipes can come in from a website (above) or from another app instead of being typed. The [Home Assistant integration](../integrations/home-assistant.md#meal-kits) has a ready-made blueprint that imports each week's HelloFresh box (through the HelloFresh integration for Home Assistant) and plans the meals as dinners from delivery day on. Anything else can call `POST /api/recipes/import` (admin) or the MCP tool `import_recipe`.

* An imported recipe remembers where it came from (`source`, like `hellofresh`, and that app's own id). Importing it again updates the same recipe instead of adding a copy, so edits you make to an imported recipe are replaced the next time it's imported.
* Ingredient lines like "1.5 tablespoon Sour Cream", "½ cup Rice" or "2 unit Garlic Clove" are split into amount, unit and name. Anything Kinwall can't read stays in the name.
* An ingredient whose name matches one of your [basics](#basics) links to it, with the same matching as the editor's **Link to basic** ("Taco Seasoning Blend" links to "Taco seasoning"; a name two basics share, or an archived basic, doesn't). Importing again keeps a link you made by hand.
* Ingredient lines that repeat the unit abbreviated ("1 teaspoon (tsp) Cooking Oil") drop the abbreviation.
* Ingredients that ship in the box get the quantity note **in the kit**, shown as an **In the kit** tag. They're on the recipe, but grocery lists leave them off unless you tick them (see below). What you supply yourself (oil, salt, butter) goes on the list like any other ingredient.
* `imageUrl` is the recipe's photo (see [Recipe photos](#recipe-photos)); importing again without one keeps the photo it has.
* Steps become the recipe's structured steps (see [Steps and cooking along](#steps-and-cooking-along)). A step can be text, where a step of several lines (the way a meal kit writes several short instructions in one step) becomes a step of bullets, or `{ text, bullets, imageUrl, title, timers }` with the step's own photo, a short heading and its timers (`[{ name, minutes }]`, `name` may be `null`). Importing again without `steps` keeps the ones it has; `"steps": []` clears them.
* The recipe card link is the recipe's source link (a PDF card opens in the app), and `prepMinutes` / `totalMinutes` are its times.
* With a date and slot it's also planned, unless that slot already has a meal. Then nothing is planned and the answer says why (`planned: false`), so an automation can try the next night. Importing again finds the meal it planned before for that slot in the same week, even if you moved it to another night, and doesn't plan it twice.

## Scaling servings

Change a meal's servings and its ingredients scale with it: a recipe for 4 with 2 cups of flour needs 1 cup for 2 servings. Counts ("12 tortillas") and measures (cups, tbsp, lb, g and so on) scale; "1 dozen" counts as 12.

Some amounts don't scale, and Kinwall shows them as they are with **Check amount for 6 servings (recipe: 4)**:

* containers and handfuls: cans, jars, packages, bunches, pinches, handfuls;
* anything with a quantity note ("15 oz cans"), or no quantity at all ("to taste").

## Adding to the grocery list

**Groceries** (admins) adds up the ingredients of every recipe meal in a date range, the planner's week by default:

1. Pick the range and a grocery list. Only shopping lists can take ingredients. If you have just one, it's already chosen; with several, Kinwall picks the one this device used last. The preview shows each ingredient's total, which meals it's for, and any item already on that list with the same name.
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

An event Kinwall made follows the meal, on whichever calendar it's on. Saving the meal with a new day, slot, time, title, notes or people updates the event, and deleting the meal deletes it. If you wrote your own description on the event, changing the meal's notes leaves it alone. If a synced calendar refuses the change (the account needs reconnecting, say), the meal isn't saved and the sheet says why; **Unlink** the event first if you want to change or delete the meal without it.

**Or link an event you already have** attaches an existing event from any calendar. Kinwall never changes or deletes an event you linked. **Unlink (keep the event)** detaches either kind; an event Kinwall made stays on the calendar and stops following the meal.

## On the wall and in someone's day

* The Board has a **Today's meals** card, with the next one marked and who's eating.
* A person's day (tap their avatar) lists today's meals, and tomorrow's in **Tomorrow at a glance**. See [Daily & weekly snapshot](snapshot.md).
* The morning summary includes the day's meals. See [Notifications](notifications.md).

A wall display (a display key) can see the week and the recipes, but not plan, edit recipes or use the shopping projection. A device that belongs to someone can update the **Notes** and **Status** of meals assigned to that person, for example marking dinner **Prepared**.

## Turning it off

An admin can turn off **Meals** in **Settings → General** (tap **Change** under **Features**). The tab, the Board card, meals in a person's day and the summary's meals line go away; a link to Meals opens the calendar. The recipes and meals are kept and the API keeps answering. See [Features](../settings/general.md#features).

## API and MCP

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/recipes?search=&category=&archived=&kind=` | Recipes with their ingredients; `kind=basic` or `kind=meal` lists only those. |
| `POST` / `PATCH` / `DELETE` | `/api/recipes`, `/api/recipes/{id}` | Add, edit (`archived: true` archives) or delete a recipe (admin). |
| `POST` | `/api/recipes/import` | Import or update a recipe by `{ source, externalId }` and optionally plan it (admin). See below. |
| `POST` | `/api/recipes/{id}/link-uses` | For a basic: link the other recipes' unlinked ingredient lines that name it `{ linked }` (admin). 400 for a meal. |
| `POST` | `/api/recipes/import-url` | Read the recipe on a web page `{ url, save? }` (admin). Answers `{ recipe, warnings }`: `recipe` is `{ name, description, imageUrl, sourceUrl, servings, prepMinutes, totalMinutes, ingredients: [{ text, name, quantity, unit }], steps: [{ text, bullets, title?, imageUrl? }] }`; from a Kinwall share link the ingredients also carry `qualifier`, `preparation` and `category` and the steps their `timers` (`servings` and times `null` when the page doesn't say). Nothing is saved unless `save: true`, which imports it with `source: "web"` and `externalId` the page's address (its canonical link when it has one) and adds `recipeId` and `created`. To save an edited preview instead, send it to `POST /api/recipes/import` with the same `source` and `externalId` and the ingredients' `text` (or, when an ingredient has `qualifier`, the whole ingredient). Public `https` only (`http` is tried as `https`), redirects re-checked (at most 3), `text/html`, at most 3 MB, 15-second timeout. 400 for an address that isn't public `https`, 502 when the fetch fails or isn't a web page, 422 when the page has no schema.org Recipe data. |
| `POST` | `/api/recipes/parse-text` | Read pasted recipe text `{ text, url? }` into the same `{ recipe, warnings }` without saving (admin): the first line is the name, then an "Ingredients" heading and a "Directions" (or Instructions, Method, Steps) heading. 422 without an Ingredients heading. |
| `GET` | `/api/recipes/{id}/image`, `/api/meals/{id}/image` | The photo at that recipe's own `imageUrl` (a meal: its recipe's), fetched by the server (any signed-in key, display keys too; also `?key=` for an `<img src>`). Public `https` only, redirects re-checked (at most 3), JPEG, PNG, WebP or GIF checked by the file's own bytes (served as what the bytes are, never SVG), at most 8 MB, 15-second timeout, `Cache-Control: private, max-age=604800`, the source's `ETag` passed through. 404 when there's no image, 400 when it isn't a public `https` address, 502 when the fetch fails or isn't an image. Clear a recipe's photo with `PATCH /api/recipes/{id}` `{"imageUrl": null}`. |
| `GET` | `/api/recipes/{id}/steps/{n}/image` | Step `n`'s photo (steps count from 1), from that step's own `imageUrl`, fetched and checked exactly like the recipe photo above (also `?key=`; display keys too). 404 when the step doesn't exist or has no photo. |
| `GET` | `/api/recipes/{id}/source.pdf`, `/api/meals/{id}/source.pdf` | The PDF recipe card at that recipe's or meal's own `sourceUrl`, fetched by the server (any signed-in key, display keys too). Public `https` only, redirects re-checked (at most 3), `application/pdf` (or `application/octet-stream` starting `%PDF`), at most 15 MB, 15-second timeout, `Cache-Control: private, max-age=86400`. 404 when there's no `sourceUrl`, 400 when it isn't a public `https` address, 502 when the fetch fails or isn't a PDF. |
| `GET` | `/api/meals?from=&to=` | Meals in a date range (at most 367 days). |
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
