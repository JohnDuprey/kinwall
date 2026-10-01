-- Chore library (routes/chore-library.ts): saved chores that aren't on a schedule - clean out the
-- car, wash the windows - for a parent to hand out in a couple of taps. Assigning one makes a
-- normal chore that remembers where it came from (chores.library_id), so "last done" is read from
-- those chores' completions rather than stored.
-- every_n + every_unit (day, week, month): a soft "about every" for nudges, never a schedule.
-- needs_approval: null follows the person's default, like chores.
CREATE TABLE chore_library (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  list_id TEXT, -- checklist, like chores.list_id (no FK: lists are archived, and assigning skips one that is)
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  every_n INTEGER,
  every_unit TEXT,
  needs_approval INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE chores ADD COLUMN library_id TEXT REFERENCES chore_library(id) ON DELETE SET NULL;
CREATE INDEX idx_chores_library ON chores(library_id);
