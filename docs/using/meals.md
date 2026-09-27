# Meals

The **Meals** tab answers two questions: what are we eating this week, and what do we need to buy? It has a **Week planner** and a **Recipe library**. Admins plan and edit; everyone can look.

## Planning the week

The week planner shows the household week (it starts on Sunday or Monday, per [General](../settings/general.md)) with a row per day and a column for **Breakfast**, **Lunch**, **Dinner** and **Snack**. On a phone each day is a card with its four slots listed. Use the arrows to page through weeks and **This week** to come back.

Tap **+** in a slot (or **Plan meal**) to add a meal:

* **Meal type**: **Recipe** (from the library), **Free-form meal** (just a name, like "Leftover soup") or **Dining out** (like "Pizza place").
* **Servings**, an optional **Time** ("7:30 PM"), an **Assignee** (who's cooking), **Notes** and an optional website.
* **Status**: **Planned**, **Prepared** or **Handled**. A meal that's done shows dashed.

A slot can hold more than one meal. Tap a meal to edit it, or delete it from its sheet.

## Recipes

The **Recipe library** lists the family's recipes. Search by name or ingredient, filter by ingredient category, or show archived ones. A recipe has a name, description, default servings, instructions, preparation notes, a source link (stored, never fetched) and its ingredients: name, quantity, unit, preparation ("diced"), a quantity note ("15 oz cans") and a category ("Produce").

When you plan a recipe, the meal keeps its own copy of the ingredients. Editing, archiving or deleting the recipe later doesn't change meals already planned. To pick up the recipe's changes, tick **Refresh from the current recipe when saving** in the meal's sheet.

## Importing recipes

Recipes can come in from another app instead of being typed. The [Home Assistant integration](../integrations/home-assistant.md#meal-kits) has a ready-made blueprint that imports each week's HelloFresh box (through the HelloFresh integration for Home Assistant) and plans the meals as dinners from delivery day on. Anything else can call `POST /api/recipes/import` (admin) or the MCP tool `import_recipe`.

* An imported recipe remembers where it came from (`source`, like `hellofresh`, and that app's own id). Importing it again updates the same recipe instead of adding a copy, so edits you make to an imported recipe are replaced the next time it's imported.
* Ingredient lines like "1.5 tablespoon Sour Cream", "½ cup Rice" or "2 unit Garlic Clove" are split into amount, unit and name. Anything Kinwall can't read stays in the name.
* Ingredients that ship in the box get the quantity note **in the kit**. They're on the recipe, but grocery lists leave them off unless you tick them (see below). What you supply yourself (oil, salt, butter) goes on the list like any other ingredient.
* Steps become the numbered instructions, and the recipe card link is the recipe's source link.
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

New items land where your family keeps them: the store, aisle and department [remembered](lists.md#remembered-places) for that ingredient, or the recipe's category as the department when there's nothing remembered yet. A department that matches one of a store's aisles [puts the item in that aisle](lists.md#departments-fill-in-aisles) on a trip. On the list, each one says which meals it's for ("For Taco night"). Checking out a grocery run just clears the items; your meals don't change.

Kinwall remembers which meal's ingredient went to which list. Adding the same week again, or an overlapping range, only adds what hasn't been added yet, so nothing is duplicated, and items already on the list are never rewritten. If a meal changes after its ingredients were added (more servings, a new date), the preview marks it as changed so you can adjust the list by hand.

## The calendar

A meal can have one calendar event, from **Link or create calendar event** in its sheet:

* **Create and link event** adds an event to a local calendar: timed if the meal has a time (with a duration you pick), otherwise all-day. It's titled like "Dinner · Tuesday Tacos". This event belongs to the meal: saving the meal updates its title, time and people, and deleting the meal deletes it. A note typed on the event in the calendar stays.
* **Link event** attaches an event you already have (from any calendar). Kinwall never changes or deletes an event you linked; **Unlink (keep event)** just detaches it.

Meals never write to Google, Outlook or CalDAV calendars on their own.

## On the wall and in someone's day

* The Board has a **Today's meals** card, with the next one marked.
* A person's day (tap their avatar) lists today's meals, and tomorrow's in **Tomorrow at a glance**. See [Daily & weekly snapshot](snapshot.md).
* The morning summary includes the day's meals. See [Notifications](notifications.md).

A wall display (a display key) can see the week and the recipes, but not plan, edit recipes or use the shopping projection. A device that belongs to someone can update the **Notes** and **Status** of meals assigned to that person, for example marking dinner **Prepared**.

## Turning it off

An admin can turn off **Meals** in **Settings → General** (tap **Change** under **Features**). The tab, the Board card, meals in a person's day and the summary's meals line go away; a link to Meals opens the calendar. The recipes and meals are kept and the API keeps answering. See [Features](../settings/general.md#features).

## API and MCP

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/recipes?search=&category=&archived=` | Recipes with their ingredients. |
| `POST` / `PATCH` / `DELETE` | `/api/recipes`, `/api/recipes/{id}` | Add, edit (`archived: true` archives) or delete a recipe (admin). |
| `POST` | `/api/recipes/import` | Import or update a recipe by `{ source, externalId }` and optionally plan it (admin). See below. |
| `GET` | `/api/meals?from=&to=` | Meals in a date range (at most 367 days). |
| `POST` / `PATCH` / `DELETE` | `/api/meals`, `/api/meals/{id}` | Plan, edit or delete a meal (admin; an assigned device may `PATCH` `notes` and `status`). `refreshRecipe: true` replaces the meal's ingredients with the recipe's. |
| `GET` | `/api/meals/projection?from=&to=&listId=` | The shopping preview (admin). |
| `POST` | `/api/meals/projection/apply` | Add `{ from, to, listId, omitKeys?, includeNotes?, includeKitItems? }` to a list (admin). Meal-kit ingredients that ship in the box are skipped unless `includeKitItems: true`. Safe to repeat. |
| `POST` / `DELETE` | `/api/meals/{id}/calendar-link` | Link `{ eventId }` or unlink an event (admin). |
| `POST` | `/api/meals/{id}/calendar-event` | Create and link a local event `{ calendarId?, durationMinutes? }` (admin). |

Each ingredient has `scalable`: whether its amount follows the servings. Webhooks: `recipe.changed`, `meal.changed`.

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
  "ingredients": ["Salt", { "text": "1.5 tablespoon Sour Cream", "pantry": false, "category": "Dairy" }],
  "steps": ["Boil water.", "Cook the chicken."],
  "plan": { "date": "2026-10-05", "slot": "dinner", "servings": 4 }
}
```

`servings` is what the ingredient amounts are for (the recipe's default servings). An ingredient is a line of text, or `{ text, pantry?, category? }` where `pantry: false` means it ships in the kit. It answers `{ recipeId, created, planned, mealId?, reason? }`: `created` is false when an earlier import was updated; `planned` is true with the `mealId` when the meal is on the plan (newly, or from an earlier import), and false with a `reason` when the slot was taken.

The [MCP server](../integrations/mcp.md) has `list_recipes`, `get_recipe`, `list_meals`, `get_meal_projection`, `create_recipe`, `update_recipe`, `import_recipe`, `create_meal`, `update_meal` and `apply_meal_projection`.
