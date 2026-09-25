# First-run setup wizard

A new instance is *unclaimed*. The first browser to open it gets the setup wizard.

## Steps

1. **Welcome to Kinwall**: enter the 6-digit **Setup code** from the server log. You can also choose **Use your ADMIN_API_KEY instead** and paste that key. **Where do I find this?** shows where the log is:
   * Docker: `docker logs kinwall`
   * Home Assistant add-on: Settings → Add-ons → Kinwall → Log
   * Cloudflare Workers: the Worker's logs, or use your `ADMIN_API_KEY` secret
2. **What is this device?** This decides which key is stored on the device:
   * **This is my phone or computer**: you'll manage Kinwall from here.
   * **This is the wall display**: the iPad or screen on the wall.
3. **Create a passkey for this device** (phone/computer only, when passkeys are supported). You sign in with Face ID, Touch ID or your screen lock instead of saving a key. You can **Skip** this step, except on hosted Kinwall (or any server with `REQUIRE_PASSKEY_SETUP=1`), where the passkey is how you sign back in. There, if the page reloads before the passkey is made, the wizard reopens at this step.
4. **Save your recovery codes**: 8 one-time codes with **Copy all** and **Download .txt** buttons. They're your way back in if every passkey device is lost. See [Sign-in & security](../using/sign-in-and-security.md#recovery-codes).
5. **Your household**: family name, timezone, and whether the week starts on Sunday or Monday.
6. **Who's in the family?** Add each person with a name, colour and avatar (an emoji or 1–2 letter initial). You need at least one member.
7. **Connect a calendar** (optional): 📆 Google, 📧 Outlook, 🍎 iCloud (CalDAV) or 🔗 Subscribe to a link. If Google or Outlook isn't configured yet, the wizard shows the provider form inline. **Continue without calendars** skips the step.
8. **Set up some chores**: tap starter chores and pick who does each one, or **Anyone**.
9. **All set! 🎉**

## If you picked "This is the wall display"

The wall display shouldn't keep an admin key. The last step shows **Finish on your phone** with a QR code. Scan it with your phone to create your admin passkey there. Once the passkey exists, the display drops its temporary admin key ("Passkey created on your phone! 🎉").

If you can't use a phone, **Show admin key instead** reveals the admin key once, with a QR code and **Copy key**. Save it: it won't be shown again.

## If you picked "This is my phone or computer"

The last step lists how to put Kinwall on the wall. The full guide is [Put it on the wall](put-it-on-the-wall.md).

## Notes

* Claim attempts are rate-limited (10 per hour).
* The wizard remembers its step across the Google/Outlook sign-in redirect. It stores only the step and device role, never a key.
* A host can pass the setup code in the URL as `#key=…` to skip the code-entry step.
* A host that sets `REQUIRE_PASSKEY_SETUP=1` can read `hasPasskey` from `GET /api/setup` to know when it's safe to retire the setup link.
