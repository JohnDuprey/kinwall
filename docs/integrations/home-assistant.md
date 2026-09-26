# Home Assistant

The Home Assistant integration and add-on live in their own repository: [JohnDuprey/kinwall-homeassistant](https://github.com/JohnDuprey/kinwall-homeassistant). Entities, services and install steps are documented there.

## What the integration gives you

Install it through HACS, then add it under **Settings → Devices & Services** with your Kinwall URL and an admin API key. You get a device for each family member plus a **Family** device:

* **Calendars**: one per member, plus a read-only family calendar.
* **To-do lists**: each member's chores for today (tick one off to complete it), the **Anyone** chores, and every Kinwall list, so voice assistants and the to-do card work with your lists.
* **Sensors**: points today, points this week and chores left today, per member.
* **A binary sensor per chore**: on once it's done today. It also reports the chore's checklist progress, so an automation can wait for "the after-school checklist is done".
* **Events**: every Kinwall webhook also fires as `kinwall_<type>` on the Home Assistant event bus (for example `kinwall_chore_completed`).

The integration registers a Kinwall webhook for itself, so changes show up in Home Assistant right away. It also polls `GET /api/rev` as a backstop (every 30 seconds by default).

Its options include **Points for chores created from Home Assistant** (default 5): a chore added from a Home Assistant to-do list or automation gets that many points.

This page covers the Kinwall side, for when you wire things up yourself.

## Running Kinwall inside Home Assistant

See [Home Assistant add-on](../getting-started/home-assistant-add-on.md): ingress, the options that map to environment variables, and where data lives.

## Talking to Kinwall from Home Assistant

The integration uses the same public interfaces anything else can use:

* **[REST API](rest-api.md)** with an API key. A **display** key is enough for reading the calendar and working with chores and lists. Use an **admin** key only if you need members or push messages (`POST /api/notify`).
* **`GET /api/rev`** for cheap polling. It changes on every write.
* **[Webhooks](webhooks.md)** into a Home Assistant webhook trigger, for instant automations on `chore.completed`, `list.item.changed` and so on. Webhooks go to public addresses only, unless the server runs with `ALLOW_PRIVATE_WEBHOOK_URLS=1`. The add-on turns that on for you. If Kinwall runs elsewhere and Home Assistant is on your home network, set it yourself (see [Configuration](../self-hosting/configuration.md)).

Example ideas:

* Mark "Feed the cat" done when a smart feeder runs: `POST /api/chores/{id}/complete`.
* Flash a light when `chore.completed` fires for the last chore of the day.
* Add "Dishwasher tablets" to the groceries when a sensor runs low: `POST /api/lists/{id}/items`.
