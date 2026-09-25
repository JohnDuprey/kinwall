# Home Assistant

The Home Assistant integration and add-on live in their own repository: [JohnDuprey/kinwall-homeassistant](https://github.com/JohnDuprey/kinwall-homeassistant). Entities, services and install steps are documented there.

This page covers the Kinwall side, for when you wire things up yourself.

## Running Kinwall inside Home Assistant

See [Home Assistant add-on](../getting-started/home-assistant-add-on.md): ingress, the options that map to environment variables, and where data lives.

## Talking to Kinwall from Home Assistant

The integration uses the same public interfaces anything else can use:

* **[REST API](rest-api.md)** with an API key. A **display** key is enough for reading the calendar and working with chores and lists. Use an **admin** key only if you need members or push messages (`POST /api/notify`).
* **`GET /api/rev`** for cheap polling. It changes on every write.
* **[Webhooks](webhooks.md)** into a Home Assistant webhook trigger, for instant automations on `chore.completed`, `list.item.changed` and so on. Home Assistant has to be reachable at a public address, since webhooks never go to private IPs.

Example ideas:

* Mark "Feed the cat" done when a smart feeder runs: `POST /api/chores/{id}/complete`.
* Flash a light when `chore.completed` fires for the last chore of the day.
* Add "Dishwasher tablets" to the groceries when a sensor runs low: `POST /api/lists/{id}/items`.
