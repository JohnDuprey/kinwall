# Troubleshooting

> New to this? Start with [the easy guide](../getting-started/self-host-quick-start.md).

## Stale app after an update

Home Screen apps on iOS can keep an old version in memory.

1. On the affected device: **Settings → General → Troubleshooting → Clear cache and reload**. It clears caches, re-checks the service worker and reloads from the network. You stay signed in.
2. Still stuck? Close the app from the app switcher and reopen it.
3. Last resort: delete the Home Screen icon and add it again. This signs the device out, so a display then needs pairing again.

Kinwall's service worker deliberately caches nothing, and the server sends `no-cache` for everything except hashed assets, so this should be rare.

## Setup code not accepted

* The code changes on every restart (Docker) until the instance is claimed. Use the latest one from the log.
* After 10 wrong attempts in an hour from one address (30 from everywhere) you'll see "too many attempts — try again later", even for the right code. Restarting makes a new code and starts the count over.
* You can always use `ADMIN_API_KEY` instead, via **Use your ADMIN_API_KEY instead**. It works even after too many wrong codes.

## Google/Outlook buttons are grayed out

No OAuth client is configured yet. Set one up under **Settings → Calendars → Calendar providers**. See [Google](../calendars/google.md) and [Microsoft](../calendars/microsoft.md).

## Google says `redirect_uri_mismatch`

The redirect URI registered with Google must match the one on the provider card exactly. Check **Public URL**: scheme, host, port, no trailing path. Google also rejects bare LAN IPs, so use HTTPS or `localhost`.

## "Google connection failed" or "Microsoft connection failed"

When a sign-in goes wrong, Kinwall sends you back to **Settings → Calendars** with the reason in a message. "Sign-in canceled" means consent was declined, and nothing was connected. A reason starting with `server:` points to the server side: check the client secret and **Public URL** on the provider card, then try again.

"This sign-in was started in a different browser or at a different address" means Google or Microsoft sent you back to a browser, or an address, other than the one where you tapped **Connect**. Kinwall only finishes a sign-in in the browser that started it. Open Kinwall at its **Public URL** (not a LAN address, another hostname or the Home Assistant sidebar when the Public URL is something else), and connect again from there, in one browser. Browsers that block cookies for the site also cause this. In the Kinwall phone app, Google's or Microsoft's page opens in the app's own browser: when it says to finish in the Kinwall app, tap **Open in the Kinwall app**. If nothing happens, update the app, or connect from a web browser instead.

## "Something went wrong. Please try again."

Kinwall shows this for anything it didn't expect, on purpose: the details can be technical, and kids use the app. The real error is in the server log (Home Assistant: the add-on's **Log** tab; Docker: `docker logs`; Cloudflare: `wrangler tail`). The API's response carries a short `ref` (for example `a1b2c3d4`), and the log line starts with the same code in square brackets, so you can find the matching entry.

## Sync errors

The calendar's row in **Settings → Calendars** shows the last error.

| Error | Fix |
|---|---|
| "Calendar URL must be a public http(s) address…" | The feed or CalDAV server is on your LAN. See [Private / LAN feeds](../calendars/private-feeds.md). |
| "Reconnect this calendar to resume syncing" | It came from an import. See [Reconnecting after import](../calendars/reconnecting-after-import.md). |
| 401 / invalid grant from Google or Microsoft | The token was revoked or expired. Remove the account and **Connect** it again. |
| CalDAV authentication failed | For iCloud, use an app-specific password, not your Apple Account password. |
| Worker CPU limit exceeded | The ICS feed is very large. See [Cloudflare specifics](cloudflare.md). |

Old events stay visible after a failed sync. **Sync now** retries straight away.

## Push notifications not arriving

1. **iPhone/iPad**: iOS 16.4+, Kinwall added to the Home Screen and opened from there. Safari tabs can't receive push.
2. The device is listed under **Settings → Access → Notifications** (on an admin device). "never delivered" means the push service hasn't accepted a message for it yet.
3. **Send test** in **Settings → General → Notifications**. If the test arrives but reminders don't:
   * Is **Event reminders** on, and does **Which family members?** include the event's people?
   * Does the event have a reminder? Check the 🔔 line in its sheet, or the household **Default reminder**.
   * Summaries and nudges fire at the exact minute you set, in the household timezone. Check **Settings → General → Timezone**.
4. Check the OS notification settings for the browser or installed app, including Focus / Do Not Disturb.
5. If the device was removed from the list, its subscription expired. Turn notifications on again.
6. Docker: the notification loop runs every 2 minutes, but only while the container is running.

## A display shows an admin section, or doesn't

Settings shows the display view until the server confirms the device is an admin. If an admin phone only shows General and Family, it's signed in with a display key. Sign out and **Sign in with passkey**.

## Lost every passkey

Use **Use a recovery code** on the sign-in screen, or `ADMIN_API_KEY` via **Enter a key manually**. Then add a new passkey. See [Sign-in & security](../using/sign-in-and-security.md).
