# MCP server

Kinwall has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server. An AI assistant can answer "what's on Saturday?", add an event, tick off a chore, add milk to the groceries or check the leaderboard.

* **Endpoint**: `https://<your-kinwall>/mcp`, using the **Streamable HTTP** transport (`POST`/`DELETE`). It's stateless, with no sessions, and offers no SSE stream (`GET` answers 405), so clients never hold a connection open.
* **Same rules as REST**: every tool calls the REST routes internally with your credentials, so scopes, validation, webhooks and `rev` bumps behave exactly as they do for the [REST API](rest-api.md). A REST error becomes a tool result with `isError: true` and the route's error text.
* **Names instead of IDs**: members, lists and categories can be referred to by name (`"member": "Maya"`, `"list": "Groceries"`). Matching is case-insensitive. An ambiguous name returns an error that lists the matches.
* **Household time**: "today" means today in the household timezone. `get_household` returns that timezone.
* **Profile pictures**: members carry `picture`, the address of their [profile picture](../using/profiles.md#profile-pictures) or `null`, never the image itself. No tool sets or removes one.

## Health entries

[Health](../using/trackers.md#health-) entries stay private to the family's own devices until a parent turns on **Let connected apps see health entries** under **Settings → Access → Connected apps**. It's off by default, for every family. While it's off:

* `list_tracker_entries` leaves health out, including from its search and its count. Asking for `kind: "health"` returns an error: "Health entries are private to the family's own devices. A parent can allow connected apps to see them in Settings → Connected apps."
* `add_tracker_entry`, `update_tracker_entry` and `delete_tracker_entry` refuse health entries with the same message.
* No other tool returns health data: profiles, the snapshot, the board and notifications never include it. There's no Temp check or journal tool, and the only medication tools are the refill ones below, which, like `/api/medications`, refuse connected apps until a parent turns on health for connected apps (medication reminders never show in `list_notifications`); members carry their `tempCheck` settings and `todayGoal`, never sleep, feelings or goal check answers, and on REST `/api/members/{id}/temp-check` withholds them and `/api/members/{id}/journal` and `/api/members/{id}/insights` and `/api/members/{id}/battery` refuse (403). A [private journal](../using/journal.md#private-journals) entry's words and notes are never returned to a connected app, even with that switch on. There's no Insights or energy battery tool either.

This applies to every MCP call, whichever key it uses, and to a connected app's OAuth token when it calls the [REST API](rest-api.md) directly (`/api/trackers` and `/api/export` leave health out). A connected app can't turn the switch on itself. The family's own devices aren't affected: the web app, passkey sign-ins, Kinwall's own phone app, and API keys the family created, which count as the family's own when used on REST. Turned on, health works over MCP as it does in the app (still admin keys only).

## Two ways to authenticate

### OAuth 2.1 (sign-in)

The sign-in flow: no key to copy, and each app gets its own revocable grant. Kinwall is its own authorization server:

1. Add `https://<your-kinwall>/mcp` as a custom connector in your client.
2. The client discovers Kinwall's OAuth metadata (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) and registers itself automatically.
3. Your browser opens Kinwall's consent screen: "*App* wants to use Kinwall". Sign in as an admin with a passkey, or with an admin API key, then choose:
   * **Full access**: "Everything you can do as an admin, including members and settings."
   * **Everyday access**: "Calendar, chores and lists. No members, settings or keys." This is the display scope.
   * **Deny**.
4. Connected apps are listed and revocable under **Settings → Access → Connected apps**.

The consent screen shows where you'll return afterward: a website's address, **the Kinwall app**, or, for another app's own link, **an unverified app** with that link's scheme. The app's name is whatever it registered itself as, so check the address before approving.

### What connected apps can't do

Even with full access, a connected app uses the family's data but never manages how anyone signs in. Over MCP (whatever key it uses) and with a connected app's OAuth token on the [REST API](rest-api.md), Kinwall refuses (403) creating, changing or removing API keys and device keys, recovery codes, adding or removing passkeys, approving a display pairing, saying whose device a sign-in is, changing the sign-in providers or the public address, managing connected apps, and turning on [health for connected apps](#health-entries). So disconnecting an app under **Settings → Access → Connected apps** always ends everything it could do. A connected app also can't subscribe to push notifications (a subscription is a person's device, and a parent's can ask for medicine names) or create, change, rotate or delete [webhooks](webhooks.md) (they report when health, journal and Temp check entries change): `POST/PATCH/DELETE /api/push/subscriptions*`, `POST /api/push/test/{id}` and `POST/PATCH/DELETE /api/webhooks*` return 403. It can't add or update [activities](../using/activities.md#activities-from-others) either (`POST /api/plugins` and `POST /api/plugins/{id}/update` return 403), since that puts new code on the kids' tablets. Do these from a parent's own device. Every caller, connected apps included, can start at most 10 polls and ask for orders at most 10 times an hour per family (then `429`), since each one notifies everyone. Kinwall's own phone app counts as a parent's device, not a connected app.

Details: authorization code with **PKCE S256 only**, public clients, and redirect URIs that must be https, loopback, or an app's reverse-domain link (like `com.example.app:/oauth`). The Kinwall app's own link (`family.kinwall.app:`) can't be registered together with any other redirect, and a sign-in counts as the Kinwall app only when it used that link. Codes last 5 minutes and work once. Access tokens last 1 hour. Refresh tokens last 90 days and rotate on every use; reusing an old one revokes the whole grant. The one exception is a race: the same refresh token sent again by the same client within 30 seconds gets the same new pair back, so two requests refreshing at once don't sign the app out. `POST /oauth/revoke` is supported. `POST /oauth/register` takes 20 registrations an hour from one address (then `429` with `error: "temporarily_unavailable"`); a registration nobody approves is dropped after a day, or sooner once more than 100 are waiting (oldest first).

### Bearer key

Any API key in an `Authorization` header. Use a **display** key for an everyday assistant. It can add and complete events, chores and lists, but not manage members, accounts, keys or webhooks. Use an **admin** key only if the assistant needs `add_member`, `update_member`, `send_notification`, `set_night_screen` or the chore library tools.

## Connecting clients

**Claude (web, desktop, mobile)**: **Settings → Connectors → Add custom connector**, URL `https://<your-kinwall>/mcp`. This uses OAuth.

**Claude Code**:

```bash
claude mcp add --transport http kinwall https://<your-kinwall>/mcp --header "Authorization: Bearer <key>"
```

**Clients that take a JSON config** (Claude Desktop's `claude_desktop_config.json` and similar):

```json
{
  "mcpServers": {
    "kinwall": {
      "url": "https://<your-kinwall>/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

**ChatGPT, Gemini and others**: any client that supports remote MCP servers over Streamable HTTP works. Give it the URL `https://<your-kinwall>/mcp`, and either let it sign in with OAuth or configure an `Authorization: Bearer <key>` header, depending on what the client supports. Where each client keeps that setting changes often, so check its own documentation.

Kinwall shows its own icon in clients that display server icons.

## Tools

Every tool carries MCP annotations (read-only / destructive / idempotent / open-world). Clients such as Claude can use them to group permissions as read, write and delete.

### Read

| Tool | Does |
|---|---|
| `get_household` | Settings (family name, timezone, week start, color scheme), members and a calendar summary, with each calendar's `filter`. |
| `list_color_schemes` | The household's color scheme and every scheme it can use: Seasonal, the built-in schemes by the name people see (Peacock, the deep blue one, is the default; Eucalyptus the gray-teal one, Peach the warm one, Meadow the soft green one), and the family's own schemes with their light and dark palettes. |
| `list_events` | Events across all calendars in a range (default: today plus 7 days, at most 400 days). Can filter by member or calendar. [Hidden events](../using/calendar.md#hiding-events) and events a [calendar filter](../using/calendar.md#calendar-filters) leaves out aren't listed, here or in `get_board` and `get_snapshot`. |
| `get_event` | One event by ID (the series row for a recurring local event). |
| `get_event_items` | List items linked to an event, across all lists, open first, with list names. |
| `list_chores` | Chores due on a date (default today), with completion state. |
| `get_leaderboard` | Points, completions and streaks per member for today, week (default) or month. |
| `get_member_profile` | One member's [profile](../using/profiles.md) stats (by name or ID) for `period` `today`, `week` (default), `month`, `year` or `all`: chores done and points (chores plus daily check-ins and bonus points, with the same stretch before), daily check-ins, points spent, streak and best streak, books, sticker book, activity time, badges and birthday countdown. Read-only. |
| `get_points` | One member's points (by name or ID): balance left to spend, all-time earned and spent, and recent ledger entries (purchases, check-ins and bonus points with their notes). Read-only. Stickers are bought on the wall, not over MCP; rewards can be redeemed with `redeem_reward`. |
| `get_snapshot` | One member's day (`range`: `day`, default) or next 7 days (`week`), by name or ID: greeting, weather (if a location is set), their and everyone's events, their chores, their due or high/urgent list items, family birthdays, the day's meals, (day) tomorrow at a glance, and whether they've done today's [daily check-in](../using/snapshot.md#daily-check-in) (`checkedIn`, `checkInPoints`). The same data as tapping their avatar. A [feature](../settings/general.md#features) that's off comes back empty: no chores while Chores & points is off, no list items while Lists is off. |
| `get_board` | The whole household's bulletin board for today and the next `days` days (default 7, max 14): everyone's events plus untagged ones, open list items due soon, overdue or high/urgent, today's chores per member (and `timedChores`: today's chores with a start time or a timer), birthdays and meals. The same data as the calendar's Board view. A [feature](../settings/general.md#features) that's off comes back empty: no chores while Chores & points is off, no list items while Lists is off. |
| `list_lists` | All lists with item and open counts. A shopping list's `catalog` is its type: `groceries` or `shopping`. |
| `get_list` | One list by ID or name, with items (in the list's sort order, each with its steps and, on a shopping list, its aisle at each store), group order, store/category/aisle suggestions (shopping lists only; since 2026-09-30 other lists get empty ones) and stores' aisle orders. With `store`, also the list as shopped there: items in that store's aisle order with their aisle, then those with no aisle known there, then those planned for other stores. An item with no aisle known there takes the store's aisle named like its category (its department), if there is one. |
| `list_categories` | Categories (name, emoji, color, keywords) in order. |
| `list_notes` | The notes thread on an event or list item (`target`: `event:<id>` or `list_item:<id>`), oldest first. `memberId` null means "Someone". |
| `list_recipes` | [Meals](../using/meals.md) recipes with their ingredients. Filters: `search`, `category`, `archived`, `kind` (`meal` or `basic`). |
| `get_recipe` | One recipe by ID. |
| `list_restaurants` | The family's [restaurant binder](../using/meals.md#restaurants): each place's phone, address, website, ordering link, notes and menu (`favorite` marks the family's starred items). `search` matches a name, cuisine or menu item; `archived: true` includes archived places. |
| `get_restaurant` | One restaurant by ID or exact name, with its menu. |
| `list_meals` | Planned meals from `from` through `to` (default: that day plus six). |
| `get_meal_projection` | The shopping preview for a date range: each ingredient's scaled total, the meals it's for, and (with `listId` or `listName`) what's already on that list. Admin key only. |
| `list_tracker_entries` | [Trackers](../using/trackers.md) entries, newest first: books, memories and health visits. Filters: `kind`, `member`, `from`, `to`, `q`. A book joins the family's library too (linked by `data.bookId` to the book with the same title and author, or added as a book the family has, even for "want"; the wishlist is only books added with `wanted: true`). Health only with an admin key, and only once a parent turns on [health for connected apps](#health-entries). |
| `get_medication_refill` | A [medicine's refill card](../using/medications.md#refills): where to ask (app, website, phone number with the phone menu in words and a `tel:` link that dials it), the pharmacy, the message to leave (filled in; blanks nobody entered are in [brackets]) and any open refill to-do. `medicine` by name or id, `member` when two people's medicines share a name. Only with [health for connected apps](#health-entries) on. |
| `request_medication_refill` | Adds the "Request refill" to-do for a medicine (one open per medicine: asking again returns `created: false`), or with `done: true` closes it. Contacts nobody. Only with health for connected apps on. |
| `set_medication_pharmacy` | Full access: sets a medicine's pharmacy, by a contact's name or id (pharmacy-looking contacts win a tie), or a typed name when it isn't a contact; `''` clears it. Only with health for connected apps on. |
| `search_books` | Looks a book up by title, author or ISBN through [Open Library](https://openlibrary.org) (the server asks; only the search is sent): title, author, year, pages and `coverUrl`, to fill `add_tracker_entry`. |
| `list_library` | The family's [library](../using/trackers.md#library): books they own or borrowed, with series, reading level, description, genres, Open Library ratings, `format` (`book` or `audiobook`, each its own item) and readers (when each last read, `readAt`; an audiobook's narrator and listening progress). `q` searches; `format` keeps only books or only audiobooks, `unread` keeps books nobody has started, `lent` books on loan, `borrowed` borrowed books still out (soonest due first), `returned` borrowed books that went back, `wanted` the wishlist, `location` one place, `shelf` (`kids` or `grownups`) one shelf. Each book has `shelf` (a parent's pick: `kids`, `grownups`, `everyone` or `null` for Auto) and `effectiveShelf` (the shelf it's on). |
| `add_to_library` | Adds a book the family owns, borrowed (`borrowedFrom`, `dueOn`) or wants (`wanted`, the wishlist), as a book or an audiobook (`format`): an `isbn` alone looks it up (details and description); or a title, with details from `search_books`. A book already there (same ISBN) isn't added twice. |
| `refresh_library_book_details` | Looks a library book up on [Open Library](https://openlibrary.org) now (by ISBN, else title and author) and fills in only what it's missing: description, year, series, genres, reading level, pages, cover, ISBN (not for an audiobook), plus Open Library's ratings. `book` is its id or title. |
| `update_library_book` | Lends a book out (`lentTo`, dated today), brings it back (`lentTo: null`), sets where it lives (`location`) or fixes details. A borrowed book: a new due date (`dueOn`), returned (`returnedOn`; it stays as history), or borrowed again (`returnedOn: null`). A wishlist book: got it (`wanted: false`). `format` fixes whether it's a book or an audiobook. `shelf` puts it on the `kids`, `grownups` or `everyone` shelf (`null` for Auto; needs a parent's access). `book` is its id or title. |
| `list_newscast` | [Newscast](../using/newscast.md): what the family did and shared, newest first, grouped per person per day (chores, rewards, photos and drawings, books, memories, birthdays, announcements) with reactions. Takes `days` (default 7) and `before` (YYYY-MM-DD). Never health, journals, check-ins or points. Read only: there's no tool to post. |
| `list_polls` | [Family polls](../using/polls.md), open ones first (`status` to pick open or closed): each choice with the member IDs who voted for it, the winner once closed, and the meal planned from it. |
| `list_activity_actions` | [Activities](../using/activities.md#activities-from-others) that take actions, each action's description and the input it takes (properties with types, which are required). See [Actions](../contributing/plugins.md#actions). |
| `get_activity_data` | What an activity saved for one person (`member` by name or ID; omit for the family's shared data), as `{ key: value }`. The format is the activity's own. |
| `list_notifications` | Recent notifications Kinwall sent (reminders, summaries, chore nudges, list updates, messages), newest first. The same feed as the bell in the app. Takes `limit` and `before`. |

### Write

| Tool | Does |
|---|---|
| `create_event` | Creates an event, on `calendarId` or, left out, the family's [default calendar for new events](../settings/calendars.md#calendars). `start` and `end` are ISO date-times with `Z` or a UTC offset (`2026-09-24T14:00:00Z`), or `YYYY-MM-DD` dates for an all-day event; `rrule` repeats daily or slower (`FREQ=DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`); a repeat that never happens, like the 30th of February, is refused. Writes to Google, Outlook or CalDAV for those calendars. Accepts `description` (the event's [notes](../using/events.md#event-notes), plain text), `travelMinutes`, `remindBeforeLeave` and `busy` (`false` = [free](../using/events.md#free-or-busy), like a delivery window). |
| `update_event` | Changes only the fields you give it (the whole series for recurring local events), with the same rules for `start`, `end` and `rrule` as `create_event`. `description` replaces the event's notes; `""` clears them. |
| `set_event_category` | Sets or clears an event's category (by name). Clearing falls back to keyword or calendar default. |
| `run_activity_action` | Asks an activity to do one of its actions for a person: `activity` and `member` by name or ID, `action`, and `input` as `list_activity_actions` describes it. For example, Spelling practice's `addList` with `{ title, words, testDate }` adds a spelling list. It's queued and applies the next time that person opens the activity; the input's shape is checked first. Full access. |
| `reset_activity_time` | Resets one person's counted play time for an activity (`activity` and `member` by name or ID, optional `date`, default today) so its [activity chores](../using/chores.md#activity-chores) count from zero again. A chore the play already completed stays done; `uncomplete_chore` undoes that. Full access. |
| `create_chore` | Creates a recurring or one-off chore. `dueTime` (HH:MM) is when it starts and `timerMinutes` how long its [timer](../using/chores.md#start-time-and-timer) runs. `list` links a checklist (a list by name or ID) that has to be ticked off before the chore completes. `needsApproval` and `approveTimedPlay` set [parent approval](../using/chores.md#parent-approval). |
| `update_chore` | Changes title, emoji, assignee, points, recurrence (`RRULE`, optional `UNTIL`), due date, start time (`dueTime`), timer (`timerMinutes`, or `null` to remove), checklist (`list`, or `null` to unlink), parent approval (`needsApproval`, `approveTimedPlay`), or active state. |
| `complete_chore` | Marks a chore done for a date (default today). The date has to be a day the chore is due on; a display key can use the last 7 days, today, or one day ahead. Refused while the chore's checklist has open items. From a display key, a chore that needs a parent's OK waits for approval instead. |
| `uncomplete_chore` | Undoes a completion. |
| `list_pending_approvals` | Chores waiting for a [parent's OK](../using/chores.md#parent-approval), oldest first, with the points approving would award (admin). |
| `approve_chore` | Approves a waiting chore for a date (default today) and awards its points (admin). |
| `award_points` | Gives a member (by name or ID) [bonus points](../using/chores.md#bonus-points) outside a chore: `points` 1-500, an optional `note` (up to 80 characters) and `date` (default today, never ahead). They count like chore points but not toward streaks; the member's own devices are told (admin). |
| `delete_point_award` | Takes back a bonus given by mistake, by the award ID from `award_points` or a `get_points` entry with reason `bonus` (admin). |
| `reject_chore` | "Not yet": removes a waiting chore's tick, with an optional `note` the kid sees on the card (admin). |
| `list_chore_library` | The [chore library](../using/chores.md#chore-library): saved chores that aren't on a schedule, with points, checklist, suggested person, the soft "about every" interval, when one was last done and by whom, and any still to do (admin). |
| `assign_chore_from_library` | Hands out a library chore: a normal chore due on `date` (default today) for `member` (default: its suggested person; `null` for anyone), with its points, checklist and approval rule. `rrule` makes it repeat instead (admin). |
| `list_rewards` | [Rewards](../using/rewards.md); `member` (name or ID) narrows to the ones for them, `archived` includes archived ones. |
| `create_reward` | Adds a reward: `title`, `emoji`, `cost`, `members` (names or IDs; empty for everyone), `needsApproval` (default true) and `limit` (`{ count: 1-20, period: "day" \| "week" }` or `null`). Admin. |
| `update_reward` | Changes a reward's fields; `active: false` archives it. Admin. |
| `redeem_reward` | Spends a member's points on a reward. From a display key, a reward that needs a parent's OK waits for approval. Refused when short of points or over its limit. |
| `list_reward_requests` | Requests a parent still has to act on (waiting, or approved and not given), oldest first; `status` and `member` filter. |
| `approve_reward` | Approves a waiting request (admin). |
| `decline_reward` | "Not this time": declines a waiting request, or cancels an approved one, and gives the points back, with an optional `note` the kid sees (admin). |
| `mark_reward_given` | Marks an approved request as given (admin). |
| `add_member` | Adds a family member (admin), optionally with a `birthday` (`YYYY-MM-DD`, or `--MM-DD` without a year) and `grownUp` (a parent or other adult; default false). |
| `update_member` | Changes a member's name, color, avatar, `birthday` (`null` clears it), `needsApproval` (their chores need a parent's OK by default; ignored for a grown-up) or `transitionReminders` (see [Transition reminders](../settings/family.md#transition-reminders)). Admin. It can't change `grownUp`: who is a grown-up decides who reads their [private journal](../using/journal.md#private-journals), so a parent sets it on their own device. |
| `create_list` | Creates a groceries, shopping, to-do or reusable list. `shopping` without a type makes a list named like groceries (or the family's first shopping list) a Groceries list. |
| `update_list` | Renames, changes kind (`groceries`, `shopping`, `todo`, `reusable`), emoji, owners, item sort (`sortBy`: `manual`, `added`, `due`, `priority`, `alpha`, `aisle`), grouping (`groupBy`: `store`, `category`, `aisle`, `none`; shopping lists use `aisle` for `category`), whether checked items stay in place (`keepChecked`), makes a shopping list its type's default (`isDefault`), or archives a list. Everyday access may change only `sortBy`, `groupBy` and `keepChecked`. |
| `add_list_items` | Adds items: plain titles or objects (notes, quantity, store, category (a shopping item's department), aisle, member, forMembers, dueDate, eventId, priority, steps). `forMembers` is who the item is for (names or ids; left out = everyone). `steps` is a list of step titles in order. On a shopping list, a store, category or aisle left out comes from what the family used last time for that item. With no `listId` or `listName` ("add milk"), items go to the family's default Groceries list, else the first Groceries list. |
| `update_list_item` | Edits an item's title, notes, quantity, store, category, aisle, assignee, who it's for (`forMembers`, replacing the whole set; `[]` = everyone), due date, linked event or priority (`low` / `normal` / `high` / `urgent`). |
| `set_store_aisle_order` | Sets the order a store's aisles are walked in (`store`, `aisles`), e.g. Produce, Bakery, Aisle 4, Frozen, Aisle 5, Dairy. Aisle sort and trips follow it. |
| `move_list_items` | Moves items (by id or title) from one list to another of the same type, keeping everything on them. |
| `list_remembered_items` | A catalog (`catalog`: `groceries`, the default, or `shopping`): every item the family has added before to lists of that type, with its department, its categories (`tags`) and the stores it's found at, each with its aisle there. `search`, `store` and `tag` (a category) filter. |
| `update_remembered_item` | Edits a catalog item (by `name` or key; `catalog` as above): `title`, `category` (department), `tags` (its categories, e.g. `["Breakfast", "Lunchbox"]`; replaces them) and `places` (`[{store, aisle}]`, replaces its stores). `create: true` adds it when it isn't there yet. |
| `set_list_item_done` | Ticks or unticks an item, and all its steps with it. Items it ticks show **Checked off by Assistant**, like items added through MCP show **Added by Assistant**; `get_list` returns `addedBy` and `checkedBy` on items and steps (`{memberId}` or `{label}`, or null). |
| `set_step_done` | Ticks or unticks one step of an item (step IDs come from `get_list`). Ticking the last open step completes the item; unticking a step of a done item re-opens it. |
| `add_note` | Adds a note to an event's or list item's thread, posted as a member (by name or ID) or "Someone". |
| `update_note` | Replaces a note's text (note IDs come from `list_notes`). |
| `create_recipe` | Adds a recipe with its ingredients (admin). `kind: "basic"` makes it a [basic](../using/meals.md#basics) (a seasoning blend, sauce or dough), with `makes` ("about ¼ cup"); an ingredient's `basicId` links it to a basic. |
| `update_recipe` | Edits a recipe, replaces its ingredients, or archives it (admin). Planned meals keep their own copy. An ingredient sent without `basicId` keeps the link it had (same name and unit); `basicId: null` unlinks it. |
| `rate_recipe` | Sets a family member's 1-5 star rating of a recipe (`recipeId`, `memberId` as name or ID, `stars`; `0` or `null` clears it). Recipes read by `list_recipes` / `get_recipe` include `rating: { average, count, byMember }`. |
| `import_recipe` | Imports a recipe from another app, such as a meal kit (admin): ingredient lines like "1.5 tablespoon Sour Cream" are parsed, and importing the same `source` + `externalId` again updates it. With `plan` it's also planned on that date and slot unless the slot is taken (`planned: false` with the `reason`); `plan.calendarId` also puts it on that calendar (any writable one) and `plan.eventStart: "cooking"` starts the event when cooking starts. |
| `import_recipe_from_url` | Reads the recipe on a web page (admin): name, photo, servings, times, ingredients and steps. It only previews unless `save: true`, which saves it keyed by the page's address, so importing the same page again updates it; a preview of a page already imported names that recipe (`updates`). A page without recipe data fails, so the assistant can ask for the recipe text and use `create_recipe`. |
| `create_restaurant` | Adds a restaurant to the binder, optionally with its `menu` (admin). |
| `update_restaurant` | Edits a restaurant (by ID or exact name), archives it (`archived: true`), or replaces its `menu` (admin). Keeping an item's `id` keeps its star. Good for a photo of a paper menu: the assistant reads the items off it and sends them here. |
| `import_restaurant` | Adds a restaurant, or adds to one already in the binder matched by name (admin), like the [restaurant shortcut](../using/meals.md#add-restaurants-from-your-phone): fills only empty fields and adds `menu` and `menuText` items not already on the menu (same name in the same section), so a menu can come in page by page and stars are never touched. `url` is the restaurant's web page (its details are read) or an Apple Maps link. Answers with a one-line `summary`. Good for a photo of a paper menu. |
| `set_meal_order` | Sets a family member's order (`member` as name or ID) for a dining-out meal: `items` (`[{ menuItemId, name, qty, note }]`, menu item IDs from `get_restaurant`) and a `note`. No items and no note clears it. Once a parent marks the meal ordered, only full access can change it. `list_meals` returns each meal's `orders`. |
| `ask_for_orders` | Asks who's eating a dining-out meal what they want: a notification in the bell and on their phones (admin). |
| `create_meal` | Plans a recipe, free-form meal or dining out on a date and slot, optionally for a `member` (admin). Dining out can name a `restaurantId` from the binder (its name becomes the meal's) and `orderType` (`dine_in`, `pickup`, `delivery`). |
| `update_meal` | Edits a meal (admin), or its notes and status from the assigned person's device. `refreshRecipe` takes the recipe's current ingredients. A calendar event Kinwall made for the meal follows the change; a linked event of your own doesn't. |
| `apply_meal_projection` | Adds the previewed ingredients to a shopping list (admin), minus `omitKeys`, and minus meal-kit ingredients that ship in the box unless `includeKitItems`. Items made from a [basic](../using/meals.md#basics) (`basicId`) take `basics: { "<basicId>": "made" | "ingredients" }`: made already skips it, ingredients adds what goes into it instead. Repeating it doesn't add anything twice. |
| `add_tracker_entry` | Logs a book or audiobook (`data.format: "audiobook"` with `totalMinutes`), a memory or a health visit (`kind`, `member`, `date`, `title`, `data`). Health only with an admin key, and only once a parent turns on [health for connected apps](#health-entries). |
| `update_tracker_entry` | Edits an entry, for example pages read, minutes listened or a rating. `data` is merged; `null` clears a field. `logDay` ({ date, amount }) logs or fixes a book's reading on an earlier day, moving the page by the difference. Health entries only once a parent turns on [health for connected apps](#health-entries). |
| `create_poll` | Starts a [family poll](../using/polls.md) and notifies everyone (admin): `question`, `ideas` (typed choices), `recipes` and/or `restaurants` from the binder (IDs or exact names; both need Meals on), at least two in all, and optional `date` and `slot` for the meal it decides. |
| `vote_poll` | Sets, changes or takes back (`option: null`) a member's vote (`member` by name or ID, `option` by label or ID) in an open poll (`poll` by ID or exact question; left out, the one open poll). A person's own device votes only for them. |
| `close_poll` | Ends voting on a poll and picks the winner (admin): `option`, else the most votes (a tie goes to the first listed). On a poll whose voting already ended, it changes the winner. Plan the winning meal with `create_meal`. |
| `update_category` | Changes a category's name, emoji, color or keywords. Admin. |
| `send_notification` | Pushes a message now to devices following given members, or all devices (admin). It also appears in the in-app notification feed. |
| `set_night_screen` | Starts (`on: true`) or ends (`on: false`) the [Night screen](../using/night.md#start-it-from-home-assistant) on every wall screen, or on `displays` (paired display names or IDs). "On" runs out after `hours` (default 12). A tap still wakes a wall. Full access. |
| `set_color_scheme` | Sets the household's color scheme by name ("Peach", "Meadow", "Seasonal", or one of the family's own). Devices that follow the family setting switch to it; a device that picked its own scheme in the app keeps it. |
| `save_color_scheme` | Creates one of the family's own schemes, or overwrites one (`replace`). Takes four colors per mode (`light` and `dark`: `bg`, `card`, `text`, `accent`). Refused, with the ratios that fell short, unless text and dim text reach 4.5:1 on the background and cards in both modes. Up to 10 per family. `use: true` also makes it the household's scheme. |

### Delete

Deleting is permanent: nothing here can be undone. Events, lists, list items, steps and notes can be deleted with **Everyday access** (or a display key), as in the app. Everything else needs **Full access** (or an admin key). Where there's a gentler option, the tool's description points the assistant to it: archive a list, recipe or reward, or turn a chore off with `active: false`. Lists, recipes and rewards are matched by ID or exact name only, never part of a name.

| Tool | Does |
|---|---|
| `delete_color_scheme` | Deletes one of the family's own schemes. If the household was using it, the household goes back to Peacock, the default. |
| `delete_event` | Deletes an event (the whole series for recurring local events). This also deletes it at the provider. |
| `delete_list` | Deletes a list (by ID or exact name) with all its items, their steps and notes, and its groups. Admin. |
| `delete_list_item` | Deletes an item from a list, with its steps and notes. |
| `delete_list_step` | Deletes one step of an item. If every remaining step is done, the item becomes done. |
| `delete_note` | Deletes one note from an event's or list item's thread. |
| `delete_chore` | Deletes a chore. One that was ever done is archived instead: it leaves every list, but its completion history and the points earned from it stay. `update_chore` with `active: false` pauses it instead. Full access. |
| `delete_tracker_entry` | Deletes a book, memory or health entry. A memory's own photo goes with it, unless it's also a family photo. Full access. Health entries only once a parent turns on [health for connected apps](#health-entries). |
| `delete_meal` | Deletes a planned meal and the calendar event Kinwall created for it. A linked event of your own and groceries already on a list stay. Full access. |
| `delete_recipe` | Deletes a recipe (by ID or exact name) and its ingredients. Planned meals keep their own copy. Full access. |
| `delete_reward` | Deletes a reward (by ID or exact title). Past requests stay in history; anyone saving for it loses that goal. Full access. |

Members, calendars, API keys, webhooks and photos can't be deleted over MCP. Those are too destructive or sensitive for a chat tool, so do them in Kinwall's settings.

## Native apps

The same OAuth server signs in native apps, such as Kinwall for iPhone, iPad, Apple Watch and Android, built from the [kinwall-mobile](https://github.com/JohnDuprey/kinwall-mobile) repository. They aren't on the App Store or Play Store yet, so for now you build and install one yourself from that repo. Besides `https` and loopback `http` redirect addresses, registration accepts an app's own reverse-domain link scheme (RFC 8252), like `family.kinwall.app:/oauth`. Single-word schemes such as `javascript:` or `data:` are always refused. The consent screen then says you'll return to "the app".

For Kinwall's own app (redirect `family.kinwall.app:/oauth`), the consent screen also asks **Whose device is this?**: **Shared** or one family member, **Shared** preselected. The choice becomes the owner of the grant's keys and of the widget and watch keys the app creates from them. With **Everyday access** it pins the app to that member, as with a paired display; with **Full access** it only sets personal defaults. MCP clients and other apps aren't asked and have no owner. See [Settings → Access](../settings/access.md#connected-apps).

On the consent screen, an admin can sign in with a passkey, a recovery code, or an admin API key. Someone who signs in without a passkey is offered **Create a passkey** before approving, so next time is quicker. On a server that hasn't been set up yet, the consent link runs the setup wizard first, then continues to the approval.

## Output schemas

Every tool declares an **output schema** that matches the REST response shapes (`EventInstance`, `ChoreDay`, `ListDetail`, `LeaderboardEntry`…). A successful call returns:

* a short human summary ("Added 2 items to Groceries."),
* the same data as a JSON text block, for clients that ignore structured output,
* `structuredContent`, validated against the schema.

For example, `list_events` returns `{events: EventInstance[]}` and `complete_chore` returns `{ok: boolean}`. Array arguments sent as JSON text (`"[15]"`) and booleans sent as text (`"true"`, `"false"`) are accepted too.

The schemas allow extra fields: Kinwall adds fields over time, and a client that cached the tool list keeps accepting results instead of failing with "Structured content does not match the tool's output schema".

## Household contacts

Tools: `list_contacts` (with an optional search), `get_contact`, `create_contact`, `update_contact`, `delete_contact`, `preview_contact_import`, `import_contacts`, `merge_contacts`, and `list_contact_categories`, `create_contact_category`, `update_contact_category`, `delete_contact_category`. Reads follow the connection's access: full access sees every contact; everyday access sees what that device may (see [Who can see a contact](../using/contacts.md#who-can-see-a-contact)). Changes need full access. `preview_contact_import` and `import_contacts` take contact drafts, not vCard text.
