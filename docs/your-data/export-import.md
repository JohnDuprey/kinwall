# Export & import

**Settings → Access → Your data** (admin only).

## Download export

**Download export** saves `kinwall-export-YYYY-MM-DD.json` with everything your family entered:

| Included | Not included |
|---|---|
| Household settings (including Newscast's per-person **Featured** and **Can post** switches) | Passwords, OAuth tokens, CalDAV logins |
| Members, categories | API keys, sessions, recovery codes, the night PIN (set it again after a restore) |
| Chores **with completion history** and dates dismissed as not done (points awarded, and whether each is approved or waiting for a parent's OK), each chore's category, saved order, linked copies for several people and whether it's an ongoing responsibility, the [chore library](../using/chores.md#chore-library) and which chores came from it, and the parent-approval settings on chores and members, and who's a grown-up | Webhook secrets, and "Not yet" notes on chores |
| Points spent, daily check-ins, sticker packs unlocked and sticker book pages | |
| [Temp check](../using/snapshot.md#temp-check) settings and answers (evening goal checks and energy battery check-ins too), each person's own feelings, and [journal](../using/journal.md) entries. [Medications](../using/medications.md) and their taken/skipped log. Sleep, feelings, goal checks, journal entries and medications are encrypted on the server but **in plain form in this file** (a connected app's export leaves them out). A [private journal](../using/journal.md#private-journals) entry's words and a private day's goal check notes are never in the file, for anyone: its mood and day are. Whether journals are private isn't in the file either | |
| Rewards (archived ones too), every reward request with its status and note, and each person's goal | |
| Lists (with their type: Groceries, Shopping, To-do, Pantry or Reusable, and a pantry's automatic restocking), items (with a pantry item's use-by date and where it's kept), group order, remembered store/category/aisle per item and the catalog categories (per catalog), stores' aisle orders | Push subscriptions |
| Local calendars **with their events** (reminders, travel time) | Synced events themselves (they're fetched again) |
| Every calendar's name, color, members, default category, filter and hidden events | Per-device appearance (it lives in each browser) |
| Per-event member, category and travel-time tags on synced events, and series-wide member and category tags on synced recurring events | |
| Notes threads on local events and list items | Notes on synced events, and [Newscast](../using/newscast.md) announcements and reactions (they last 30 days, like the bell's feed lasts 90; everything else in Newscast comes from what is exported) |
| [Trackers](../using/trackers.md): books, memories and health visits. Health is encrypted on the server but **in plain form in this file** (it's your backup), so keep the file private | Photos and coloring pages (download them separately from Photos) |
| [Family polls](../using/polls.md) with their choices and votes | |
| [Trips](../using/trips.md) (even while Trips is off): stops, places to stay, getting there, the day plan and its links, packing-list links, calendar receipts, and stay votes (with the other polls). [Away days](../using/away.md), with or without a trip, with kept-due chores and handoffs. See [below](#trips-and-away-days) | Trip booking details, unless you ask for them. Place pictures: only their links are in the file |
| [Home upkeep](../using/upkeep.md): areas, things, jobs and every Done, costs and notes too | Its receipts and manuals: they're in the photo backup zip, under `upkeep/` |
| [School](../using/school.md): subjects, which kids are in school and their school settings, every entry of school time, report card grades, which photo is each report card, and days a grown-up marked (no school, early release) | The photos themselves: they're in the photo backup zip |
| [Meals](../using/meals.md): recipes (archived ones too, basics with their links), planned meals with their own ingredient copies, and which ingredients were already added to which shopping list | |
| ICS feed URLs | |
| Passkey and webhook *names/URLs*, for reference | [Security activity](../using/sign-in-and-security.md#security-activity) (it's about this server's sign-ins and devices, and an import shouldn't be able to write one) |

Photos are never in this JSON export. They back up as a separate zip: **Activities → Photos → Download all (zip)**, and come back with **Import zip** on the same page. The family's own Paint [coloring pages](../using/activities.md#adding-your-own-pages) and everyone's [profile pictures](../using/profiles.md#profile-pictures) travel in that zip too (a picture comes back to the person with the same name). See [Photos](../using/photos.md#backing-up-and-moving-photos).

API: `GET /api/export`.

The file contains ICS feed URLs, which can be secret. Treat it like a password.

## Import from a Kinwall export

**Import from a Kinwall export** asks for the file, shows what it contains ("Merges 4 members, 12 chores, … into this family. Existing items with the same ids are updated.") and waits for **Import**.

* **Merge by ID**: importing the same file twice changes nothing more (idempotent). Items already here with the same ID are updated. Nothing else is deleted.
* **Recipe tags** come with their recipe assignments, including tags you have created but haven't used yet. When merging, a tag with the same name (ignoring case and extra spaces) reuses the tag already here. If a recipe in the file has a tag list, that list replaces its assignments. Older exports without a tag list keep the recipe's current tags.
* **Settings** go through the normal settings validation. Keys this version doesn't know are ignored.
* **Local calendars** come back complete.
* **ICS calendars** come back connected if their URL is in the file and passes the [private-address check](../calendars/private-feeds.md).
* **Google, Outlook and CalDAV calendars** come back as placeholders that keep their settings and tags. [Reconnect](../calendars/reconnecting-after-import.md) each one once.
* **Members** from a file made before the **Grown-up** setting count as grown-ups when their birthday has a year making them 18 or older. If the file changes whether someone already here is a grown-up, that's logged in [Security activity](../using/sign-in-and-security.md#security-activity) and they get a 🔒 note; a connected app's import leaves it as it is. A file can't mark a grown-up as a kid when [Settings → Family](../settings/family.md#members) wouldn't let this device do it (they have a private journal or a full-access device of their own): they stay a grown-up, the rest of the file still comes in, and the API result lists them under `skipped.grownUp`.
* **Journal entries** for someone whose journal is [private](../using/journal.md#private-journals) right now are skipped, both new ones and changes to what's there, unless the import runs on that person's own device. Everyone else's come in as usual, and on a new server everything does.
* **Passkeys and webhooks** are skipped. Set them up again.
* **Health entries**, Temp check sleep, feelings, goal checks, battery check-ins and own-feelings lists, journal entries and medications are encrypted again as they're saved. A private journal entry already on the server is never overwritten, and a private day keeps its goal check notes. A private entry that isn't there comes back with its mood and day but no words (the file doesn't have them). Without an `ENCRYPTION_KEY` on the server, an import with health entries is refused and nothing is changed.
* Maximum file size: 10 MB.

API: `POST /api/import` with the export JSON as the body.

## Moving to another server

1. On the old instance, **Download export**.
2. Deploy the new instance and complete the [setup wizard](../getting-started/setup-wizard.md).
3. **Import from a Kinwall export**. For photos, also **Download all (zip)** on the old instance and **Import zip** on the new one.
4. Reconnect Google, Outlook and CalDAV accounts, then add a passkey and recovery codes.

If you're moving between Docker hosts, copying the whole `/data` directory also works and keeps *everything*. See [Backups](backups.md).

Reward milestones also export their definitions, participants, the earlier work excluded at enrollment,
paused progress, and earned/given dates (`rewardMilestones`). Importing restores missing definitions
and enrollments; existing ones are kept so older files cannot undo earned or given rewards.

The [inbox](../using/inbox.md) is backed up as `inboxItems`: each thought's words, whether it's open, sorted or cleared, where a sorted one went, and its times. Import restores them by id without deleting others. Older exports without it remain valid.

[Plan the week](../using/weekly-planning.md) is backed up as `weeklyPlans`: each week's shared draft and the meals and to-dos it added. Import replaces the plan for each week in the file and leaves other weeks alone. Older exports without it remain valid.

Scheduled family announcements are backed up with their titles, details, UTC visibility windows, emphasis, ids, and creation/update times. Import restores them by id without deleting other announcements; expired messages stay expired unless you change their schedule. Older exports without announcements remain valid.

## Trips and away days

The export has `trips` and `awayPeriods`. Trip **booking details** (private street addresses,
host contacts, arrival notes, door and Wi-Fi codes, confirmation numbers and booking links) and
all private **home and pet care** records are left out of an ordinary export.

To back them up too, call `GET /api/export?includeTripDetails=1` from a grown-up's own device with
full access (there's no button for it in the app yet). The file then has a `tripDetails` section with those
details **in plain form**, including home/pet care records (`kind: care`), so keep it private. A connected app (MCP) can't ask for it (403) and
can't import trips or booking details. On import, booking details are encrypted again with this
server's key as they're saved. Care records are also validated and re-encrypted with the receiving
server's key; no helper is contacted and no chores are created by restoring them. If any private
booking detail or home/pet care record can't be opened (the server's encryption key changed, say), this export answers
400 instead of leaving it out of the file.

Import merges by id like everything else. A file without `trips` or `awayPeriods` (an older
export) still imports and leaves the trips and away days already here alone.
