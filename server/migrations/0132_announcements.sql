-- Additive only: scheduled family messages. Existing data and settings are unchanged.
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_announcements_window ON announcements(starts_at, expires_at);
