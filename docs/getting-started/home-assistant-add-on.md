# Home Assistant add-on

> New to this? Start with [the easy guide](self-host-quick-start.md).

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

* **Passkeys** work through ingress with no `public_url`: Kinwall uses the Home Assistant address your browser is on (your local https name, your own domain, or Home Assistant Cloud's remote address), even when a proxy in front of Home Assistant rewrites the `Host` header. It trusts the browser's address only on requests from the Supervisor's ingress proxy (172.30.32.2), never on the app's own port. Some limits:
  * Home Assistant has to be on https (or `localhost`) and opened by name: at `http://homeassistant.local:8123` or an IP address, browsers offer no passkeys.
  * A passkey belongs to the address it was made on. Use Home Assistant at home and remotely at different addresses? Add a passkey from each, or set `public_url` and use only that address.
  * The optional direct port (8080) is plain http, so it has no passkeys unless you put an https proxy in front of it. If that proxy changes the `Host` header, set `public_url` to its address.
  * The Home Assistant phone app's built-in browser may not offer passkeys; open Home Assistant in Safari or Chrome to add one.
  * Some browsers, Safari especially, won't add a passkey inside Home Assistant's panel (an error like "Invalid 'sameOriginWithAncestors' value"). Settings → Access shows an **Open Kinwall in its own tab** link there; add the passkey from that tab and it works in the panel afterward. The setup wizard's passkey step has the same link and carries on in the new tab.
* **Data** lives in the add-on's `/data`. It contains the SQLite database and `encryption.key`, so include it in your Home Assistant backups.
* **Setup code**: find it under **Settings → Apps → Kinwall → Log** (**Settings → Add-ons** in older Home Assistant versions).

Provider credentials set as add-on options appear as "Provided by your host" in **Settings → Calendars → Calendar providers** and are read-only there. See [Configuration](../self-hosting/configuration.md).

## Network setting for a tablet kiosk

The add-on's **Network** section controls optional direct access to Kinwall on your home network. It is disabled by default; opening Kinwall through Home Assistant's sidebar uses ingress and does not need it. An always-on tablet kiosk can use the direct address so it does not need to keep a Home Assistant session signed in.

1. In Home Assistant, go to **Settings → Apps → Kinwall → Configuration** (**Settings → Add-ons** in older versions) and find **Network**.
2. For `8080/tcp`, enter an unused host port, such as `8080`. Save and restart the add-on.
3. On the tablet, open `http://<home-assistant-ip>:8080` in its browser, replacing `<home-assistant-ip>` with your Home Assistant device's local IP address. If you chose another host port, use that number in the address instead.
4. Follow the add-on's [kiosk setup guide](https://github.com/JohnDuprey/kinwall-homeassistant/blob/main/kinwall/DOCS.md#ipad-kiosk-setup) to connect with a display key. For quick access, use your browser's option to add Kinwall to the home screen.

Direct access does not use Home Assistant's login protection. Enable it only on a trusted home network and use a display key for the kiosk. The direct address uses plain HTTP; passkeys need an HTTPS proxy, as described above.

For automations (entities, services), see [Home Assistant](../integrations/home-assistant.md).
