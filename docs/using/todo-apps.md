# To-do apps: Todoist, Google Tasks and Microsoft To Do

A Kinwall to-do list can sync with one list in **Todoist**, **Google Tasks** or **Microsoft To Do**,
both ways: tick something off on the wall and it's done on your phone's to-do app, add something in
the app and it shows up in Kinwall.

Kinwall talks to each app through its own public API: Todoist's [API v1](https://developer.todoist.com/api/v1/),
the [Google Tasks API](https://developers.google.com/workspace/tasks) and Microsoft's
[To Do API in Microsoft Graph](https://learn.microsoft.com/graph/todo-concept-overview). They're
outside services: your list is shared with the app you pick, under that app's own terms.

## Connect an app

On a parent's device, open **Settings → Calendars → To-do apps**. It sits beside the calendar
accounts because Google Tasks and Microsoft To Do use the same Google and Microsoft sign-ins.

* **Connect Todoist**: paste your Todoist API token. To find it, in Todoist open **Settings →
  Integrations → Developer** and copy the **API token**. Kinwall checks it with Todoist, then keeps it
  encrypted with your family's key, like calendar sign-ins. Anyone with the token can see and change
  your Todoist tasks, so paste it only here.
* **Connect Google Tasks** / **Connect Microsoft To Do**: sign in with Google or Microsoft. Kinwall
  asks only for permission to your tasks, on its own (it doesn't add to what your calendars were
  given). If your calendars already come from a Google or Microsoft account, the button reads **Add
  Google Tasks to *account*** and suggests that account; you can still pick another. These buttons
  need the [Google](../calendars/google.md) or [Microsoft](../calendars/microsoft.md) sign-in set up
  first, under **Calendar providers**.

Each connected account shows the Kinwall lists it syncs. **Remove** stops them syncing; their items
stay in Kinwall and in the app. Removing Google Tasks also asks Google to end Kinwall's access, unless
the same Google account still syncs calendars (that would stop them too). A Todoist token stays valid
until you reset it in Todoist's settings; Microsoft access is removed from your Microsoft account's
app permissions.

## Sync a list

Open a to-do list, tap **Edit**, then **Sync with…**:

1. Pick the **Account**.
2. Pick the **List** there, or **Make a new one** named like your Kinwall list.
3. Tap **Start syncing**.

The first sync matches items that have exactly the same title on both sides, then copies the rest
across: open items only. Done items stay where they are. One Kinwall list syncs with one list, and
one app list with one Kinwall list.

Under the list's name, Kinwall shows where it syncs and when it last did ("🔄 Syncs with Weekend in
Todoist · synced 9:41 AM"). **Sync with…** also has **Sync now** and **Stop syncing**; stopping keeps
every item on both sides.

## What syncs

| | Todoist | Google Tasks | Microsoft To Do |
|---|---|---|---|
| Title | ✅ | ✅ | ✅ |
| Done / not done | ✅ | ✅ | ✅ |
| Due date | ✅ | ✅ | ✅ |
| Notes | ✅ (description) | ✅ | ✅ (note) |
| Priority | ✅ | — (Google Tasks has none) | ✅ (importance) |
| New items, deleted items | ✅ | ✅ | ✅ |

**Priority.** Todoist's four levels match Kinwall's: P1 is **Urgent**, P2 **High**, P3 **Low**, and
P4 (Todoist's "no priority") is **Normal**. Microsoft To Do has three: low, normal and high. An
**Urgent** item is **High** in To Do and stays Urgent in Kinwall until someone changes it in To Do.

**Due dates.** Kinwall items have a day, not a time. A Todoist task due at a time shows on the day
that time falls on at home; changing something else in Kinwall keeps its time in Todoist. Google Tasks
and To Do keep a day too, and it stays the same day.

**Stays in Kinwall:** who an item is for, its linked event, its steps and its discussion. Subtasks
in the app stay there too, and aren't copied in as items. Recurring Todoist tasks work the Todoist
way: ticking one off moves it to its next date, and Kinwall shows it open again with that date.

## When both sides change

Kinwall remembers each item's fields as both sides last agreed, and checks each field on its own:

* Changed on one side only: that side's change wins.
* The same field changed on both sides since the last sync: the side changed **last** wins, by each
  side's own time of the change. A tie goes to Kinwall.
* Deleted on one side: it's deleted on the other, even if it was edited there meanwhile.

Nothing is ever doubled up: each item keeps the app's id for its task.

## When it syncs

A few seconds after anything changes on a synced list in Kinwall, and on the calendars' schedule
(every few minutes, see [Sync behavior](../calendars/sync.md)) to pick up changes made in the app.

If the app asks Kinwall to slow down, the list waits as long as the app says (at least a minute, and
longer each time in a row) before trying again.

## When a list stops syncing

On a parent's device, the list shows a warning, like calendars do: "This list isn't syncing with
Todoist." with **Repair the connection**. Wall screens and kids' devices only see where it syncs.

* **"Todoist stopped letting Kinwall see this list. Reconnect *account* to start syncing again."**:
  the token was reset, or Google or Microsoft turned down the sign-in (a changed password, access
  removed). Tap **Reconnect** in **Settings → Calendars → To-do apps** (for Todoist, paste the new
  token). Lists keep their links.
* **"… asked Kinwall to slow down."**: nothing to do; it tries again on its own.

## For developers

The routes are under **To-do apps** in the [REST API](../integrations/rest-api.md). There are no MCP
tools for connecting apps or linking lists, the same as calendar accounts; the list tools work on a
synced list as usual and the change syncs on its own.
