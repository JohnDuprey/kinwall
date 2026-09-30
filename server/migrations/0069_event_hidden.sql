-- Hiding a single event, or every one in its series (docs/using/calendar.md "Hiding events").
-- Kinwall-only, so keyed like the other per-event overrides and never on the row a sync rewrites:
-- key is the event's external_id (synced) or id (local), '<id>@<start>' for one occurrence of a
-- local recurring event; for scope 'series' it's the series_id (synced) or the local event's id.
-- title/start/all_day are what the Hidden events list shows, even once the event is out of range.
CREATE TABLE event_hidden (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('occurrence', 'series')),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (calendar_id, scope, key)
);
