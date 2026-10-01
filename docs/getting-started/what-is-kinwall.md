# What is Kinwall

Kinwall is a family life organizer you host yourself: one calm place for the household's moving parts, from calendars, chores and lists to meals, routines, medicines, contacts and memories. It's not one more app for one busy grown-up; it's where the whole family keeps its plans, so nobody has to carry it all in their head.

The main screen is a touch-first Board meant to hang on the wall (usually a tablet, like an iPad in Guided Access), readable from across the room. Everyone else uses the same app on their phone, and kids can check off their own chores and routines on the wall or on a tablet paired as their own device. It's built with neurodivergent family members in mind (see [Accessibility](../accessibility.md)), and it's free and open source (AGPL), with every feature in the open-source app.

Use all of it or just a few parts: anything you turn off disappears from every screen.

![Month view on the wall iPad](../screenshots/ipad-month.png)

## What it does

| Area | In short | Read more |
|---|---|---|
| Board | The first screen: a big clock, the weather and forecast, today, coming up, chores, items due soon, meals, a family photo and a quote, fun fact, "On this day", trivia question or tip. Each screen can have its own layout. | [Board view](../using/calendar.md#board-view), [Board layouts](../using/calendar.md#board-layouts) |
| Calendar | Board, Day, Week, Month and Schedule views. On phones the week becomes a 3-day view. Color-coded by family member or category. | [Calendar](../using/calendar.md) |
| Events | Create and edit events. Changes go back to Google, Outlook and CalDAV. You can add reminders, a travel time with a leave-by time, members, a category and linked tasks. | [Events](../using/events.md) |
| Calendars | Google, Microsoft 365 / Outlook, iCloud and other CalDAV servers, and any ICS URL. Filter a busy calendar down to what matters, or hide one event or a whole series. | [Connecting calendars](../calendars/google.md), [Calendar filters](../using/calendar.md#calendar-filters) |
| Snapshot | Tap a person for their day or week: events, chores to tick off, things due and birthdays. | [Daily & weekly snapshot](../using/snapshot.md) |
| Chores | One-off or recurring chores with points, streaks, a leaderboard, optional checklists, activity chores ("5 min of Sight words") that complete themselves, and optional parent approval. | [Chores](../using/chores.md) |
| Rewards | Parent-defined rewards kids spend chore points on, with limits, goals to save for and optional parent approval. | [Rewards](../using/rewards.md) |
| Profiles | A page for each person: chores and points by period, streaks, books, sticker book, activity time, milestone badges and a birthday countdown. | [Profiles](../using/profiles.md) |
| Lists | Groceries, Shopping, To-do and Reusable lists. Grocery and shopping items remember their store, department and aisle; Shopping mode walks the store in order. To-dos have owners, due dates and steps. | [Lists](../using/lists.md) |
| Meals | A week planner and recipe library. Import a recipe from a link, scale servings, cook along with step timers, and send the week's ingredients to the grocery list without duplicates. | [Meals](../using/meals.md) |
| Medications | Reminders at each dose time, a **Take now** card on the wall and a record of what was taken. Off until a parent turns it on, always encrypted; shared screens say "Meds", not the medicine. | [Medications](../using/medications.md) |
| Trackers | A reading log with progress and ratings, a family memories journal, and doctor and dentist visits (health stays off the wall screen). | [Trackers](../using/trackers.md) |
| Contacts | The household's people and places outside the family: the babysitter, grandparents, the school office, the pediatrician. | [Contacts](../using/contacts.md) |
| Check-ins | An optional Temp check, energy battery and evening goal check, with a private journal and insights for each person. | [Snapshot](../using/snapshot.md#temp-check), [Journal](../using/journal.md), [Energy battery](../using/battery.md) |
| Activities | Paint for kids, a sticker book decorated with stickers bought with chore points, a shared family photo album, and learning games made by others (reviewed by Kinwall, sandboxed). | [Activities](../using/activities.md), [Photos](../using/photos.md), [Building activity plugins](../contributing/plugins.md) |
| Features | Turn off what your family doesn't use (chores, lists, meals, contacts, Paint, photos, notes, messages, each tracker) and it's hidden everywhere. | [Features](../settings/general.md#features) |
| Look and feel | Light, dark or scheduled dark mode, sixteen color schemes (Sage is the default, or seasonal) plus your own, four text sizes, seven typefaces (including Hyperlegible and Dyslexia-friendly) and low-stimulation mode, for the family or per device. | [Appearance](../using/appearance.md) |
| Routines and reminders | A Now / Next strip with a countdown, transition reminders before the next thing or the leave-by time, and timers anyone can start from the header. | [Now / Next](../using/calendar.md#now--next), [Transition reminders](../settings/family.md#transition-reminders), [Timers](../using/timers.md) |
| Night | During the night hours, wall screens rest on a dim clock or a photo slideshow, and reminders wait until morning. | [Night](../using/night.md) |
| Notifications | Web Push reminders, a daily summary, chore nudges and list updates, set per device. | [Notifications](../using/notifications.md) |
| Automation | REST API with OpenAPI docs, signed webhooks, an MCP server for AI assistants, a Home Assistant integration and n8n workflows. | [Integrations](../integrations/rest-api.md) |

## How it runs

New to running apps at home? Start with [Run Kinwall yourself: the easy guide](self-host-quick-start.md). It helps you pick a way and walks you through it step by step.

The same code runs in three places:

* **Cloudflare Workers**: fits the free tier, uses D1 as the database and comes with HTTPS. See [Deploy to Cloudflare Workers](deploy-cloudflare.md).
* **Docker** (amd64/arm64): a single container storing SQLite in `/data`. See [Quick start (Docker)](quick-start-docker.md).
* **Home Assistant add-on**: see [Home Assistant add-on](home-assistant-add-on.md).

Want a look first? The [live demo](https://demo.kinwall.family) runs in your browser with a sample family.

## Who can do what

Kinwall has no user accounts. Access comes from keys:

* **Admin**: a phone or computer signed in with a passkey (or an admin API key). It can do everything.
* **Display**: a paired wall screen or kid's device. It can use the calendar, chores, lists and everyday settings, but can't manage members, calendar accounts, keys or webhooks. A kid's device shows only that kid's events, chores and lists.

For details, see [Sign-in & security](../using/sign-in-and-security.md).
