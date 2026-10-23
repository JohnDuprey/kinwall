-- Opt-in only; no existing family or chore data changes.
CREATE TABLE IF NOT EXISTS routine_mode (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  app_mode TEXT NOT NULL DEFAULT 'selected',
  enabled INTEGER NOT NULL DEFAULT 0,
  cutoff TEXT NOT NULL DEFAULT '19:30',
  allowed_websites_only INTEGER NOT NULL DEFAULT 0,
  allowed_web_domains TEXT NOT NULL DEFAULT '[]',
  start TEXT NOT NULL DEFAULT '00:00',
  day_schedules TEXT,
  required_chore_ids TEXT,
  school_link_domains TEXT
);
