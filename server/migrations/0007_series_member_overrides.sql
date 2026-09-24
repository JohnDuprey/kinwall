-- Series-level member tags for recurring events on synced calendars. Occurrence-level tags
-- (event_member_overrides, 0006) still win when present; a series tag fills in for every
-- occurrence that has no occurrence-level override, including ones synced later.
ALTER TABLE events ADD COLUMN series_id TEXT;

CREATE TABLE event_series_member_overrides (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL,
  member_ids TEXT NOT NULL, -- JSON array
  updated_at TEXT NOT NULL,
  PRIMARY KEY (calendar_id, series_id)
);
