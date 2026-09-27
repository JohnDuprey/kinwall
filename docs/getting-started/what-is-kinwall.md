# What is Kinwall

Kinwall is a family calendar, chore chart and list app you host yourself. The main screen is a touch-first calendar meant to hang on the wall (usually an iPad in Guided Access). Everyone else uses the same app on their phone.

![Month view on the wall iPad](../screenshots/ipad-month.png)

## What it does

| Area | In short | Read more |
|---|---|---|
| Board | The first screen: a big clock, the weather and forecast, today, coming up, chores, items due soon, a family photo and a quote, fun fact, "On this day", trivia question or tip. | [Board view](../using/calendar.md#board-view) |
| Calendar | Board, Day, Week, Month and Schedule views. On phones the week becomes a 3-day view. Color-coded by family member or category. | [Calendar](../using/calendar.md) |
| Events | Create and edit events. Changes go back to Google, Outlook and CalDAV. You can add reminders, a travel time with a leave-by time, members, a category and linked tasks. | [Events](../using/events.md) |
| Calendars | Google, Microsoft 365 / Outlook, iCloud and other CalDAV servers, and any ICS URL. | [Connecting calendars](../calendars/google.md) |
| Snapshot | Tap a person for their day or week: events, chores to tick off, things due and birthdays. | [Daily & weekly snapshot](../using/snapshot.md) |
| Chores | One-off or recurring chores with points, streaks, a leaderboard, optional checklists, and activity chores ("5 min of Sight words") that complete themselves. | [Chores](../using/chores.md) |
| Lists | Shopping, to-do and reusable lists. Items remember their store and category. | [Lists](../using/lists.md) |
| Meals | A week planner and recipe library. Servings scale the ingredients, and the week's groceries go to a shopping list without duplicates. | [Meals](../using/meals.md) |
| Trackers | A reading log with progress and ratings, a family memories journal, and doctor and dentist visits (health stays off the wall screen). | [Trackers](../using/trackers.md) |
| Activities | Paint for kids, a sticker book to spend chore points on, a shared family photo album, and learning games made by others (reviewed by Kinwall, sandboxed). | [Activities](../using/activities.md), [Photos](../using/photos.md), [Building activity plugins](../contributing/plugins.md) |
| Features | Turn off what your family doesn't use (chores, lists, meals, Paint, photos, notes, messages, each tracker) and it's hidden everywhere. | [Features](../settings/general.md#features) |
| Look and feel | Light, dark or scheduled dark mode, sixteen color schemes (or seasonal) plus your own, text size and typeface, for the family or per device. | [Appearance](../using/appearance.md) |
| Notifications | Web Push reminders, a daily summary, chore nudges and list updates, set per device. | [Notifications](../using/notifications.md) |
| Automation | REST API with OpenAPI docs, signed webhooks, an MCP server for AI assistants, a Home Assistant integration and n8n workflows. | [Integrations](../integrations/rest-api.md) |

## How it runs

The same code runs in three places:

* **Cloudflare Workers**: fits the free tier, uses D1 as the database and comes with HTTPS. See [Deploy to Cloudflare Workers](deploy-cloudflare.md).
* **Docker** (amd64/arm64): a single container storing SQLite in `/data`. See [Quick start (Docker)](quick-start-docker.md).
* **Home Assistant add-on**: see [Home Assistant add-on](home-assistant-add-on.md).

A hosted version of Kinwall is coming soon. Until then, you run your own copy.

## Who can do what

Kinwall has no user accounts. Access comes from keys:

* **Admin**: a phone or computer signed in with a passkey (or an admin API key). It can do everything.
* **Display**: a paired wall screen. It can use the calendar, chores, lists and everyday settings, but can't manage members, calendar accounts, keys or webhooks.

For details, see [Sign-in & security](../using/sign-in-and-security.md).
