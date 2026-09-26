# Google Calendar

Google calendars sync **two-way**: events you create, edit or delete in Kinwall are written to Google first. If Google refuses a write, nothing is saved in Kinwall and you see the error.

## 1. Create an OAuth client

You can do this entirely in the UI, with no restart. On an admin device, open **Settings → Calendars → Calendar providers**:

1. Check **Public URL**. It's pre-filled from the page's own address and used to build the redirect URI.
2. Open the **Google** card. It shows the exact **Redirect URI** (`<public URL>/api/oauth/google/callback`) with a copy button, plus these steps:
   1. In Google Cloud Console, create an OAuth client of type "Web application".
   2. Add the redirect URI to its Authorized redirect URIs.
   3. Enable the Google Calendar API for the project.
   4. If the consent screen is in Testing, add yourself as a test user.
3. Paste the **Client ID** and **Client secret**, then **Save**. **Test sign-in** tries the flow.

Or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as environment variables. A client configured in the UI wins over the variables. When only the variables configure it, the card shows "Provided by your host" and is read-only.

**Google requires HTTPS or `localhost` redirect URIs.** A bare LAN IP like `http://192.168.1.10:8080` won't work. Use Workers, a domain with HTTPS, or finish sign-in from `http://localhost:8080` on the server itself.

## 2. Connect an account

**Settings → Calendars → Connect Google** (grayed out until a client is configured). After you consent, you land back on **Calendars for *account***, where you tick the calendars to show (and who each is for), then tap **Add N calendars**. Tapping outside the sheet doesn't close it; use **Cancel**. Calendars you can't write to are marked **read-only**.

If you cancel the Google sign-in, or it fails, you land back on **Settings → Calendars** with a message saying what happened (for example "Google sign-in canceled — nothing was connected"). Nothing is connected, so you can just try again.

## Scopes and tokens

Kinwall asks only for `calendar.events`, `calendar.readonly`, `openid` and `email`, not full calendar access. The flow uses PKCE and a single-use state. The refresh token is encrypted at rest. Removing the account revokes the Google token (best effort) and deletes its calendars from Kinwall. Nothing is deleted in Google.

## Reminders

Reminders you set in Kinwall are written to the Google event as popup reminders. **Google calendar default** writes "use the calendar's default" back. See [Events → Reminders](../using/events.md#reminders).

## Tip: read-only without OAuth

If you only need to *see* a Google calendar, use its **secret address in iCal format** as an [ICS feed](ics-feeds.md). No OAuth client is needed.
