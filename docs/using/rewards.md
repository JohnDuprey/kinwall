# Rewards

Rewards are things your family decides chore points can buy: a movie night pick, an ice cream trip, 15 minutes of screen time. A parent sets them up, and each person spends their own [points](chores.md#points-to-spend) on them.

Rewards go with **Chores & points**. If an admin turns that off in **Settings → General** (under **Features**), rewards are hidden too and redeeming is refused. Nothing is deleted.

## Where to find them

* **Activities → Rewards**. Pick whose rewards from the avatar chips. A device that belongs to one person (its owner is set in **Settings → Access**) shows only theirs.
* The **Rewards** tab in the [sticker book](activities.md#sticker-book), next to **Shop**.

## Setting up rewards

On a parent's device, open Rewards and tap **Manage rewards**. **Add reward** opens the same kind of sheet as the chore editor:

| Field | What it does |
|---|---|
| **Name** and **Emoji** | How the reward shows up, such as "🍿 Movie night pick". |
| **Points** | What it costs. A whole number, 1 or more. |
| **For** | **Everyone**, or just the people you pick. Others don't see it. |
| **Needs a parent's OK** | On by default. Redeeming on a wall screen or kid's device then waits for a parent (see below). Off: it's approved as soon as it's redeemed. |
| **Limit** | **No limit**, or **Up to** a number (1 to 20) **a day** or **a week**, for each person. "📺 15 min screen time, up to 3 a day." |

Tap a reward in **Manage rewards** to edit it. **Archive** hides it from everyone but keeps it for history; **Restore** brings it back. **Delete** removes it; past requests stay in everyone's history.

Wall screens and kids' devices can't add, edit or remove rewards.

## Redeeming

Each reward card shows its cost and, for a limited one, how much is used ("1 of 3 today").

* **Redeem** asks first: "Spend 50 points on 🍦 Ice cream trip? Leo will have 20 left."
* The points come off right away. If the reward needs a parent's OK, they're set aside while it waits, and come back if a parent says not this time.
* Short of points, the card says how many more to go instead.
* Once a limit is used up, the card says "That's all for today" (or "this week") until the next day or week starts. Days and weeks follow the family's timezone and first day of the week. Requests a parent said no to don't count.
* A redeem from a parent's device is approved straight away.
* A device that belongs to one person can only redeem for that person. A shared wall screen can redeem for anyone.

Below the cards, **Recent** lists that person's last requests: **Waiting for OK**, **Approved**, **Given**, or **Not this time** with the parent's note.

## Approving

Parent devices get a notification and a feed entry: "Leo wants 🍦 Ice cream trip (50 points). Approve?"

Requests wait in the **To approve** section at the top of the **Chores** screen, next to chores waiting for an OK. They count toward the **To approve** badge on the Chores tab.

* **Approve**: it's on. The points stay spent.
* **Not this time**: opens a sheet for an optional note ("Let's do it on Friday"). The points go back, and the person's own devices get a notification with the note.
* Approved rewards stay in the section until you tap **Given** once you've handed it over. **Cancel** gives the points back instead, for one that won't happen after all.

Rewards that don't need an OK also show here as approved, so you can mark them given.

## Saving for a goal

Tap **Save for this** on a reward to make it that person's goal (tap again to clear it). Kids can set their own goal on their own device.

The **Board**'s chores card shows the goal on that person's row, such as "🍿 Movie night pick 40 / 100", and **Ready!** once they have enough. Someone with a goal but no chores today gets a row of their own.

## Export, API and integrations

* Rewards, every request with its status and note, and each person's goal are part of [export & import](../your-data/export-import.md). The points they took are in the points ledger.
* REST: `GET /api/rewards` (`?memberId=` adds `used`, how much of each limit that person has used; `?archived=true` includes archived), `POST /api/rewards`, `PATCH/DELETE /api/rewards/{id}` (admin). A reward is `{ id, title, emoji, cost, memberIds, needsApproval, limit, active, sort, createdAt }`, where `limit` is `{ count, period: "day" | "week" }` or `null`.
* `POST /api/rewards/{id}/redeem {memberId}` answers `201 { redemption, balance }`, `402 { error, balance, cost }` when short, `409` when the limit is used up, and `403` when chores are off, the reward isn't for that person, or the device belongs to someone else.
* `GET /api/rewards/redemptions?memberId=&status=pending,approved&limit=`; parents only: `POST /api/rewards/redemptions/{id}/approve`, `/decline {note?}` (from waiting or approved, refunds) and `/given` (from approved).
* `PUT /api/members/{id}/reward-goal {rewardId}` (`null` clears it). `GET /api/members` includes `rewardGoal`.
* Webhooks: `reward.redeemed` (with `status`), `reward.approved`, `reward.declined`, `reward.given` and `reward.changed`. See [Webhooks](../integrations/webhooks.md#events).
* MCP: `list_rewards`, `create_reward`, `update_reward`, `redeem_reward`, `list_reward_requests`, `approve_reward`, `decline_reward`, `mark_reward_given`. See [MCP server](../integrations/mcp.md).
