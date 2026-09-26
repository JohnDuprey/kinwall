# Microsoft / Outlook

Outlook.com and Microsoft 365 calendars sync **two-way** through Microsoft Graph.

## 1. Register an app

In **Settings → Calendars → Calendar providers → Microsoft**, the card shows the **Redirect URI** (`<public URL>/api/oauth/microsoft/callback`) and these steps:

1. In Microsoft Entra, go to App registrations → New registration.
2. Add the redirect URI under a **Web** platform.
3. Add the delegated permissions `Calendars.ReadWrite`, `User.Read` and `offline_access`.
4. Create a client secret and paste it in.

Fill in **Client ID**, **Client secret** and **Tenant** (default `common`, which accepts personal and work accounts), then **Save**.

Or use environment variables: `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and `MS_TENANT`. The same precedence as Google applies: the UI wins, and variables-only configuration shows "Provided by your host".

If the card already says **Provided by your host**, someone else set up the Microsoft app for you (hosted Kinwall will work this way). Skip to step 2.

## 2. Connect

**Settings → Calendars → Connect Outlook**, sign in, then tick the calendars you want in **Calendars for *account*** and tap **Add N calendars**.

If you cancel the Microsoft sign-in, or it fails, you land back on **Settings → Calendars** with a message saying what happened (for example "Microsoft sign-in canceled — nothing was connected"). Nothing is connected, so you can just try again.

## Reminders

Outlook events hold one reminder. Kinwall writes the reminder you choose to the event. Outlook has no "use default" setting to write back, so the **Reminder** menu doesn't offer one for Outlook events.

## Tip: read-only without OAuth

Outlook's **published calendar** ICS link works as an [ICS feed](ics-feeds.md).
