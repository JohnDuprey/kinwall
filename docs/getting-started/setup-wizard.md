# First-run setup wizard

A new instance is *unclaimed*. The first browser to open it gets the setup wizard.

## Steps

1. **Welcome to Kinwall**: enter the 6-digit **Setup code** from the server log. You can also choose **Use your ADMIN_API_KEY instead** and paste that key. **Where do I find this?** shows where the log is:
   * Docker: `docker logs kinwall`
   * Home Assistant app (add-on): Settings → Apps → Kinwall → Log (Settings → Add-ons in older versions)
   * Cloudflare Workers: the Worker's logs, or use your `ADMIN_API_KEY` secret

   A wrong code brings you back here with "That code didn't work".
2. **What is this device?** Start with the phone or computer you'll manage Kinwall from; the wall screen comes after.
   * **This is my phone or computer** (marked **Recommended first**): creates your passkey, and you'll manage Kinwall from here. Choosing it claims the instance for your family, so there's no going back to this step afterwards.
   * **This is the wall display**: shows **Start on your phone** instead of claiming. See [below](#if-you-started-on-the-wall-display).
3. **Create a passkey for this device** (phone/computer only, when passkeys are supported). You sign in with Face ID, Touch ID or your screen lock instead of saving a key. You can **Skip** this step, except on hosted Kinwall (or any server with `REQUIRE_PASSKEY_SETUP=1`), where the passkey is how you sign back in. There, if the page reloads before the passkey is made, the wizard reopens at this step. Inside Home Assistant's panel, some browsers (Safari especially) won't make a passkey: the step shows an **Open Kinwall in its own tab** link, and setup carries on from this step in the new tab.
4. **Save your recovery codes**: 8 one-time codes with **Copy all** and **Download .txt** buttons. They're your way back in if every passkey device is lost. See [Sign-in & security](../using/sign-in-and-security.md#recovery-codes).
5. **Your household**: family name, timezone (this device's, unless you pick another; search by city), and whether the week starts on Sunday or Monday. This step has no **Back**: the device is already claimed.
6. **Who's in the family?** Add each person with a name, **🧑 Grown-up** or **🧒 Kid**, a color and an avatar (an emoji or 1–2 letter initial). The first person starts as a grown-up and everyone after as a kid; tap the other choice before **Add** to change it, or change someone already added with the select next to their name. Grown-ups' chores never wait for a parent's OK and their journals are private. Everyone added shows above the form, and **Back** and **Next** stay at the bottom while you scroll. You need at least one member.
7. **Whose device is this?** (phone/computer only): pick yourself. Only grown-ups are listed, since a parent's device can only belong to one; picking never changes who's a grown-up. If no one is marked a grown-up, go **Back** and mark yourself. Grown-ups' journals are [private](../using/journal.md#private-journals), and this phone then opens yours right away, private entries too. It's saved on this device's passkey (or key), so later sign-ins with it are yours too, and [Security activity](../using/sign-in-and-security.md#security-activity) says so ("My phone now belongs to Alex"). **Skip** leaves the device shared; you can set it later under [Settings → Access → This device](../settings/access.md#this-device).
8. **Connect a calendar** (optional): 📆 Google, 📧 Outlook, 🍎 iCloud (CalDAV) or 🔗 Subscribe to a link. If Google or Outlook isn't configured yet, the wizard shows the provider form inline. **Continue without calendars** skips the step.
9. **Set up some chores**: tap starter chores and pick who does each one, or **Anyone**.
10. **All set! 🎉**

## If you started on the wall display

Your passkey belongs on your phone, not the wall, so the wall display doesn't claim the instance. It shows **Start on your phone** with a QR code instead:

1. Scan it with your phone's camera. Kinwall opens with the setup code already filled in. No camera? Type the address shown into your phone's browser and enter the code.
2. On your phone, pick **This is my phone or computer** and go through setup.
3. The wall display notices and switches to its pairing screen. On your phone, open **Settings → Access → Add a wall screen or kid's device** and enter the code it shows.

No phone at all? Pick **This is my phone or computer** on the wall device itself so you still get a passkey, then turn on **Use as a wall screen** for it in Settings.

## If you picked "This is my phone or computer"

The last step lists how to put Kinwall on the wall: open the address in the browser on the wall tablet or screen, add it to the home screen (on an iPad, Share → **Add to Home Screen**), then pair it. The full guide is [Put it on the wall](put-it-on-the-wall.md).

## Notes

* Claim attempts are rate-limited (10 per hour).
* Errors are in plain words ("You're offline", "This Kinwall is already set up"), never the server's own messages. Connecting a calendar still says why a link or login was refused.
* The wizard remembers its step across the Google/Outlook sign-in redirect, and across a reload once the device is claimed, so setup continues where it was instead of opening an empty app. It stores only the step, the device role and the wall display's key ID, never a key.
* A host can pass the setup code in the URL as `#key=…` to skip the code-entry step.
* A host that sets `REQUIRE_PASSKEY_SETUP=1` can read `hasPasskey` from `GET /api/setup` to know when it's safe to retire the setup link.
