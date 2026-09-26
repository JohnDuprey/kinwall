# MCP server

Kinwall has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server. An AI assistant can answer "what's on Saturday?", add an event, tick off a chore, add milk to the groceries or check the leaderboard.

* **Endpoint**: `https://<your-kinwall>/mcp`, using the **Streamable HTTP** transport (`POST`/`GET`/`DELETE`). It's stateless, with no sessions.
* **Same rules as REST**: every tool calls the REST routes internally with your credentials, so scopes, validation, webhooks and `rev` bumps behave exactly as they do for the [REST API](rest-api.md). A REST error becomes a tool result with `isError: true` and the route's error text.
* **Names instead of IDs**: members, lists and categories can be referred to by name (`"member": "Maya"`, `"list": "Groceries"`). Matching is case-insensitive. An ambiguous name returns an error that lists the matches.
* **Household time**: "today" means today in the household timezone. `get_household` returns that timezone.

## Two ways to authenticate

### OAuth 2.1 (sign-in)

The sign-in flow: no key to copy, and each app gets its own revocable grant. Kinwall is its own authorization server:

1. Add `https://<your-kinwall>/mcp` as a custom connector in your client.
2. The client discovers Kinwall's OAuth metadata (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) and registers itself automatically.
3. Your browser opens Kinwall's consent screen: "*App* wants to use Kinwall". Sign in as an admin with a passkey, or with an admin API key, then choose:
   * **Full access**: "Everything you can do as an admin, including members and settings."
   * **Everyday access**: "Calendar, chores and lists. No members, settings or keys." This is the display scope.
   * **Deny**.
4. Connected apps are listed and revocable under **Settings → Access → Connected apps**.

Details: authorization code with **PKCE S256 only**, public clients, and redirect URIs that must be https or loopback. Codes last 5 minutes and work once. Access tokens last 1 hour. Refresh tokens last 90 days and rotate on every use; reusing an old one revokes the whole grant. `POST /oauth/revoke` is supported.

### Bearer key

Any API key in an `Authorization` header. Use a **display** key for an everyday assistant. It can add and complete events, chores and lists, but not manage members, accounts, keys or webhooks. Use an **admin** key only if the assistant needs `add_member`, `update_member` or `send_notification`.

## Connecting clients

**Claude (web, desktop, mobile)**: **Settings → Connectors → Add custom connector**, URL `https://<your-kinwall>/mcp`. This uses OAuth.

**Claude Code**:

```bash
claude mcp add --transport http kinwall https://<your-kinwall>/mcp --header "Authorization: Bearer <key>"
```

