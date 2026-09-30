# Home Assistant

The Home Assistant integration and add-on live in their own repository: [JohnDuprey/kinwall-homeassistant](https://github.com/JohnDuprey/kinwall-homeassistant). Entities, services and install steps are documented there.

## What the integration gives you

Install it through HACS, then add it under **Settings → Devices & Services** with your Kinwall URL and an admin API key. You get a device for each family member plus a **Family** device:

* **Calendars**: one per member, plus a read-only family calendar.
* **To-do lists**: each member's chores for today (tick one off to complete it), the **Anyone** chores, and every Kinwall list, so voice assistants and the to-do card work with your lists.
* **Sensors**: points today, points this week and chores left today, per member.
* **A binary sensor per chore**: on once it's done today. It also reports the chore's checklist progress, so an automation can wait for "the after-school checklist is done".
* **Events**: every Kinwall webhook also fires as `kinwall_<type>` on the Home Assistant event bus (for example `kinwall_chore_completed`).
* **Actions**: `kinwall.import_recipe` and `kinwall.plan_meal` put recipes and meals on the meal plan from a script or automation. `kinwall.night_screen` starts or ends the [Night screen](../using/quiet-hours.md#start-it-from-home-assistant) on wall screens. They need the integration's key to be an admin key.
* **Night screen switches**: one for **All wall screens** and one per paired display. There's a blueprint that starts the Night screen when nobody's home and wakes the walls when someone arrives.

The integration registers a Kinwall webhook for itself, so changes show up in Home Assistant right away. It also polls `GET /api/rev` as a backstop (every 30 seconds by default).

Its options include **Points for chores created from Home Assistant** (default 5): a chore added from a Home Assistant to-do list or automation gets that many points.

This page covers the Kinwall side, for when you wire things up yourself.

## Running Kinwall inside Home Assistant

See [Home Assistant add-on](../getting-started/home-assistant-add-on.md): ingress, the options that map to environment variables, and where data lives.

## Talking to Kinwall from Home Assistant

The integration uses the same public interfaces anything else can use:

* **[REST API](rest-api.md)** with an API key. A **display** key is enough for reading the calendar and working with chores and lists. Use an **admin** key only if you need members or push messages (`POST /api/notify`, which needs **Family messages** on in [Settings → General → Features](../settings/general.md#features)).
* **`GET /api/rev`** for cheap polling. It changes on every write; its `revs` say whether lists, chores or events changed, so the integration refetches only that part.
* **[Webhooks](webhooks.md)** into a Home Assistant webhook trigger, for instant automations on `chore.completed`, `list.item.changed` and so on. Webhooks go to public addresses only, unless the server runs with `ALLOW_PRIVATE_WEBHOOK_URLS=1`. The add-on turns that on for you. If Kinwall runs elsewhere and Home Assistant is on your home network, set it yourself (see [Configuration](../self-hosting/configuration.md)).

Example ideas:

* Mark "Feed the cat" done when a smart feeder runs: `POST /api/chores/{id}/complete`.
* Flash a light when `chore.completed` fires for the last chore of the day.
* Add "Dishwasher tablets" to the groceries when a sensor runs low: `POST /api/lists/{id}/items`.
* Move a Nintendo Switch bedtime later for the day when a kid gets a "Nintendo Switch" [reward](../using/rewards.md), and put it back at midnight. There's a ready-made blueprint for this in the [Home Assistant integration repo](https://github.com/JohnDuprey/kinwall-homeassistant#blueprints), triggered by `reward.redeemed` and `reward.approved`.

## Meal kits

The **Meal kit deliveries** blueprint keeps each HelloFresh delivery on a Kinwall calendar as "📦 HelloFresh delivery" through `kinwall.sync_events`. Deliveries go on as [free](../using/events.md#free-or-busy) by default (its **Show deliveries as free** input), so an all-day delivery window shows on the calendar without sitting in Now / Next as "Now" all day. `kinwall.sync_events` takes `busy: false` on any event for the same. Needs integration 1.7.0 or later.

The integration repo has a **Weekly meal kit import** blueprint for HelloFresh, through the HelloFresh integration for Home Assistant. Once a week (Sunday 10:00 by default, or when you run it) it reads the next delivery, fetches each meal you picked with its ingredients scaled to your servings, and imports it with `kinwall.import_recipe`. The meals are planned as dinners from delivery day on, one a night, skipping nights that already have a dinner. Ingredients that come in the box stay off your grocery list; the pantry items you supply yourself go on it. Its **Add dinners to calendar** input takes a calendar ID (Settings → Calendars, tap the calendar) to put each planned meal on that calendar too; `kinwall.import_recipe` has the same as `plan_calendar_id`. See [Importing recipes](../using/meals.md#importing-recipes) and the blueprint's [README section](https://github.com/JohnDuprey/kinwall-homeassistant#blueprints).
