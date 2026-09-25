# Categories & auto-categorising

Categories (🎂 Birthdays, 🏥 Appointments, ⚽ Sports…) give events an emoji and a colour. **A category's colour overrides the member colour**, and member avatars still show on the event.

## Managing categories

Go to **Settings → Family → Categories**. Both admin and display devices can do this.

* **Add category** offers presets with starter keywords, or **Custom**:

| Preset | Keywords |
|---|---|
| 🎂 Birthdays | birthday, bday, b-day |
| 🏥 Appointments | dentist, doctor, appt, appointment, orthodontist |
| ⚽ Sports | practice, game, soccer, baseball, basketball, swim |
| 🏫 School | school, pta, conference, field trip |
| ✈️ Travel | flight, trip, hotel, vacation |

* Each category has a **Name**, an **Emoji** (a single emoji), a **Color** and **Keywords** (comma-separated).
* Use **↑ / ↓** to reorder. The order is used in pickers and in the calendar filter.
* Deleting a category clears it from every event. Those events fall back to the next source below.

## How an event gets its category

Kinwall checks these in order and uses the first match:

| Source | Set by | Label in the sheet |
|---|---|---|
| This occurrence | the event's **Category** field, **This event** | "🎂 Birthdays" |
| The whole series | **Category** field, **All events** (recurring) | "🎂 Birthdays" |
| Keyword match | a keyword appears in the title | "Automatic" + hint |
| Calendar default | **Default category** on the calendar ([Calendars settings](../settings/calendars.md)) | "Automatic" + hint |
| None | | |

Keyword matching:

* is case-insensitive,
* matches **whole words or phrases** ("game" matches "Soccer game" but not "Gamestop"),
* runs when events are read, so new keywords apply to existing events right away and nothing is stored per event.

Picking **Automatic** in the edit sheet removes an explicit category, so the keyword or calendar default applies again.

## Synced events

Categories on Google, Outlook, CalDAV and ICS events live only in Kinwall. They're stored per occurrence or per series so they survive every re-sync. Both are included in [export](../your-data/export-import.md).

## Filtering

The calendar's category filter shows only the categories you pick. See [Calendar → Filters](calendar.md#by-category).

## API and MCP

* REST: `GET/POST /api/categories`, `PATCH/DELETE /api/categories/{id}`, `POST /api/categories/reorder`. Set an event's category with `PATCH /api/events/{id}` `{categoryId, scope}`.
* MCP: `list_categories`, `update_category`, `set_event_category` (accepts a category by name).
