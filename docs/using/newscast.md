# Newscast

Newscast is a calm digest of what the family did and shared: chores done, rewards given, new photos and drawings, books finished, memories, birthdays, and short announcements anyone can post. It's the fourth tab on Home: **Board | Calendar | Schedule | Newscast**.

The [bell](notifications.md) is for things to act on (reminders, summaries, messages). Newscast is for things to notice and celebrate. Nothing in it needs an answer, it never sends a push, and it has no unread badge.

<p>
  <img src="../screenshots/phone-newscast.png" width="32%" alt="Newscast on a phone" />
</p>

## Opening it

* **Tablets, computers and wall screens**: tap **Newscast** in Home's view tabs.
* **Phones**: tap the view button under the header (like **Board ⌄**) and pick **Newscast: what the family did and shared**.
* A display can be locked to it: **Settings → General → This display → Lock view → Newscast**. See [This display](../settings/this-display.md).

Turning **Newscast** off in [Settings → General → Features](../settings/general.md#features) hides the tab everywhere (a screen locked to it shows the Board) and the Newscast API answers 404. Posts and reactions already saved are kept until they age out.

## What shows up

Each day is its own section: **Today**, **Yesterday**, then the weekday, then the date. A day shows about 8 items; **Show all for Tuesday** shows the rest. The tab loads the last 7 days, and **Earlier this month** loads the rest of the last 30.

| Item | Example | When |
|---|---|---|
| ✅ Chores done | "Leo finished 4 chores" with their names below | One per person per day, grown-ups too. Only chores that count: one waiting for a parent's OK shows once it's approved. |
| 🎁 Rewards | "Maya got a reward: 🍦 Ice cream trip" | When a parent marks it given. Not requests or declines. |
| 📸 Photos | "Alex added 3 photos" | Family photos, grouped per person per day. Photos added from a wall screen read "2 new photos". A memory's own photo isn't a family photo, so it isn't here. |
| 🎨 Drawings | "Maya saved a drawing: “Our garden at night”" | Paint drawings saved to family photos, credited to the artist. |
| 📚 Books | "Maya finished Charlotte's Web" ⭐⭐⭐⭐⭐ | When a book is marked finished, on the day it was finished. |
| 📝 Memories | "Sam added a memory" “First frost on the pumpkins” | The headline only, never what the memory says, with its photo if that's also a family photo. |
| 🎂 Birthdays | "Happy birthday, Leo!" "Leo turned 6" | On the day. |
| 📣 Announcements | Sam: "Pizza night is moving to Friday 🍕" | When someone posts one. See below. |

Times show beside each item. On someone's own device, things about them read "You finished 4 chores".

Tap a photo or drawing to see it full size; tap it again, tap **X** or press Escape to close it.

**No jumping.** Newscast checks for changes only while it's on screen. When something new arrives, a quiet **New: 2 · Show** line appears at the top; the feed changes when you tap it. Reactions and removals update in place.

**This week, together** (beside the feed on wide screens, below it on phones) shows family totals for the last 7 days: chores done, books finished, photos and drawings, rewards. Totals only; no one is ranked here.

Feature switches apply: with **Chores & points** off there are no chores or rewards, with **Photos** off no photos or drawings, with **Paint** off no drawings, and with **Reading** or **Memories** off no books or memories.

## What never shows up

Newscast doesn't read these at all, so they can't appear in it on any device:

* The Health tracker, medications and their reminders
* Journals (private or not), Temp check answers and goals, evening goal checks, the energy battery, check-ins and Insights
* Security activity and notifications
* Chores waiting for an OK, chores sent back with "Not yet", reward requests and declined rewards
* Points, balances and the leaderboard

## Announcements

Anyone can share a short announcement: up to 280 characters, an optional emoji and one photo. Links can't go in one yet.

* **On a tablet, computer or wall**, the **📣 Share something** card is beside the feed. **On a phone**, tap **Share something…** at the top.
* **A person's own device** (a kid's tablet, a parent's phone) posts as them. **A wall screen** asks **Post as…** each time.
* **Grown-ups** can pick **🔒 Grown-ups only**. Those posts show only on grown-ups' own devices and parents' devices, never on kids' devices or wall screens, and no webhook carries them.
* A photo is added when you tap **Share**, and it also goes in family photos, through the same size and storage limits. **Leave out the photo** before sharing keeps it out of the album.
* Announcements stay for 30 days, then they're deleted, with their reactions.

## Reactions

Every item has three reactions: 👏 ❤️ 🎉. Tap one to react; tap it again to take it back. Each person gives each reaction once per item. Reactions show the faces of who reacted, never a number. Reacting never notifies anyone.

* **A person's own device** reacts as them.
* **A wall screen** asks **Who's reacting?** every time: tap your face. Tapping a face that already reacted takes it back.

## Keeping it kind

Kids post freely, and parents have a few quiet tools, all from a parent's device:

* **Remove a post**: tap **⋯** on it, then **Remove post**. The person who posted it sees "A parent took this post down. Only you and parents see this note." in its place, on their own devices; parents see "Removed by a parent." Everyone else sees nothing. The post's photo stays in family photos; **Remove post and its photo** deletes the photo too.
* **Pause posting** for a kid: **⋯ → Pause posting for Leo** on one of their posts, or **Settings → Family → Leo → Can post in Newscast**. While it's off, Leo's share card says "Leo is taking a break from posting for now. A parent can turn it back on in Settings." He still sees Newscast and reacts. Turn it back on the same way (**Let Leo post again**).
* **Leave someone out**: **⋯ → Leave Maya out of Newscast** on any item about her, or **Settings → Family → Maya → Featured in Newscast**. None of her chores, rewards, photos, drawings, books, memories or birthday show; her own posts still do.

The person who posted can delete their own post from their own device (**⋯ → Delete my post**); it goes for everyone. A kid can't remove anyone else's post, and a wall screen can't remove posts. Removing a post or pausing posting isn't written to [Security activity](sign-in-and-security.md#security-activity): the note in the post's place is the record.

## Calm and accessible

* Low-stimulation mode (**Settings → General → This display**) drops the pictures (a "📸 A picture in family photos" line instead) and all motion.
* Every item reads as one sentence to a screen reader, reactions say who gave them ("Clap, from Alex, Sam"), and every button is at least 44 points.
* No streaks, no "you missed", no comparing people.

## Who sees what

| Device | Sees |
|---|---|
| A parent's device | Everything, including grown-ups-only posts and "Removed by a parent" notes. |
| A grown-up's own phone or computer | The same as a parent's device. |
| A kid's own device | Everything about the family (other people's chores, books and photos are family news), except grown-ups-only posts. "Removed by a parent" only for their own posts. |
| A wall screen | The same as a kid's device, without any "Removed by a parent" notes. |

## API

* `GET /api/newscast?days=7&before=YYYY-MM-DD` (display keys too): `{ today, from, to, earlier, items }`, newest first. `days` is 1 to 30 (default 7), ending the day before `before` (default: today); nothing older than 30 days. `earlier` says there are older days within 30. Each item is `{ key, kind, date, at, memberId, emoji, title, detail, count, photos, post, reactions }`: `kind` is `post`, `chores`, `reward`, `photos`, `drawings`, `book`, `memory` or `birthday`; `title` is one plain sentence; `count` is how many chores, photos or drawings it groups; `photos` is `[{ id, url }]`; `post` is `{ id, text, emoji, audience, removed }` for announcements; `reactions` is `[{ emoji, memberIds }]`.
* `POST /api/newscast/posts` `{ text, emoji?, photoId?, audience?, memberId? }`: `text` up to 280 characters with no links, `audience` `everyone` (default) or `grownups` (a grown-up only). A person's own device posts as them (another `memberId` is 403); a wall screen must send `memberId` (else 400). Paused posting is 403 with a kind message.
* `DELETE /api/newscast/posts/{id}[?alsoPhoto=true]`: from the author's own device, deletes it; from a parent's device (admin key), marks it removed. `alsoPhoto=true` (admin only) also deletes its photo from family photos.
* `PUT /api/newscast/reactions` `{ itemKey, emoji, on, memberId? }`: `emoji` is 👏, ❤️ or 🎉; `on: false` takes it back. A person's own device reacts as them; a wall screen sends `memberId`. Answers the item's reactions.
* `newscastNotFeatured` and `newscastPostingPaused` (member ids) on `GET`/`PATCH /api/settings` (admin keys).
* Webhook: `newscast.posted` for everyone posts. See [Webhooks](../integrations/webhooks.md).
* MCP: `list_newscast`. See [MCP](../integrations/mcp.md).

Posts and reactions aren't in the [export](../your-data/export-import.md): they last 30 days. The two per-person switches are settings, so they are.
