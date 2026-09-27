# Lists

<p>
  <img src="../screenshots/phone-groceries.png" width="32%" alt="Shopping list grouped by category on a phone" />
</p>

![Lists on the wall iPad](../screenshots/ipad-lists.png)

Don't use lists? An admin can turn off **Lists** in **Settings → General** (tap **Change** under **Features**). It's hidden on every screen; nothing is deleted. See [Features](../settings/general.md#features).

The Lists tab shows your lists and their open-item counts. On the wall display, the open list sits next to them. On a phone, you tap into one. **New list** or **+** creates a list. Press and hold a list card to edit it.

## Kinds

| Kind | For | Extras |
|---|---|---|
| **Shopping** | groceries, hardware runs | Items have a **Store**, an **Aisle** and a **Category**. Group by Store, Category, Aisle or None (default Category); sorted by Aisle. [Shopping at](#shopping-at-a-store) walks the list in one store. |
| **To-do** | jobs, errands | Items have an assignee (**Assign to**) and a **Due date**. |
| **Reusable** | packing lists, routines | Items have an assignee. **Reset** unticks everything (steps too) so you can use it again. |

You can change a list's kind later.

A list can also be a chore's **checklist**, so a routine like "Bedtime" has to be ticked off before the chore counts. A reusable checklist resets itself each time the chore is completed. See [Chores → Checklists](chores.md#checklists).

## Editing a list

**Edit** opens **Name**, **Kind**, **Keep checked items in place** (see below), **Emoji**, **Color** and **Owners (nobody = whole family)**. On a shopping list it also opens [Stores & categories](#stores--categories). It also has **Archive** (next to delete) and delete, which removes all the list's items too. Archived lists are hidden from the main Lists view and collect in a collapsed **Archived (*N*)** section at the bottom of the list overview. Expand it to **Restore** a list or delete it for good. The API returns them with `GET /api/lists?archived=true`; `PATCH /api/lists/{id} {archived}` archives or restores.

## Adding and ticking items

* Type in the add bar and press Enter. The keyboard stays open for the next item.
* **It remembers where things go** (shopping lists): see [Remembered places](#remembered-places).
* Tap the circle to tick an item off. What happens next depends on **Keep checked items in place**:
  * **On** (the default for shopping and reusable lists): the item stays where it is, crossed off and dimmed, so the list doesn't move under your thumb while you shop. Tap it again to untick it. A **Checkout (*N*)** button (**Reset (*N*)** on a reusable list, **Clear checked (*N*)** on a to-do list) sits at the bottom of the list while anything is ticked.
  * **Off** (the default for to-do lists): ticked items move to **Done (*N*)**, which you can expand, with **Clear checked** (or **Reset list** on a reusable list).
* **Checkout** removes the ticked items. **Reset** unticks them for next time instead. Either one shows a short "Checked out 5 items · **Undo**" message; tap **Undo** within a few seconds and nothing changes. Items you tick after tapping Checkout aren't swept up.
* Long titles wrap to two lines on the row (three in icon-first density); the item sheet always shows the whole title.
* A colored dot before the title shows the item's **Priority** (see below), and a note icon after it means the item has **Notes** or a **Discussion**.
* An item with a due date shows it in small text under the title: "Due today", "Due Fri, Oct 3", or "Overdue · Sep 22" in red.
* Tap an item to edit it: **Title**, **Priority**, **Steps**, **Quantity** ("2, 1 lb, x3"), **Store**, **Aisle** and **Category** (shopping; see [Stores, aisles and categories](#stores-aisles-and-categories)), **Assign to** (to-do and reusable), **Due date** (to-do, with **Clear**), **Linked event**, **Notes** (the item's own description), **Discussion** (see below), and **Order** (**Move up** / **Move down**, manual sort only).

## Stores, aisles and categories

On a shopping list, the item sheet puts **Quantity**, **Store**, **Aisle** and **Category** first. Each is a dropdown of the values your family already uses on any list, plus **None** and **New store…** / **New aisle…** / **New category…**, which opens a text field for a new one.

* **Store** is where you plan to buy the item. **None** means anywhere.
* **Aisle** belongs to a store: "Aisle 4", "Produce", "Back wall". The dropdown offers the chosen store's aisles in the order you walk them, and changing the store clears an aisle that store doesn't have.
* If an item has no store, the sheet suggests the store it was last bought at ("Last bought at Neighborhood market. **Plan to buy it there**"). It's only a suggestion; nothing changes unless you tap it.

### Remembered places

When you save a shopping item with a store, category or aisle, Kinwall remembers it for that item name, on the server, so every phone, the wall and the assistant share it. Next time anyone adds "milk" (typed, from Meals, or through the assistant), it gets the same store, category and aisle. Anything you set yourself wins, including choosing **None**.

* Names match ignoring capitals, extra spaces and simple plurals: "Eggs" is "egg", "Tomatoes" is "tomato", "Berries" is "berry".
* The aisle is remembered per store. Milk can be in Aisle 4 at one store and on the back wall at another; each store's aisle comes back when the item is planned for that store.
* The memory outlives the item: checking out milk doesn't forget where it goes.
* To-do and reusable lists don't use it.

### Stores & categories

**Edit** → **Stores & categories** (shopping lists) lists every store, category and aisle your family uses:

* **Rename** changes the name everywhere: items on every list and what's remembered. Rename "Costco" to "Warehouse club" once and every item follows.
* The trash button **removes** a name: it's cleared from every item that uses it and forgotten.
* **Aisles**: pick a store, then drag its aisles into the order you walk the store, for example Produce, Bakery, Deli, Meat, Aisle 3 to Aisle 18 with Frozen in the middle, Dairy, Pharmacy. Aisles don't have to be numbers, and one no item uses yet can be added here so it's in the dropdown. **Aisle** sort and grouping follow this order; aisles you haven't placed come after, in natural order.

## Shopping at a store

At the top of a shopping list, **Shopping at** starts a trip: pick the store you're in. The trip is kept on this device only (the wall and other phones aren't affected) and ends at **Checkout**, or when you pick **Not shopping**.

During a trip:

* Items planned for this store, or for anywhere, are listed by their aisle **at this store**, in the order you walk it. An item planned for anywhere shows the aisle it was in last time you shopped here.
* Items with no aisle known at this store are in **Aisle unknown** at the end.
* Items planned for another store are in a dimmed **At other stores** section at the bottom. You can still tick them.
* Ticked items stay crossed off in place, whatever the list's setting.
* Setting an item's aisle in the item sheet saves it for this store. An item planned for anywhere gets the aisle and stays "anywhere".
* **Checkout (*N*)** removes the ticked items, remembers this store as where they were last bought, and ends the trip. **Undo** brings everything back, trip included.

The toolbar (grouping, sort, store chips) is hidden during a trip, since the store's aisle order is the order.

## Offline shopping

Kinwall keeps working in a store with one bar of signal or none:

* **Open it and see your list.** A phone that has opened Kinwall before starts up without a connection and shows the lists as they were when it last reached your server. If the connection is only slow, Kinwall shows that copy after a few seconds rather than a spinner.
* **Tick items off, add items, edit them or delete them.** Changes show at once and wait on the phone, even if you close Kinwall or the phone restarts. While you're offline, a crossed-out cloud appears in the header next to the bell, with the number of changes waiting. Tap it for a reminder of what that means. Items changed on this phone and not synced yet have a dashed circle.
* **They sync on their own** when the connection returns: as soon as the phone is back online, when you switch back to Kinwall, and every 15 seconds while changes are waiting. The cloud disappears once everything is on the server.
* **Chore ticks** work the same way on the Chores tab.
* **Everything else needs a connection.** Creating or editing lists, steps, reordering, **Clear checked**, events and settings say "You're offline. This will work when you're back online." instead of failing. Nothing is lost: try again once you're back.

**Checkout** needs a connection too; if it can't reach the server, Kinwall says so and your ticked items stay ticked.

**When two people change the same list.** Changes replay in the order you made them, and each one only touches what you changed. If Sam ticks **Milk** in the store while Alex adds "2 gallons" to its notes at home, both stick. If you both change the same thing (say Alex unticks **Bread** after Sam ticked it offline), the change that reaches the server last wins. If Alex deletes an item that Sam then edits offline, Sam's edit is dropped when Sam comes back online, and Kinwall says so. An item added offline is never added twice, even if the connection drops mid-sync.

Signing out or unpairing a device deletes its offline copy and anything still waiting to sync. In the Kinwall app, see [Offline in the Kinwall app](../getting-started/put-it-on-the-wall.md#offline).

## Priority

Each item has a **Priority**: Low, Normal, High or Urgent. Pick it in the item sheet.

| Priority | On the row | Order |
|---|---|---|
| **Urgent** | red dot and a red bar down the left edge | first |
| **High** | orange dot | after urgent |
| **Normal** | nothing | after high |
| **Low** | muted green dot | last |

Screen readers hear the priority with the item ("Urgent priority"). Open items that are overdue move to the top of their priority. Done items drop their priority boost. In the [daily summary](notifications.md#daily-summary), urgent items are marked ‼️ and high ones ⭐.

## Sorting

**Sort** in the list toolbar picks how a list's items are ordered. The setting is saved on the list, so every screen shows the same order.

| Sort | Order |
|---|---|
| **Manual** (default) | By priority, overdue items first within each, then your own drag order. |
| **Date added** | Newest first. |
| **Due date** | Soonest first. Items with no due date go last. |
| **Priority** | By priority, overdue first, then soonest due date. |
| **A–Z** | Alphabetical, ignoring capital letters. |
| **Aisle** (shopping lists; the default for new ones) | By store, then aisle in the store's walking order (natural order, "Aisle 2" before "Aisle 10", if you haven't set one), items with no aisle last, then A–Z. |

Groups (store, category or aisle) still come first; the sort applies inside each group. With **Keep checked items in place** on, ticking an item never moves it. Dragging only works in **Manual**. In the other sorts, the grip is dimmed and tapping it says "Switch to Manual to drag".

The server sorts the same way, so `GET /api/lists/{id}` and MCP's `get_list` return items in the list's order.

## Steps

Break a bigger job into steps ("Tidy the living room": fold blankets, fluff cushions, find the remote). In the item sheet, type in **Add a step…** and press Enter.

* The row shows progress under the title ("2 of 5") with a thin bar.
* Tick steps in the sheet. Ticking the last open step ticks the item itself. Unticking a step on a done item opens the item again.
* Ticking the item ticks all its steps; unticking it unticks them all.
* Reorder steps by dragging the grip, or focus the grip and press Alt+Up / Alt+Down. The trash button deletes a step.
* **One at a time** shows only the next open step, big, with a **Done → next** button. Handy for kids working through a routine on the wall. Each step is announced to screen readers as it's done.
* **Reset list** on a reusable list unticks every step as well.

## Groups and order

* On shopping lists, **Group by** switches between Store, Category, Aisle and None. **Aisle** groups are per store ("Neighborhood market · Produce"), in store order and then the store's aisle order. **Reorder stores** / **Reorder categories** lets you arrange the groups in the order you walk the shop, then **Save order**.
* Items added from [Meals](meals.md#adding-to-the-grocery-list) show which meals they're for ("For Taco night").
* Store chips (**All**, then each store) show one store at a time.
* **Drag** an item by its grip to reorder it within its group (Manual sort only). Other groups and done items keep their places. The keyboard alternative is Move up / Move down in the item sheet.

## Linking items to events

Give an item a **Linked event** (picked from the next 30 days) and it becomes a task for that event:

* the list row shows the event's date and title,
* the event's detail sheet lists it under **Tasks**, where you can tick it off or add more ([Events → Linked tasks](events.md#linked-tasks)),
* the morning [daily summary](notifications.md#daily-summary) shows "To do for today's events".

Separately, open items **due today** on any list get a short "Due today" line in the daily summary.

A recurring local event links by its series, so the task follows every occurrence.

## Discussion

Below the item's **Notes** field, **Discussion** is a thread of notes from the family, each with the poster's avatar and name in their color ("Remote was under the cushion again"). It works exactly like [notes on events](events.md#notes): **+ Add note**, **Post as** a member (or **Someone**), tap a note to edit or delete it. The item's own **Notes** field stays a single description; the discussion is for separate back-and-forth.

Deleting an item (or clearing checked items, or deleting the list) deletes its discussion. Export and import include it.

## Notifications

Devices with **List updates** on get "List updated — *Groceries* has new items" when items are added. This is limited to one notification per list every 10 minutes. See [Notifications](notifications.md).

## API and MCP

* `GET/POST /api/lists`, `GET/PATCH/DELETE /api/lists/{id}` (lists carry `sortBy`: `manual`, `added`, `due`, `priority`, `alpha` or `aisle`; `groupBy`: `store`, `category`, `aisle` or `none`; and `keepChecked`, which defaults by kind), `POST /api/lists/{id}/items` (one item or an array; `priority` and `steps: string[]` are optional; an optional client-made UUID `id` makes a retried add safe: an id already on that list returns the existing item, one used on another list is a `409`), `PATCH/DELETE /api/lists/{id}/items/{itemId}`, `POST /api/lists/{id}/clear-completed`, `POST /api/lists/{id}/reset`, `POST /api/lists/{id}/reorder`, `PUT /api/lists/{id}/groups`, `GET /api/events/{id}/items`.
* Shopping: items carry `aisle`. On a shopping list, `POST …/items` fills an omitted `store`, `category` or `aisle` from what's remembered for the name (an explicit value or `null` wins), and saving an item remembers it. `GET /api/lists/{id}` returns `suggestions` (`stores`, `categories`, `aisles: [{store, aisle}]`), `aisleOrder: [{store, aisles}]`, and on each shopping item `places: [{store, aisle}]` (where it's been kept, newest first) and `meals` (the planned meals it was added for). `?store=<name>` adds `trip`: the list as shopped there, `items: [{id, title, quantity, done, store, aisle, section}]` with `section` `aisle`, `unknown` or `other`.
* `clear-completed` and `reset` take an optional body `{itemIds, store}`: only those items (if still ticked), and for Checkout the store they were bought at. `PATCH` an item with `{aisle, aisleStore}` to set its aisle at a store it isn't planned for (a trip).
* `POST /api/lists/values` `{field: "store" | "category" | "aisle", from, to, store?}` renames (`to`) or removes (`to: null`) a value everywhere; an aisle needs its `store`. `PUT /api/lists/aisles` `{store, aisles}` sets a store's aisle order (`[]` clears it).
* Items carry `priority` (`low`, `normal`, `high` or `urgent`; older clients sending `high` keep working), `steps` (`[{id, title, done, sort}]`, in order), `stepsDone` and `stepsTotal`.
* Steps: `POST /api/lists/{id}/items/{itemId}/steps` (`{title}`), `PATCH …/steps/{stepId}` (`title`, `done`, `sort`), `DELETE …/steps/{stepId}`, `POST …/steps/reorder` (`{stepIds}`). Each returns the whole updated item, including any automatic complete or re-open.
* MCP: `list_lists`, `create_list`, `update_list` (including `sortBy`, `groupBy` and `keepChecked`), `get_list` (with `store` for the trip view), `add_list_items` and `update_list_item` (both with `aisle`; adds use the remembered places), `set_store_aisle_order`, `set_list_item_done`, `set_step_done`, `get_event_items`. Lists can be referred to by name.
* Discussion: `GET /api/notes?target=list_item:<id>`, `POST /api/notes` `{target, body, memberId?}`, `PATCH/DELETE /api/notes/{id}`; items in `GET /api/lists/{id}` carry `noteCount`. MCP: `list_notes`, `add_note`, `update_note`.
* Display keys have full access to lists, steps and discussions included.
* Export and import include each list's sort and **Keep checked items in place**, each item's priority, aisle and steps, the remembered places and each store's aisle order. Older export files import with Manual sort and the kind's default for keeping checked items.
