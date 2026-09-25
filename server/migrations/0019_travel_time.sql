-- Leave-by time: minutes of travel before an event's start. Kinwall-only, never written to a
-- provider. Local events keep it on their own row. Synced (remote-kind) rows are deleted and
-- reinserted wholesale on every sync, so a column there would be wiped - synced events store it in
-- event_travel_overrides instead, keyed by (calendar, external id) like event_member_overrides (0006).
-- (Reminders on synced events survive resync only because they live on the provider's event.)
ALTER TABLE events ADD COLUMN travel_minutes INTEGER;
ALTER TABLE events ADD COLUMN remind_before_leave INTEGER NOT NULL DEFAULT 0;

-- ponytail: occurrence-level only (no series table like 0007) - a recurring synced event takes its
-- travel time per occurrence; add event_series_travel_overrides if tagging a whole series matters.
CREATE TABLE event_travel_overrides (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  travel_minutes INTEGER,
  remind_before_leave INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (calendar_id, external_id)
);
