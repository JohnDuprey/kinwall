# Google Calendar

Google calendars sync **two-way**: events you create, edit or delete in Kinwall are written to Google first. If Google refuses a write, nothing is saved in Kinwall and you see the error.

Kinwall already uses **OAuth 2.0** for Google sign-in. If you self-host, you need to register your installation with Google once, then connect each person's Google account. You can do the setup in Kinwall's settings, with no restart. If the Google card says **Provided by your host**, skip to [Connect an account](#2-connect-an-account).

## 1. Create an OAuth client

### Choose the address you will use

On a grown-up's device with full access, open **Settings → Calendars → Calendar providers**.

1. Check **Public URL**. It is pre-filled from the page's address. Use the address where you will open Kinwall to connect Google, such as `https://kinwall.example.com`, without a page path like `/settings`.
2. Open the **Google** card and copy its **Redirect URI**. Google sends you back to this address after sign-in.

For example:

| Kinwall field | Example |
|---|---|
| Public URL | `https://kinwall.example.com` |
| Redirect URI (copy from the Google card) | `https://kinwall.example.com/api/oauth/google/callback` |

Use your own address, not the example. The redirect URI registered with Google must match the card **exactly**, including `https`, the hostname, any port, and `/api/oauth/google/callback`. Do not add a trailing slash.

**Google requires HTTPS or a localhost redirect URI.** A bare LAN IP like `http://192.168.1.10:8080` will not work. Use your Cloudflare Workers HTTPS address or a domain with HTTPS. For a local installation, you can finish sign-in from `http://localhost:8080` on the computer running Kinwall; `localhost` on your phone points to the phone instead.

### Create a Google Cloud project and enable Calendar

1. Open the [Google Cloud Console](https://console.cloud.google.com/) in another tab and sign in.
2. Use the project selector at the top to create a project, such as **Our Family**, or select an existing project you manage. Keep this same project selected throughout setup.
3. Go to **APIs & Services → Library**, search for **Google Calendar API**, open it, and choose **Enable**. If it is already enabled, continue.

You only need the Google Tasks API if you also want [Google Tasks](#google-tasks).

### Configure the consent screen

The consent screen is what each person sees when they give your installation permission to access their calendar. Google's current console groups these settings under **Google Auth Platform**; older instructions may call it **OAuth consent screen**.

1. Open **Google Auth Platform → Branding**. If prompted, choose **Get started**.
2. Enter an app name, such as **Our Family calendar**, and select your support email. Supply your contact email when asked and finish the setup prompts.
3. For ordinary personal Google accounts, choose **External** as the audience. **Internal** is for accounts within one Google Workspace organization; it will not let family members with personal Gmail accounts connect.
4. Under **Audience**, if the publishing status is **Testing**, add every Google account you plan to connect under **Test users**, including your own. Being the project owner does not replace this step.
5. Under **Data access → Add or remove scopes**, add these scopes and save:

   | Scope | What Kinwall uses it for |
   |---|---|
   | `openid` | Identify the signed-in account |
   | `https://www.googleapis.com/auth/userinfo.email` | Show which Google account is connected (`email` in the sign-in request) |
   | `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Let you choose which calendars to show |
   | `https://www.googleapis.com/auth/calendar.events` | Read, create, edit, and delete events |

Testing is enough to try the connection, but Google expires these grants after seven days. See [If every Google calendar stops about weekly](#if-every-google-calendar-stops-about-weekly) before relying on it for everyday use.

### Create the web application client

1. Open **Google Auth Platform → Clients → Create client**.
2. Choose **Web application** and give the client a name, such as **Kinwall server**. Use this type even if you will use Kinwall on an iPhone, Android phone, or wall tablet: Kinwall's server handles the Google connection.
3. Under **Authorized redirect URIs**, choose **Add URI** and paste the full **Redirect URI** copied from Kinwall. **Authorized JavaScript origins** is a different field; Kinwall's Google connection does not need an entry there.
4. Create the client. Copy its **Client ID** and **Client secret** while Google shows them. Kinwall needs both values from this same client, rather than an API key or service-account credential.
5. Return to Kinwall's Google card, paste the two values into **Client ID** and **Client secret**, then **Save**. Keep the secret private; do not include it in screenshots or bug reports.
6. Open Kinwall at its **Public URL** and use **Test sign-in** to check the connection. Stay in the same browser through sign-in and the return to Kinwall.

Alternatively, set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as environment variables. A client configured in the UI wins over the variables. When only the variables configure it, the card shows **Provided by your host** and is read-only; change the values in your hosting configuration instead.

Google's reference: [OAuth client settings](https://support.google.com/cloud/answer/15549257) and [audience and publishing status](https://support.google.com/cloud/answer/15549945).

### If every Google calendar stops about weekly

Google expires sign-ins after 7 days while an OAuth app's consent screen is in **Testing**. If every Google calendar stops syncing about once a week with "Google stopped letting Kinwall see…", open the consent screen (Google Auth Platform → **Audience**) and **Publish app** to move it to production. Self-hosters set up their own app, so this is on your Google Cloud project.

Publishing and verification are separate: publishing removes the Testing mode's seven-day expiry, but does not verify the app or remove Google's unverified-app warning. After publishing, use **Reconnect** on calendars whose sign-in has already expired.

### A kid's supervised account (Family Link)

A kid's Google account managed with Family Link can have Kinwall's access removed by a parent in Family Link, or need a parent's approval before Kinwall can see the calendar. When a kid's Google calendar stops syncing, check the kid's third-party app access in Family Link (or approve the request there), then tap **Reconnect** on the calendar in **Settings → Calendars**.

## 2. Connect an account

**Settings → Calendars → Connect Google** (grayed out until a client is configured). After you consent, you land back on **Calendars for *account***, where you tick the calendars to show (and who each is for), then tap **Add N calendars**. Tapping outside the sheet doesn't close it; use **Cancel**. Calendars you can't write to are marked **read-only**.

If you cancel the Google sign-in, or it fails, you land back on **Settings → Calendars** with a message saying what happened (for example "Google sign-in canceled — nothing was connected"). Nothing is connected, so you can just try again.

If Google says **Google hasn't verified this app**, check that it is the app you just configured for your installation. For your own app, choose **Advanced → Go to … (unsafe)** if Google offers it, then grant the requested calendar permissions. Publishing the app does not by itself remove this warning. If Google blocks access without a continue option, check the error below.

## If Google sign-in fails

An OAuth error does not by itself mean Kinwall needs a newer OAuth version. Read Google's exact error code or expand its error details first, then check the corresponding setting:

| What you see | What to check |
|---|---|
| `redirect_uri_mismatch` | In **Google Auth Platform → Clients**, open the client whose ID you saved in Kinwall. Its **Authorized redirect URIs** must contain the exact URI shown on Kinwall's Google card, including the callback path. Check **Public URL** too, especially after changing your domain or moving hosts. |
| `invalid_client`, or a message saying the OAuth client was not found | Check that Kinwall has the complete client ID and secret from the same **Web application** client, and that the client still exists in the selected project. An API key cannot replace these values. |
| `access_denied`, or access blocked because the app is still being tested | If you canceled consent, try again. Otherwise, check **Audience → Test users** for the exact Google account you selected. For a work or school account, the organization's administrator may also restrict access. |
| `org_internal` | The app is limited to its Google Workspace organization. For personal or outside accounts, change the audience to **External**. |
| `disallowed_useragent` | Open Kinwall at its **Public URL** in a regular browser such as Safari or Chrome and connect there. Google may refuse sign-in inside another app's embedded browser. |
| Google Calendar API is disabled or has not been used in the project | Enable **Google Calendar API** in the same project that owns your OAuth client, then retry. |
| Kinwall says the sign-in started in a different browser or at a different address | Start again at Kinwall's **Public URL** and finish in that browser. Do not switch between a LAN address, the Home Assistant sidebar, and your public hostname during sign-in. Allow cookies for Kinwall. |

Google's client-setting changes can take time to apply. After saving a correction, wait and start a fresh sign-in from Kinwall rather than reusing the old Google error page. See [Google's OAuth error reference](https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors) and [Kinwall's troubleshooting guide](../self-hosting/troubleshooting.md) for more detail.

If you still need help, include the exact error code, your Kinwall version, and whether you use Docker, Home Assistant, or Cloudflare Workers. Share a redacted screenshot if helpful; leave out the client secret, tokens, and sign-in URL query parameters.

## Scopes and tokens

Kinwall asks only for `calendar.events` (read and write events), `calendar.calendarlist.readonly` (the list of your calendars, so you can pick which to show), `openid` and `email`, not full calendar access. In your OAuth consent screen's **Data access**, declare exactly these: `calendar.events` is a sensitive scope, so until Google verifies your app, people connecting see "Google hasn't verified this app" and choose **Advanced → Go to … (unsafe)** to continue. Accounts connected before this change keep working with their earlier grant. The flow uses PKCE and a single-use state, and it has to finish in the browser that started it, at the same address (your **Public URL**): a sign-in link passed to another browser or device is refused. In the Kinwall phone app, Google's page opens in the app's own browser and ends with **Open in the Kinwall app**, which finishes the sign-in back in the app. The refresh token is encrypted at rest. Removing the account revokes the Google token (best effort) and deletes its calendars from Kinwall. Nothing is deleted in Google.

## Google Tasks

[Google Tasks](../using/todo-apps.md) uses this same OAuth client and redirect URI, so there's nothing new to register. In your Google Cloud project, also **enable the Google Tasks API**, and add the scope `https://www.googleapis.com/auth/tasks` under the consent screen's **Data access**. Kinwall asks for it on its own sign-in (with `openid` and `email`, and Google's incremental consent), never as part of Calendar's, so families who don't use Google Tasks are never asked. Like `calendar.events`, it's a sensitive scope: until Google verifies your app for it, people see "Google hasn't verified this app" when they connect Google Tasks.

## Reminders

Reminders you set in Kinwall are written to the Google event as popup reminders. **Google calendar default** writes "use the calendar's default" back. See [Events → Reminders](../using/events.md#reminders).

## Tip: read-only without OAuth

If you only need to *see* a Google calendar, use its **secret address in iCal format** as an [ICS feed](ics-feeds.md). No OAuth client is needed.

## Free or busy

An event's **Show as** in Google comes along: **Free** (`transparency: transparent`) shows as [free](../using/events.md#free-or-busy) in Kinwall, and **Busy** (or nothing set) as busy. Google marks new all-day events free on its own, so they come in free too. Changing **Show as** in Kinwall writes it back.
