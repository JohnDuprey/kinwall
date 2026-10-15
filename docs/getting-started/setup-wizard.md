# First-run setup wizard

A new instance is *unclaimed*. The first browser to open it gets the setup wizard.

## Steps

1. **Welcome to Kinwall**: enter the 6-digit **Setup code**. The server prints it in its log; the step says to ask whoever set up your Kinwall server, or tap **Where do I find this?**, which shows where the log is:
   * Docker: `docker logs kinwall`
   * Home Assistant app (add-on): Settings → Apps → Kinwall → Log (Settings → Add-ons in older versions)
   * Cloudflare Workers: the Worker's logs

   At the bottom of that box, **Use your ADMIN_API_KEY instead** lets whoever runs the server paste that key (or the `ADMIN_API_KEY` secret on Cloudflare); **Use a 6-digit setup code instead** goes back.

   **Continue** claims the instance for your family on this device, the one you'll manage Kinwall from, so there's no going back to this step afterward. It also clears what this browser remembered from an earlier Kinwall at the same address (its Board layout, filters and anything waiting to sync), so a reinstalled server starts clean. A wrong code brings you back here with "That code didn't work". On the wall screen? Tap **Setting up the wall screen? Start on your phone** instead; see [below](#if-you-started-on-the-wall-display).
2. **Create a passkey for this device** (when passkeys are supported). You sign in with Face ID, Touch ID or your screen lock instead of saving a key. There's no **Skip**: the passkey is how you get back into your family. If the browser can't make one, after a failed try **Can't make a passkey here? Use recovery codes instead** moves on to the recovery codes (not on hosted Kinwall or any server with `REQUIRE_PASSKEY_SETUP=1`, where a passkey is required and, if the page reloads before it's made, the wizard reopens at this step). Inside Home Assistant's panel, some browsers (Safari especially) won't make a passkey: the step shows an **Open Kinwall in its own tab** link, and setup carries on from this step in the new tab.
3. **Save your recovery codes**: 8 one-time codes with **Copy all** and **Download .txt** buttons. They're your way back in if every passkey device is lost. **Next** waits until you tick **I've saved these somewhere safe**. **I'll do this later (not recommended)** moves on without them; Settings → Access keeps suggesting a second way in until there is one. Without a passkey (none possible, as on a plain `http://` address, or none made), they're the only way back in, so that link isn't there. See [Sign-in & security](../using/sign-in-and-security.md#recovery-codes).
4. **Your household**: family name, timezone (this device's, unless you pick another; search by city), and whether the week starts on Sunday or Monday. This step has no **Back**: the device is already claimed.
5. **Who's in the family?** Add each person with a name and **🧑 Grown-up** or **🧒 Kid**. Each gets a color and an avatar picked for them; **Change color and avatar** (showing the current one) opens the colors and avatars (an emoji or 1–2 letter initial) to pick your own. The first person starts as a grown-up and everyone after as a kid; tap the other choice before **Add** to change it, or change someone already added with the select next to their name. With a name typed, **Next** reads **Add and continue**: it adds that person, then moves on. Grown-ups' chores never wait for a parent's OK and their journals are private. Everyone added shows above the form, and **Back** and **Next** stay at the bottom while you scroll. You need at least one member.
6. **Whose device is this?** Pick yourself if it's your own phone or tablet, or **Shared (whole family)** for a wall screen or a family tablet. Only grown-ups are listed, since a parent's device can only belong to one; picking never changes who's a grown-up. If no one is marked a grown-up, go **Back** and mark yourself. Grown-ups' journals are [private](../using/journal.md#private-journals), and this phone then opens yours right away, private entries too. It's saved on this device's passkey (or key), so later sign-ins with it are yours too, and [Security activity](../using/sign-in-and-security.md#security-activity) says so ("My phone now belongs to Alex"). **Shared (whole family)** leaves it belonging to no one; you can change it later under [Settings → General → This device](../settings/this-display.md#this-device).
7. **What do you want Kinwall for?** Tap the cards for what your family will use. Each card turns on one or more [features](../settings/general.md#features):
   * 🧹 **Chores and rewards for the kids**: Chores & points (with rewards and the sticker book)
   * 🍽️ **Meal planning and recipes**: Meals (recipes, cooking mode, restaurant nights)
   * 🛒 **Shopping and to-do lists**: Lists
   * 🩺 **Doctor visits and health**: the Health tracker
   * 📚 **Reading log and library**: the Reading tracker
   * 🎨 **Painting and coloring**: Paint
   * 🎟️ **Outings and places to go**: Outings
   * 🗳️ **Family polls**: Family polls
   * 📸 **Photos and memories**: Photos and the Memories tracker
   * 📰 **Family news and messages**: Newscast, Family messages and Notes
   * 💭 **Check-ins and journals**: Check-ins & journal
   * 📇 **Family contacts**: Contacts

   Everything starts picked, except that with no kids in the family the chores and painting cards start off. A picked card has a filled ✓ circle and a light tint; one that's off has an empty circle. **Show all features** lists every switch on its own. **Keep all on** skips the step and leaves every feature on. You can change any of it later in **Settings → General → Features**. Medication reminders aren't in the wizard; turn them on there once the Health tracker is on.
8. **Connect a calendar** (optional): 📆 Google, 📧 Outlook, 🍎 iCloud (CalDAV) or 🔗 Subscribe to a link. If Google or Outlook isn't configured yet, its button says **Needs setup**, and tapping it shows the provider form inline, starting with "Google needs a one-time app setup, about 10 minutes. Easier: subscribe to a link or use iCloud." and the guide (see [Calendar providers](../settings/calendars.md#calendar-providers)). The iCloud form says what iCloud wants: `https://caldav.icloud.com`, your Apple Account email, and an [app-specific password](https://support.apple.com/102654). The form scrolls into view when it opens. **Skip** skips the step.
9. **Set up some chores**: tap starter chores and pick who does each one, or **Anyone**. This step is left out when chores are off.
10. **All set! 🎉** The steps to put Kinwall on the wall: open it on the wall screen, add it to the home screen, tap **Set up a wall screen or kid's device** there to get a code, then scan it or enter it here. **Pair a wall screen now** opens [Settings → Access → Paired devices](../settings/access.md#paired-devices) for that; **Go to calendar** finishes.

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
