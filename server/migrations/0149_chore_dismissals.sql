-- A missed occurrence can leave the late list without becoming a completion.
-- Additive only: no backfill, no changes to schedules, history or points.
CREATE TABLE chore_dismissals (
  chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (chore_id, date)
);
