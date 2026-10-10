-- Kids suggest chores (routes/chore-suggestions.ts): what they asked for (points, schedule, timer,
-- "I already did it"), waiting for a parent, then the answer (points given, a note) and the chore it
-- made. New table only, no backfill.
CREATE TABLE chore_suggestions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  emoji TEXT,
  points INTEGER NOT NULL,
  rrule TEXT,
  due_date TEXT NOT NULL,
  due_time TEXT,
  timer_minutes INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  suggested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  points_given INTEGER,
  note TEXT,
  chore_id TEXT REFERENCES chores(id) ON DELETE SET NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_chore_suggestions_status ON chore_suggestions(status, suggested_at);
CREATE INDEX idx_chore_suggestions_member ON chore_suggestions(member_id, seen);
