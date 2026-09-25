# Settings → Family

## Members

Everyone who shows up on the wall. Each member has:

* **Name**
* **Color**: from the palette or a custom colour. It colours their events, chore column and avatar.
* **Avatar**: an emoji from the row, any emoji, or a 1–2 letter initial.
* **Birthday** (optional): a date. Turn on **I don't know the year** to keep just the month and day. It shows 🎂 in everyone's [snapshot](../using/snapshot.md) that day, with the age they turn when the year is known. API: `birthday` as `YYYY-MM-DD`, or `--MM-DD` without a year, or `null`.

**Add member** and editing are admin only. On a display, the list is read-only. Deleting a member ("Their chores and tags are unassigned") removes them from calendars, chores and event tags. It doesn't delete those items.

`GET /api/members` also returns each member's `pointsToday` and `pointsWeek`.

## Categories

Add, edit, reorder (↑ / ↓) and delete event categories. Both admin and display devices can do this. See [Categories & auto-categorising](../using/categories.md).

## Chores

Also on this tab, admin only:

| Setting | Options | Default |
|---|---|---|
| **Late completion credit** | 0%, 25%, 50%, 75%, 100% | 50% |
| **Streak grace** | 0–3 missed days per rolling week | 1 |
| **Leaderboard** | on/off — hides the chore leaderboard and rank badges | On |
| **Sticker shop** | on/off — hides the sticker book in Activities and refuses purchases when off | On |
| **Sticker prices** | Free, 50%, 100%, 150% — scales every pack's price | 100% |

See [Chores](../using/chores.md) for how these play out day to day.
