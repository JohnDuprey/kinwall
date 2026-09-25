-- Event categories: a name+emoji+color+keywords bucket whose color overrides the assigned
-- member's color (SPEC.md "Categories"). Assignment mirrors the member-tag override system
-- (0006/0007) for synced events: per-occurrence and per-series override tables, keyed by
-- (calendar_id, external_id)/(calendar_id, series_id) so an override survives a wholesale
-- re-sync. Local events skip the override tables and store category_id directly on the row,
-- same as they already do for member_ids - the row is never wiped out from under them.
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  color TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]', -- JSON array of literal phrases; case-insensitive whole-word/phrase match, computed at read time
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

ALTER TABLE events ADD COLUMN category_id TEXT;
ALTER TABLE calendars ADD COLUMN category_id TEXT; -- default category for events with no override/keyword match

-- category_id is NOT NULL: like event_member_overrides, "clear this override" deletes the row
-- (falls back to the next source in the resolution order) rather than storing a null value.
CREATE TABLE event_category_overrides (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (calendar_id, external_id)
);

CREATE TABLE event_series_category_overrides (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (calendar_id, series_id)
);
