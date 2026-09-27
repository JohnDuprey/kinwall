-- A chore can be "N minutes of an activity" (a plugin): Kinwall's player times play and completes
-- the chore once the day's total reaches it (routes/plugins.ts, POST /api/plugins/{id}/playtime).
-- No foreign key: a removed plugin leaves the chore as a plain one.
ALTER TABLE chores ADD COLUMN plugin_id TEXT;
ALTER TABLE chores ADD COLUMN plugin_minutes INTEGER;
-- Seconds of active play per household-local day, person and plugin.
CREATE TABLE plugin_playtime (
  date TEXT NOT NULL,             -- YYYY-MM-DD in the household's timezone
  member_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, member_id, plugin_id)
);
