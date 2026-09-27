-- Parent approval for chores (routes/chores.ts). A completion from a wall screen or kid's device
-- on a chore that needs a parent's OK lands as 'pending' (no points, not done) until a parent
-- approves it; every existing row, and anything a parent's device ticks, is 'approved'.
ALTER TABLE chore_completions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
-- Per chore: NULL follows the person's default, 1/0 overrides it either way.
ALTER TABLE chores ADD COLUMN needs_approval INTEGER;
-- Activity chores completed by timed play auto-approve unless this is on.
ALTER TABLE chores ADD COLUMN approve_timed_play INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN needs_approval INTEGER NOT NULL DEFAULT 0;
-- A parent's "Not yet": the completion is removed and the note shows on the chore until it's
-- ticked again for that day.
CREATE TABLE chore_rejections (
  chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  note TEXT,
  rejected_at TEXT NOT NULL,
  PRIMARY KEY (chore_id, date)
);
