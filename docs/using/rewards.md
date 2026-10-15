# Rewards

Rewards are things your family decides chore points can buy: pick the movie, an ice cream trip, 15 minutes of screen time. The short version: **earn points on Chores, spend them on Rewards.** A parent sets rewards up, and each person spends their own [points](chores.md#points-to-spend) on them, or on sticker packs for the [sticker book](activities.md#sticker-book).

Rewards go with **Chores & points**, and have their own **Rewards** switch in **Settings → Family → Chores** (`rewardsEnabled`, on by default). If an admin turns either off, Rewards is hidden (the menu item, the Board's reward goals and requests count, rewards in Newscast and reward-request notifications) and redeeming is refused (403). Nothing is deleted.

## Where to find them

* **Rewards** in the main menu. On a phone it's under **More**; on a wall screen or tablet it's in the side rail.
* On **Chores**: **🎁 Rewards** next to the date, or the "⭐ 42 to spend" balance under a person's name, which opens that person's rewards.
* On the **Board**: **🎁 Rewards** on the chores card, or a row for someone saving for a goal.
* From the sticker shop: "See Maya's rewards".
* Links: `#/rewards` and `#/rewards/<memberId>`. Old `#/activities/rewards` links still work.

Pick whose rewards from the avatar chips. A parent's device opens on the kid with a request waiting, else the first kid. A device that belongs to one person (its owner is set in **Settings → Access**) shows only theirs, even from a link to someone else's.

## What's on the screen

* **Maya has 42 points**, with a reminder of how it works: earn points by doing chores, spend them on rewards and sticker packs.
* **Points history** under it lists where the points came from and went: chores (all time), bonus points, check-ins, rewards (and points back), and sticker packs, newest first, with the totals earned and spent. On someone else's own device it shows the totals only.
* **Saving for** their goal, with a progress bar and how many more points it needs (see [Saving for a goal](#saving-for-a-goal)).
* **Waiting for a grown-up**: requests a parent hasn't said yes or no to yet.
* **Ask a grown-up to hand it over**: requests that are approved (or didn't need an OK), marked **Approved!**, until a grown-up taps **Given**. (On a parent's device both are in **Reward requests** instead.)
* **Ready now**: rewards they have enough points for. **Keep saving**: the rest, each with a progress bar and "8 more points". **All used up for now**: ones whose limit is used up.
* **Sticker packs** opens the sticker shop for that person, when the sticker shop is on.
* **Recent**: past requests, **Given** or **Not this time** with the parent's note.

With no rewards yet, a parent sees four one-tap suggestions (🍿 Pick the movie, 📺 15 min screen time, 🌙 Stay up 15 minutes, 🍦 Ice cream trip) and **Add your own**. Kids see "A grown-up can add some."

## Setting up rewards

On a parent's device, open Rewards and tap **Manage rewards** at the top (or a suggestion, when there are none yet). **Add reward** opens the same kind of sheet as the chore editor:

| Field | What it does |
|---|---|
| **Name** and **Emoji** | How the reward shows up, such as "🍿 Movie night pick". |
| **Points** | What it costs. A whole number, 1 or more. |
| **For** | **Everyone**, or just the people you pick. Others don't see it. |
| **Needs a parent's OK** | On by default. Redeeming on a wall screen or kid's device then waits for a parent (see below). Off: it's approved as soon as it's redeemed. |
| **Limit** | **No limit**, or **Up to** a number (1 to 20) **a day** or **a week**, for each person. "📺 15 min screen time, up to 3 a day." |

Tap a reward in **Manage rewards** to edit it. At the bottom, **Archive reward** hides it from everyone but keeps it for history; **Restore reward** brings it back. **Delete reward** removes it after you confirm; past requests stay in everyone's history.

Wall screens and kids' devices can't add, edit or remove rewards.

## Redeeming

Each reward card shows its cost and, for a limited one, how much is used ("1 of 3 today").

* **Get it** asks first: "Spend 50 points on 🍦 Ice cream trip? Leo will have 20 left." When they're saving for something else, it says how far that goal will be ("Saving for 🍿 Movie night pick will be 80 points away"), and when they've promised points to someone's split that's still waiting, that the spend leaves too few for it.
* The points come off right away. If the reward needs a parent's OK, they're set aside while it waits, and come back if a parent says not this time.
* Short of points, the card shows a progress bar and how many more points it needs instead.
* Once a limit is used up, the card says "That's all for today" (or "this week") until the next day or week starts. Days and weeks follow the family's timezone and first day of the week. Requests a parent said no to don't count.
* A redeem from a parent's device is approved straight away.
* A device that belongs to one person can only redeem for that person. A shared wall screen can redeem for anyone.

## Splitting a reward

A bigger reward can be shared: Sam and Leo can put their points together for a 300-point family movie night, Sam chipping in 200 and Leo 100. It's optional each time; **Get it** still spends one person's points as before.

* **Split it** shows on a reward card when someone else it's for has points and, together, there are enough.
* Pick **who's chipping in**. Nobody else is picked to start: whoever asks chooses who to ask. Each person's points start as an even split (whoever has fewer gives what they have, the rest cover the difference). **−** and **+** next to a person move points between them and the others, so the total keeps adding up (5 at a time for a reward of 50 points or more). The sheet says when it adds up ("✓ Adds up to 300 points"), and in red with ⚠️ how many more are needed or how many too many. Nobody can give more than they have.
* On a **parent's device**, **Get it** takes everyone's points at once and it's approved straight away.
* Anywhere else (a wall screen or a kid's device), **Ask a grown-up** takes only the asker's points now. The request always waits for a parent, even for a reward that doesn't need an OK, because the others haven't agreed yet. When a parent approves, everyone else's share comes off. If someone has spent their points meanwhile, approving says so ("Leo has only 40 points now, not 100") and nothing changes: say not this time, or wait until they've earned more.
* Everyone chipping in sees the request in their own **Waiting for a grown-up** and **Recent**, and under their balance what they've promised ("🤝 40 promised to Leo's 🍿 Movie night pick") until a grown-up decides, with who's paying what ("300 points: Sam 200 + Leo 100"). Only the person who asked can cancel it while it waits.
* **Not this time** (or **Cancel** on an approved one) gives every share back that was taken, and each person's own devices are told what came back to them.
* Each share is its own line in that person's points ledger. A reward's daily or weekly limit counts for the person who asked.

Requests show under **Waiting for a grown-up** (**Waiting for OK**), then under **Ask a grown-up to hand it over** (**Approved!**) once a grown-up says yes, then under **Recent** once given.

Changed your mind? On your own device, tap **Cancel request** on a request still **Waiting for OK**, then **Cancel request** again to confirm. The points come back at once, the request is gone (it doesn't count toward the reward's limit), and the grown-ups have nothing to decide. Once a parent has said yes, only a parent can call it off (**Not this time**). Wall screens and other people's devices can't cancel someone's request.

A decline is private to the person it's about. **Not this time** and the parent's note show on that person's own device (their Rewards page, and the notification there) and to parents, never on a shared wall screen: declined requests don't appear there at all.

## Approving

Parent devices get a notification and a feed entry: "Leo wants 🍦 Ice cream trip (50 points). Approve?" (for a split, "Sam wants 🍿 Family movie night (300 points), split with Leo. Approve?"). Tapping it opens Rewards. A split's row shows who's paying what ("Split: Sam 200 + Leo 100").

Requests wait in two places, and deciding in either one is enough:

* **Reward requests** at the top of the **Rewards** screen on a parent's device, for the whole family. The **Rewards** menu item shows how many are waiting.
* **To approve** at the top of the **Chores** screen, next to chores waiting for an OK. They count only in the Rewards badge, so each request is counted once.

* **Approve**: it's on. The points stay spent.
* **Not this time**: opens a sheet for an optional note ("Let's do it on Friday"). The points go back, and the person's own devices get a notification with the note.
* Approved rewards stay in the section until you tap **Given** once you've handed it over. **Cancel** gives the points back instead, for one that won't happen after all.

Rewards that don't need an OK also show here as approved, so you can mark them given.

## Saving for a goal

Tap **Save for this** on a reward to make it that person's goal. To stop, tap **Stop saving** under the goal at the top of Rewards (or tap **Saving for this** on the reward again). Kids can set their own goal on their own device.

The Rewards screen shows the goal at the top with a progress bar. When the **Board** shows the full chores card (on a big screen, at least 1600 × 900 pixels of board, or with **Board chores & to-dos** set to **Full lists** in [This display](../settings/this-display.md), or a [layout](calendar.md#board-layouts) with the Chores card), it shows the goal on that person's row, such as "🍿 Movie night pick 40 / 100", and **Ready!** once they have enough. Someone with a goal but no chores today gets a row of their own. Anywhere else (most walls, tablets and phones, where Today sums up the chores in one line), a **🎯** line right after the chores shows everyone's goal in short, such as "🎯 Maya 🍿 42/100 · Leo 🍦 18/50" ("Ready!" once they have enough). It opens Rewards. A kid's device shows only their own.

## Export, API and integrations

* Rewards, every request with its status and note, and each person's goal are part of [export & import](../your-data/export-import.md). The points they took are in the points ledger.
* REST: `GET /api/rewards` (`?memberId=` adds `used`, how much of each limit that person has used; `?archived=true` includes archived), `POST /api/rewards`, `PATCH/DELETE /api/rewards/{id}` (admin). A reward is `{ id, title, emoji, cost, memberIds, needsApproval, limit, active, sort, createdAt }`, where `limit` is `{ count, period: "day" | "week" }` or `null`.
* `POST /api/rewards/{id}/redeem {memberId, shares?}` answers `201 { redemption, balance }`, `402 { error, balance, cost }` when short, `409` when the limit is used up, and `403` when chores are off, the reward isn't for that person, or the device belongs to someone else. `shares` splits it: `[{ memberId, points }]`, 2 to 20 people with `memberId` among them, adding up to the cost (`400` otherwise); `402`'s `cost` is then that person's share. A redemption has `shares` (who paid what, the asker first) or `null` when one person paid it all.
* `GET /api/rewards/redemptions?memberId=&status=pending,approved&limit=` (`memberId` includes splits they chip in to; a member's own device gets only that member's requests, with any decline note; asking for someone else's is `403`. A shared wall sees everyone's except declined ones, which it never gets, note or not. Parents see everything); `POST /api/rewards/redemptions/{id}/cancel` (a pending one, from the member's own device or a parent's; refunds and removes it, `{ ok, balance }`); parents only: `POST /api/rewards/redemptions/{id}/approve` (for a split, takes the shares not taken yet; `402` when someone no longer has theirs), `/decline {note?}` (from waiting or approved, refunds) and `/given` (from approved).
* `PUT /api/members/{id}/reward-goal {rewardId}` (`null` clears it). `GET /api/members` includes `rewardGoal`.
* Webhooks: `reward.redeemed` (with `status`, and `shares` for a split), `reward.approved`, `reward.declined`, `reward.given` and `reward.changed`. See [Webhooks](../integrations/webhooks.md#events).
* MCP: `list_rewards`, `create_reward`, `update_reward`, `redeem_reward`, `list_reward_requests`, `approve_reward`, `decline_reward`, `mark_reward_given`. See [MCP server](../integrations/mcp.md).
