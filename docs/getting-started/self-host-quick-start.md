# Run Kinwall yourself: the easy guide

This guide is for parents who want Kinwall on the wall without learning a new trade. Pick the way that fits your home, follow the numbered steps, and you'll have your family calendar running. Words that might be new are explained as they come up, and there's a short [glossary](#words-used-in-this-guide) at the end.

If you like the technical details, the other pages in this section have them. This page links to them wherever it helps.

## Which way is right for you?

| Your situation | Best way | Time |
|---|---|---|
| **You want to try it first** | [The demo](#try-it-first-the-demo): nothing to set up | 1 minute |
| **You already have Home Assistant** | [The Home Assistant add-on](#way-1-home-assistant-add-on), usually the easiest | About 15 minutes |
| **You have a NAS or an always-on computer** (a Synology or QNAP NAS, Unraid, a Raspberry Pi, an old laptop) | [Docker](#way-2-docker-on-a-nas-or-always-on-computer) | 20 to 45 minutes |
| **You have no computer at home you can leave on** | [Cloudflare](#way-3-cloudflare-in-the-cloud) (a free account; Kinwall runs in the cloud) | About 30 minutes |

Kinwall is the same app whichever way you choose. You can move later: see [Moving to another server](../your-data/export-import.md#moving-to-another-server).

## Try it first: the demo

Open [demo.kinwall.family](https://demo.kinwall.family) on a phone, tablet or computer. It's a full Kinwall filled with a pretend family, "Our Family" with Alex, Sam, Maya and Leo. Tap around: add an event, tick off a chore, plan a meal.

Nothing you do there is saved or shared. When you're ready for your own, come back and pick a way below.

## Way 1: Home Assistant add-on

[Home Assistant](https://www.home-assistant.io) is a popular smart-home app. If you already use it, Kinwall can run inside it as an *add-on* (an extra app Home Assistant installs and looks after for you).

**You'll need:**

* Home Assistant with the **Add-ons** section under **Settings**. That's the usual Home Assistant OS install on a Home Assistant box, a Raspberry Pi or a mini PC. If you don't see **Add-ons**, your install can't run add-ons: use [Docker](#way-2-docker-on-a-nas-or-always-on-computer) instead.
* About 15 minutes.

**Steps:**

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Tap the **⋮** menu in the top corner, then **Repositories**.
3. Paste this address and tap **Add**:

   ```
   https://github.com/JohnDuprey/kinwall-homeassistant
   ```

4. Close the box. **Kinwall** now appears in the store (scroll down, or refresh the page if it doesn't). Open it and tap **Install**. This takes a few minutes.
5. Tap **Start**. Turn on **Show in sidebar** so it's easy to find.
6. Open the **Log** tab. Near the top you'll see a 6-digit **setup code**. Keep this tab open.
7. Open Kinwall from the sidebar. It's called **Family**. You'll see **Welcome to Kinwall**. Enter the setup code, then follow the [setup wizard](setup-wizard.md).

**If it looks different:** Home Assistant sometimes moves its menus. The install steps kept up to date by the add-on itself are in its [documentation](https://github.com/JohnDuprey/kinwall-homeassistant/blob/main/kinwall/DOCS.md). If the setup code isn't accepted, restart the add-on and use the newest code in the log: a new one is made on every start until you finish the wizard.

For the wall tablet, the add-on can also be reached straight on your home network, without a Home Assistant login. The add-on's own documentation covers that under "iPad kiosk setup". More detail is in [Home Assistant add-on](home-assistant-add-on.md).

## Way 2: Docker on a NAS or always-on computer

*Docker* is free software that runs apps in a tidy, sealed box called a *container*. Kinwall ships as a container, so you don't install anything else. Your NAS or computer becomes Kinwall's *server* (the machine that runs it and keeps your family's data).

**You'll need:**

* A device that's on all the time:
  * a **Synology** or **QNAP** NAS, or an **Unraid** server, that can run containers (Synology's app is called Container Manager; QNAP's is Container Station);
  * a **Raspberry Pi** 3, 4 or 5 running the **64-bit** Raspberry Pi OS (Kinwall doesn't run on the 32-bit version);
  * or an old laptop or desktop that stays plugged in and awake.
* Docker installed on it. NAS systems install it from their app store. For a Raspberry Pi or a computer, follow [Docker's install guide](https://docs.docker.com/engine/install/) (on a Mac or Windows laptop, that's [Docker Desktop](https://docs.docker.com/desktop/)).
* The device's address on your home network, like `192.168.1.50`. Your NAS shows it on its dashboard, and your Wi-Fi router's app lists every device.
* 20 minutes on a NAS that already runs containers, up to 45 minutes if you're installing Docker for the first time.

### The settings Kinwall needs

Whatever device you use, Kinwall needs the same four things:

| Setting | Value |
|---|---|
| Image (the app to download) | `ghcr.io/johnduprey/kinwall` |
| Port | `8080` (see below) |
| Folder for its data | Any folder you choose, mapped to `/data` inside the container |
| `PUBLIC_URL` | The address you'll type to open Kinwall, like `http://192.168.1.50:8080` |

A *port* is a numbered door on a device. Kinwall listens at door 8080, so its address ends in `:8080`. If something else on your NAS already uses 8080, pick another number for the first half, like `8090:8080`, and use `:8090` in your address.

### Option A: paste a Compose file

Most NAS container apps, and Docker on a computer, accept a *Compose file*: a short text file that lists those settings. Here's Kinwall's. Change `192.168.1.50` to your device's address, and `America/New_York` to [your timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) if you like.

```yaml
services:
  kinwall:
    image: ghcr.io/johnduprey/kinwall
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      PUBLIC_URL: http://192.168.1.50:8080
      TZ: America/New_York
```

**On a NAS:** create a new *project* (Synology) or *application* (QNAP) in your container app, give it a folder named `kinwall`, paste the file above, and start it. The screens differ between brands and versions, so if you get stuck, search your NAS maker's help for "Docker Compose": [Synology](https://kb.synology.com), [QNAP](https://www.qnap.com/en/how-to), [Unraid](https://docs.unraid.net).

**On a Raspberry Pi or computer:** open *Terminal* (the app where you type commands; on Windows, PowerShell). Paste these lines one at a time and press Return after each:

```bash
mkdir kinwall
cd kinwall
```

Save the Compose file above into that `kinwall` folder as `docker-compose.yml` (any plain text editor works), then paste:

```bash
docker compose up -d
```

The first start downloads Kinwall, which takes a minute or two. You'll see lines ending in **Started**.

### Option B: fill in a form

Some NAS apps (Unraid, and the Synology and QNAP "create container" screens) ask for the settings one at a time instead. Use the four settings from [the table above](#the-settings-kinwall-needs), and set it to restart automatically.

### Find the setup code and open Kinwall

1. Look at the container's *log* (the messages it prints). On a NAS, open the container in your container app and look for **Log**. On a computer, paste this in Terminal, inside the `kinwall` folder:

   ```bash
   docker compose logs kinwall
   ```

   You'll see a 6-digit **setup code**.
2. On your phone or computer, open your address, like `http://192.168.1.50:8080`. You'll see **Welcome to Kinwall**.
3. Enter the setup code and follow the [setup wizard](setup-wizard.md).

**If it looks different:**

* **The page won't open.** Check that the container is running, that you typed `http://` (not `https://`) and the right port, and that your phone is on the same Wi-Fi as the server.
* **The code isn't accepted.** Restarting makes a new code until the wizard is done. Use the newest one in the log.
* **The wizard skips the passkey step.** That's expected on an `http://` address, because phones only make passkeys for secure sites. Save the recovery codes the wizard gives you. You can add passkeys later once you have [HTTPS](#reach-it-away-from-home).

For every option, see [Quick start (Docker)](quick-start-docker.md) and [Docker Compose](../self-hosting/docker-compose.md).

## Way 3: Cloudflare, in the cloud

[Cloudflare](https://www.cloudflare.com) is a large internet company, and its free plan is enough for a family's Kinwall. Kinwall lives on Cloudflare's computers, so nothing at home has to stay on. It comes with *HTTPS* (the padlock in the address bar) and works away from home from day one.

You run a setup program once from a computer. After that, you can turn that computer off.

**You'll need:**

* A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
* A Mac or Linux computer for the setup. These steps use the Mac's **Terminal** app (in Applications → Utilities). On Windows, use the browser-based method in [Deploy to Cloudflare Workers](deploy-cloudflare.md#2-manual-git-connected-dashboard) instead.
* [Node.js](https://nodejs.org) version 24 or newer (the "LTS" download is fine if it says 24 or higher).
* A password manager, or somewhere safe to keep two long passwords.
* About 30 minutes.

**Steps:**

1. Install Node.js from [nodejs.org](https://nodejs.org). Open Terminal and paste this to check it worked:

   ```bash
   node --version
   ```

   You should see `v24` or higher.
2. Download Kinwall. Paste:

   ```bash
   git clone https://github.com/JohnDuprey/kinwall.git
   cd kinwall
   ```

   If your Mac offers to install "command line developer tools", say yes, wait for it to finish, then paste the lines again.
3. Make your *encryption key* (a long secret password that scrambles your calendar logins and health information). Paste:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   It prints a line of random letters and numbers. **Save it in your password manager now** as "Kinwall encryption key". Cloudflare won't show it to you again.
4. Start the setup. Paste:

   ```bash
   node scripts/setup-cloudflare.mjs
   ```

   It installs what it needs, then opens your web browser to sign in to Cloudflare. Sign in and allow access, then come back to Terminal.
5. Answer its questions. For most, press Return to accept the answer in brackets:
   * **Which account?** only appears if you have more than one.
   * **Location** is where your data is stored. It guesses from your timezone. Press Return.
   * **Custom domain** is for a web address you own (a *domain*, like `kinwall.example.com`). Press Return to skip it and use a free Cloudflare address.
   * **Paste an existing key, or press Enter to generate one:** paste the encryption key from step 3.
   * **Create an ADMIN_API_KEY?** Press Return for yes.

   Building and uploading takes a few minutes.
6. At the end it prints **Done. Kinwall is at** followed by your address, and your **ADMIN_API_KEY**, a long password starting with `kw_`. It's shown only this once: **save it in your password manager** as "Kinwall admin key", with the address.
7. Open the address. On **Welcome to Kinwall**, choose **Use your ADMIN_API_KEY instead**, paste the admin key, and follow the [setup wizard](setup-wizard.md).

**If it looks different:**

* **"Node 24+ is required"**: install a newer Node.js and open a new Terminal window.
* **"No healthy answer … yet"** at the end: wait a few minutes and open the address anyway. A custom domain can take a little while to start working.
* **You closed Terminal part way through**: that's fine. Open Terminal, paste `cd kinwall`, then run step 4 again. It picks up where it left off and keeps what's already set up.

More detail, and two other ways to deploy, are in [Deploy to Cloudflare Workers](deploy-cloudflare.md).

## Common next steps

Once the wizard says **All set! 🎉**, here's what most families do next:

* **Finish setting up.** The [setup wizard](setup-wizard.md) page explains each step if you skipped any.
* **Add or change family members.** Go to **Settings → Family**. See [Members](../settings/family.md#members).
* **Put it on the wall.** An iPad or an old tablet works well, even an older iPad in a Safari tab. See [Put it on the wall](put-it-on-the-wall.md).
* **Get it on everyone's phone.** Open your Kinwall address on the phone and add it to the Home Screen, so it opens like an app and can send reminders. See [Install it as an app](put-it-on-the-wall.md#2-install-it-as-an-app-pwa).
* **Connect your calendars.** See [Google](../calendars/google.md), [Microsoft / Outlook](../calendars/microsoft.md), [iCloud](../calendars/icloud-caldav.md) or [a calendar link](../calendars/ics-feeds.md).

### Reach it away from home

At home, everyone uses the same address. Away from home, it depends on how you set it up:

* **Home Assistant add-on:** use Home Assistant's own remote access, the same way you already reach Home Assistant from outside. Kinwall is in the sidebar.
* **Cloudflare:** nothing to do. Your address works everywhere.
* **Docker:** your server needs a safe way in from the internet. The easiest are [Tailscale](https://tailscale.com) (a private network for your own devices) or Cloudflare Tunnel (a secure link from Cloudflare to your server). Both also give you HTTPS, so passkeys and Google sign-in work. See [HTTPS](quick-start-docker.md#https) and [Exposing Kinwall to the internet](../using/sign-in-and-security.md#exposing-kinwall-to-the-internet).

**A warning about port forwarding:** don't open a port on your router to reach Kinwall. It puts your family's calendar directly on the internet, often with no padlock, where anyone can try to get in. Use one of the options above instead.

## Keeping it safe

### Backups

A *backup* is a copy of your family's data kept somewhere else, so a broken NAS or a mistake doesn't lose it.

* **Download an export now and then.** In Kinwall, go to **Settings → Access → Your data → Download export**. It saves one file with your family, chores, lists, meals and more. Keep it somewhere private, since it includes health notes in readable form. Photos are separate: **Activities → Photos → Download all (zip)**. See [Export & import](../your-data/export-import.md).
* **Back up the data folder, too.** It's the complete copy:
  * **Home Assistant:** the add-on's data is in your normal Home Assistant backups. Make sure those are turned on.
  * **Docker:** the `data` folder you chose (inside the `kinwall` folder if you used the Compose file). Include it in your NAS's backup plan.
  * **Cloudflare:** Cloudflare keeps a short history of your database that it can roll back to. The export above is your own copy.

More in [Backups](../your-data/backups.md).

### The encryption key

Your *encryption key* is what scrambles calendar logins and health information, so anyone who gets a copy of your data can't read them.

* **Docker and Home Assistant** make one for you: a file called `encryption.key` in the data folder. **Keep this file with your backups.** If you lose it, health info can't be recovered, and every calendar has to be connected again.
* **Cloudflare:** it's the key you saved in your password manager in step 3. Keep it there.

### Updating

Updates bring new features and fixes. Your data stays put, and wall screens show **Kinwall updated — tap to reload** afterward.

* **Home Assistant:** Home Assistant tells you when an update is ready. Update it like any other add-on.
* **Docker:** on a computer, open Terminal in the `kinwall` folder and paste `docker compose pull && docker compose up -d`. On a NAS, look for your container app's option to pull the latest image and restart the project.
* **Cloudflare:** open Terminal, paste `cd kinwall && git pull`, then run `node scripts/setup-cloudflare.mjs` again. It keeps your data and passwords.

More in [Updating](../self-hosting/updating.md).

## If something goes wrong

1. **The setup code isn't accepted.** A new code is made every time Kinwall restarts, until the wizard is done. Use the newest one in the log. After 10 wrong tries, wait an hour. See [Setup code not accepted](../self-hosting/troubleshooting.md#setup-code-not-accepted).
2. **The page won't open at home.** Check the server is on and the container or add-on is running. Check the address, including `http://` and the port. Make sure your phone is on your home Wi-Fi, not mobile data.
3. **The Google or Outlook button is gray.** Those need a one-time setup with Google or Microsoft first. Follow [Google](../calendars/google.md) or [Microsoft / Outlook](../calendars/microsoft.md). Until then, you can add a calendar by its link: see [ICS feeds](../calendars/ics-feeds.md).
4. **A screen still shows the old version after an update.** On that device, go to **Settings → General → Troubleshooting → Clear cache and reload**. See [Stale app after an update](../self-hosting/troubleshooting.md#stale-app-after-an-update).
5. **Reminders don't arrive on an iPhone.** iPhones only get them when Kinwall is added to the Home Screen and opened from there, on iOS 16.4 or later. See [Push notifications not arriving](../self-hosting/troubleshooting.md#push-notifications-not-arriving).

Locked out? Use a recovery code from the setup wizard: see [Lost every passkey](../self-hosting/troubleshooting.md#lost-every-passkey). Everything else is in [Troubleshooting](../self-hosting/troubleshooting.md).

## Words used in this guide

* **Server**: the device that runs Kinwall and stores your family's data. Phones and the wall screen connect to it.
* **Docker**: free software that runs apps in sealed boxes, so they don't need anything else installed.
* **Container**: one of those sealed boxes. Kinwall runs in one.
* **Port**: a numbered door on a device. Kinwall's is 8080, which is why its address ends in `:8080`.
* **Domain**: a web address, like `kinwall.example.com`.
* **HTTPS**: a secure connection, shown by the padlock in the address bar. Passkeys and Google sign-in need it.
* **Backup**: a copy of your data kept somewhere else, in case something breaks.
* **Encryption key**: a long secret that scrambles private information. Without it, that information can't be read, even by you.