**Clients that take a JSON config** (Claude Desktop's `claude_desktop_config.json` and similar):

```json
{
  "mcpServers": {
    "kinwall": {
      "url": "https://<your-kinwall>/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

**ChatGPT, Gemini and others**: any client that supports remote MCP servers over Streamable HTTP works. Give it the URL `https://<your-kinwall>/mcp`, and either let it sign in with OAuth or configure an `Authorization: Bearer <key>` header, depending on what the client supports. Where each client keeps that setting changes often, so check its own documentation.

Kinwall shows its own icon in clients that display server icons.

## Tools

Every tool carries MCP annotations (read-only / destructive / idempotent / open-world). Clients such as Claude can use them to group permissions as read, write and delete.

### Read

| Tool | Does |
|---|---|
| `get_household` | Settings (family name, timezone, week start, color scheme), members and a calendar summary. |
| `list_color_schemes` | The household's color scheme and every scheme it can use: Seasonal, the built-in schemes by the name people see (Peach is the default, Meadow the green one), and the family's own schemes with their light and dark palettes. |
| `list_events` | Events across all calendars in a range (default: today plus 7 days). Can filter by member or calendar. |
| `get_event` | One event by ID (the series row for a recurring local event). |
| `get_event_items` | List items linked to an event, across all lists, open first, with list names. |
| `list_chores` | Chores due on a date (default today), with completion state. |
| `get_leaderboard` | Points, completions and streaks per member for today, week (default) or month. |
| `get_points` | One member's points (by name or ID): balance left to spend, all-time earned and spent, and recent purchases. Read-only. Stickers are bought on the wall, not over MCP. |
| `get_snapshot` | One member's day (`range`: `day`, default) or next 7 days (`week`), by name or ID: greeting, weather (if a location is set), their and everyone's events, their chores, their due or high/urgent list items, family birthdays, and (day) tomorrow at a glance. The same data as tapping their avatar. |
| `get_board` | The whole household's bulletin board for today and the next `days` days (default 7, max 14): everyone's events plus untagged ones, open list items due soon, overdue or high/urgent, today's chores per member, and birthdays. The same data as the calendar's Board view. |
| `list_lists` | All lists with item and open counts. |
| `get_list` | One list by ID or name, with items (in the list's sort order, each with its steps), group order and store/category suggestions. |
| `list_categories` | Categories (name, emoji, color, keywords) in order. |
| `list_notes` | The notes thread on an event or list item (`target`: `event:<id>` or `list_item:<id>`), oldest first. `memberId` null means "Someone". |
| `list_notifications` | Recent notifications Kinwall sent (reminders, summaries, chore nudges, list updates, messages), newest first. The same feed as the bell in the app. Takes `limit` and `before`. |

### Write

| Tool | Does |
|---|---|
| `create_event` | Creates an event. Writes to Google, Outlook or CalDAV for those calendars. Accepts `travelMinutes` and `remindBeforeLeave`. |
| `update_event` | Changes only the fields you give it (the whole series for recurring local events). |
| `set_event_category` | Sets or clears an event's category (by name). Clearing falls back to keyword or calendar default. |
| `create_chore` | Creates a recurring or one-off chore. `list` links a checklist (a list by name or ID) that has to be ticked off before the chore completes. |
| `update_chore` | Changes title, emoji, assignee, points, recurrence (`RRULE`, optional `UNTIL`), due date or time, checklist (`list`, or `null` to unlink), or active state. |
| `complete_chore` | Marks a chore done for a date (default today). Refused while the chore's checklist has open items. |
| `uncomplete_chore` | Undoes a completion. |
| `add_member` | Adds a family member (admin), optionally with a `birthday` (`YYYY-MM-DD`, or `--MM-DD` without a year). |
| `update_member` | Changes a member's name, color, avatar or `birthday` (admin; `null` clears it). |
| `create_list` | Creates a shopping, to-do or reusable list. |
| `update_list` | Renames, changes kind, emoji, owners or item sort (`sortBy`: `manual`, `added`, `due`, `priority`, `alpha`), or archives a list. |
| `add_list_items` | Adds items: plain titles or objects (notes, quantity, store, category, member, dueDate, eventId, priority, steps). `steps` is a list of step titles in order. |
| `update_list_item` | Edits an item's title, notes, quantity, store, category, assignee, due date, linked event or priority (`low` / `normal` / `high` / `urgent`). |
| `set_list_item_done` | Ticks or unticks an item, and all its steps with it. |
| `set_step_done` | Ticks or unticks one step of an item (step IDs come from `get_list`). Ticking the last open step completes the item; unticking a step of a done item re-opens it. |
| `add_note` | Adds a note to an event's or list item's thread, posted as a member (by name or ID) or "Someone". |
| `update_note` | Replaces a note's text (note IDs come from `list_notes`). |
| `update_category` | Changes a category's name, emoji, color or keywords. |
| `send_notification` | Pushes a message now to devices following given members, or all devices (admin). It also appears in the in-app notification feed. |

| `set_color_scheme` | Sets the household's color scheme by name ("Peach", "Meadow", "Seasonal", or one of the family's own). Devices that follow the family setting switch to it; a device that picked its own scheme in the app keeps it. |
| `save_color_scheme` | Creates one of the family's own schemes, or overwrites one (`replace`). Takes four colors per mode (`light` and `dark`: `bg`, `card`, `text`, `accent`). Refused, with the ratios that fell short, unless text and dim text reach 4.5:1 on the background and cards in both modes. Up to 10 per family. `use: true` also makes it the household's scheme. |

### Delete

| Tool | Does |
|---|---|
| `delete_color_scheme` | Deletes one of the family's own schemes. If the household was using it, the household goes back to Peach. |
| `delete_event` | Deletes an event (the whole series for recurring local events). This also deletes it at the provider. |

## Native apps

The same OAuth server signs in native apps, such as Kinwall for iPhone. Besides `https` and loopback `http` redirect addresses, registration accepts an app's own reverse-domain link scheme (RFC 8252), like `family.kinwall.app:/oauth`. Single-word schemes such as `javascript:` or `data:` are always refused. The consent screen then says you'll return to "the app".

On the consent screen, an admin can sign in with a passkey, a recovery code, or an admin API key. Someone who signs in without a passkey is offered **Create a passkey** before approving, so next time is quicker. On a server that hasn't been set up yet, the consent link runs the setup wizard first, then continues to the approval.

## Output schemas

Every tool declares an **output schema** that matches the REST response shapes (`EventInstance`, `ChoreDay`, `ListDetail`, `LeaderboardEntry`…). A successful call returns:

* a short human summary ("Added 2 items to Groceries."),
* the same data as a JSON text block, for clients that ignore structured output,
* `structuredContent`, validated against the schema.

For example, `list_events` returns `{events: EventInstance[]}` and `complete_chore` returns `{ok: boolean}`. Array arguments sent as JSON text (`"[15]"`) are accepted too.
