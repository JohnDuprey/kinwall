# Family polls

Ask the whole family something and let everyone vote: "Where are we eating Friday?", "Which movie tonight?", "Park or pool this weekend?". Everyone gets one vote, kids included, and can change it until a parent closes the poll. Votes aren't secret: each choice shows who picked it, with their avatars.

## Where polls are

Polls don't have a tab of their own:

* **The Board**: while a poll is open, it's in the **Today** card, right under today's events: the question, each choice with who voted, and who's in the lead (⭐) when there's room, or one row ("🗳 Where are we eating Friday? · 3 of 4 voted") when today is busy and on phones. Tap it to vote. With several polls open it's one row, "2 polls open", that opens the list. On a [layout](calendar.md#board-layouts) without Today it's in Coming up, right under its events, or a slim strip above the cards. It goes away when the poll closes.
* **Home → Board → 🗳 Polls**: every poll, open ones first, and **New poll** on a parent's device. On a phone it's the 🗳 button next to the layout picker.
* **Meals**: a poll about a meal shows **🗳 Vote open** in that day's slot of the week planner. Tap it to vote.
* **The bell**: a new poll sends everyone a notification ("🗳 New poll: Which movie tonight?") and a push to devices with notifications on. Tapping it opens the poll.

## Starting a poll

Parents start polls: **Home → Board → 🗳 Polls → New poll**.

1. Type the question.
2. With [Meals](meals.md) on, pick a date and **Meal** (breakfast, lunch, dinner…) if the poll decides one (optional).
3. Add the choices, at least two and up to twelve:
   * **Add an idea**: anything typed, like "Pizza night" or "Moana".
   * **Add a recipe**: a recipe from the recipe book (with Meals on).
   * **Add a restaurant**: a place from the [restaurant binder](meals.md#restaurants) (with Meals on).
4. Tap **Start poll**. Everyone gets the notification.

## Voting

Open the poll from the Board, the Polls list, the Meals planner or the notification, then tap a choice. Tap your choice again to take your vote back, or tap another one to change it.

* **A kid's own device** votes only for that kid ("Voting as Leo").
* **A wall screen** asks "Who's voting?" first: tap your name, then your choice. After each vote it's ready for the next person.
* **A parent's device** starts on its owner and can vote for anyone (for a kid who's not near a screen, say).

## Ending voting and planning it

On a parent's device, open the poll and tap **End voting…**. The choice with the most votes is picked; on a tie, pick the winner from the list. Tap **End voting** to finish, or **Keep voting** to leave it open. Nobody can vote after that, and the poll leaves the Board. To pick a different winner afterwards, end voting again through the API or an AI assistant (`close_poll`).

With Meals on, a poll whose voting has ended has **Plan it**. It opens the meal the poll was about with the winner filled in: the meal already planned in that slot if there is one, else a new meal on that day (today's dinner for a poll without a date). A recipe choice plans that recipe, a restaurant plans dining out there, and an idea becomes the meal's name. Save it and the poll links to that meal (**Open the meal** next time).

To delete a poll and its votes: open it, then **More… → Delete poll**.

## Turning polls off

**Settings → General → Features → Family polls**. Off, polls are gone everywhere: nothing on the Board, no Polls button, nothing in the Meals planner, no notifications (and earlier poll notifications leave the bell), and the API and AI tools answer that polls are off. Polls already made are kept and come back when it's turned on. With Meals off, polls still work with typed ideas only (recipes and restaurants need Meals), and there's no **Plan it**.

## API

* REST: `GET /api/polls[?status=open|closed]`, `GET /api/polls/{id}`, `POST /api/polls`, `PUT /api/polls/{id}/vote`, `POST /api/polls/{id}/close`, `PATCH /api/polls/{id}`, `DELETE /api/polls/{id}`. See [REST API](../integrations/rest-api.md).
* AI assistants: `list_polls`, `create_poll`, `vote_poll`, `close_poll`. See [MCP](../integrations/mcp.md).
* Webhook: `poll.changed`. See [Webhooks](../integrations/webhooks.md).
