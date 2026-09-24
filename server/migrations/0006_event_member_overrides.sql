-- Per-instance member assignment for synced (remote-kind) events, keyed by (calendar, external id)
-- rather than the event row's own id, since the row is deleted/reinserted wholesale on every
-- sync. Lets a member override survive re-sync, and lets read-only (ICS) calendars carry a
-- local-only "who" annotation without writing back to the feed.
-- ponytail: overrides for an external_id that no longer exists on the feed are left behind
-- (harmless - just an orphaned row); prune opportunistically in sync if it ever matters.
CREATE TABLE event_member_overrides (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  member_ids TEXT NOT NULL, -- JSON array
  updated_at TEXT NOT NULL,
  PRIMARY KEY (calendar_id, external_id)
);
