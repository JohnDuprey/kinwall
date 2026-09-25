# Home Assistant add-on

If you already run Home Assistant, the add-on is the easiest install. It lives in a separate repository, [JohnDuprey/kinwall-homeassistant](https://github.com/JohnDuprey/kinwall-homeassistant), together with the Home Assistant integration. Install steps are in that repository.

What this repository does for the add-on:

* **Ingress**: Kinwall opens inside Home Assistant with no open port. Home Assistant strips the ingress path before proxying, so Kinwall needs no path settings.
* **Options → environment**: add-on options in `/data/options.json` are mapped to the usual variables when the matching variable isn't already set:

| Add-on option | Variable |
|---|---|
| `google_client_id`, `google_client_secret` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `ms_client_id`, `ms_client_secret` | `MS_CLIENT_ID`, `MS_CLIENT_SECRET` |
| `public_url` | `PUBLIC_URL` |
| `admin_api_key` | `ADMIN_API_KEY` |
| `encryption_key` | `ENCRYPTION_KEY` |
| `vapid_subject` | `VAPID_SUBJECT` |
| `timezone` | Seeds the household timezone the first time. |

* **Data** lives in the add-on's `/data`. It contains the SQLite database and `encryption.key`, so include it in your Home Assistant backups.
* **Setup code**: find it under **Settings → Add-ons → Kinwall → Log**.

Provider credentials set as add-on options appear as "Provided by your host" in **Settings → Calendars → Calendar providers** and are read-only there. See [Configuration](../self-hosting/configuration.md).

For automations (entities, services), see [Home Assistant](../integrations/home-assistant.md).
