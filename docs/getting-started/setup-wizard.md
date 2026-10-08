# First-run setup wizard

A new instance is *unclaimed*. The first browser to open it gets the setup wizard.

## Steps

1. **Welcome to Kinwall**: enter the 6-digit **Setup code** from the server log. You can also choose **Use your ADMIN_API_KEY instead** and paste that key. **Where do I find this?** shows where the log is:
   * Docker: `docker logs kinwall`
   * Home Assistant app (add-on): Settings → Apps → Kinwall → Log (Settings → Add-ons in older versions)
   * Cloudflare Workers: the Worker's logs, or use your `ADMIN_API_KEY` secret

   **Continue** claims the instance for your family on this device, the one you'll manage Kinwall from, so there's no going back to this step afterward. It also clears what this browser remembered from an earlier Kinwall at the same address (its Board layout, filters and anything waiting to sync), so a reinstalled server starts clean. A wrong code brings you back here with "That code didn't work". On the wall screen? Tap **Setting up the wall screen? Start on your phone** instead; see [below](#if-you-started-on-the-wall-display).
2. **Create a passkey for this device** (when passkeys are supported). You sign in with Face ID, Touch ID or your screen lock instead of saving a key. There's no **Skip**: the passkey is how you get back into your family. If the browser can't make one, after a failed try **Can't make a passkey here? Use recovery codes instead** moves on to the recovery codes (not on hosted Kinwall or any server with `REQUIRE_PASSKEY_SETUP=1`, where a passkey is required and, if the page reloads before it's made, the wizard reopens at this step). Inside Home Assistant's panel, some browsers (Safari especially) won't make a passkey: the step shows an **Open Kinwall in its own tab** link, and setup carries on from this step in the new tab.
3. **Save your recovery codes**: 8 one-time codes with **Copy all** and **Download .txt** buttons. They're your way back in if every passkey device is lost. Without a passkey (none possible, as on a plain `http://` address, or none made), they're the only way back in, so this step has no **Skip for now**. See [Sign-in & security](../using/sign-in-and-security.md#recovery-codes).
4. **Your household**: family name, timezone (this device's, unless you pick another; search by city), and whether the week starts on Sunday or Monday. This step has no **Back**: the device is already claimed.
5. **Who's in the family?** Add each person with a name, **🧑 Grown-up** or **🧒 Kid**, a color and an avatar (an emoji or 1–2 letter initial). The first person starts as a grown-up and everyone after as a kid; tap the other choice before **Add** to change it, or change someone already added with the select next to their name. Grown-ups' chores never wait for a parent's OK and their journals are private. Everyone added shows above the form, and **Back** and **Next** stay at the bottom while you scroll. You need at least one member.
6. **Whose device is this?** Pick yourself if it's your own phone or tablet, or **Shared (the whole family)** for a wall screen or a family tablet. Only grown-ups are listed, since a parent's device can only belong to one; picking never changes who's a grown-up. If no one is marked a grown-up, go **Back** and mark yourself. Grown-ups' journals are [private](../using/journal.md#private-journals), and this phone then opens yours right away, private entries too. It's saved on this device's passkey (or key), so later sign-ins with it are yours too, and [Security activity](../using/sign-in-and-security.md#security-activity) says so ("My phone now belongs to Alex"). **Shared (the whole family)** leaves it belonging to no one; you can change it later under [Settings → Access → This device](../settings/access.md#this-device).
7. **Connect a calendar** (optional): 📆 Google, 📧 Outlook, 🍎 iCloud (CalDAV) or 🔗 Subscribe to a link. If Google or Outlook isn't configured yet, the wizard shows the provider form inline. **Continue without calendars** skips the step.
8. **Set up some chores**: tap starter chores and pick who does each one, or **Anyone**.
9. **All set! 🎉**

## If you started on the wall display

Your passkey belongs on your phone, not the wall, so **Setting up the wall screen? Start on your phone** on the first step doesn't claim the instance. It shows a QR code instead:

1. Scan it with your phone's camera. Kinwall opens there, with the setup code already filled in if you typed it on the wall screen first. No camera? Type the address shown into your phone's browser and enter the code.
2. On your phone, go through setup and create your passkey.
3. The wall display notices and switches to its pairing screen. On your phone, open **Settings → Access → Add a wall screen or kid's device** and enter the code it shows.

No phone at all? Go through setup on the wall device itself so you still get a passkey, then turn on **Use as a wall screen** for it in Settings.

## Putting it on the wall afterward

The last step lists how to put Kinwall on the wall: open the address in the browser on the wall tablet or screen, add it to the home screen (on an iPad, Share → **Add to Home Screen**), then pair it. The full guide is [Put it on the wall](put-it-on-the-wall.md).

## Notes

* Claim attempts are rate-limited (10 per hour).
* Errors are in plain words ("You're offline", "This Kinwall is already set up"), never the server's own messages. Connecting a calendar still says why a link or login was refused.
* The wizard remembers its step across the Google/Outlook sign-in redirect, and across a reload once the device is claimed, so setup continues where it was instead of opening an empty app. It stores only the step, the device role and the wall display's key ID, never a key.
* A host can pass the setup code in the URL as `#key=…` to skip the code-entry step. Opening such a link asks **Set up a new family?** first (the same goes for the wall screen's **Start on your phone** code); see [Sign-in and setup links](../using/sign-in-and-security.md#sign-in-and-setup-links).
* A host that sets `REQUIRE_PASSKEY_SETUP=1` can read `hasPasskey` from `GET /api/setup` to know when it's safe to retire the setup link.
