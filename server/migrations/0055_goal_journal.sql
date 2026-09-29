-- Goal follow-up and the personal journal (routes/temp-check.ts, routes/journal.ts).
-- temp_checks.followup: the evening "did you finish your goal?" answer, a JSON { outcome, helped,
-- hindered, next }, sealed with the family's key (aad '<member>:<date>:followup'). NULL = not answered.
ALTER TABLE temp_checks ADD COLUMN followup TEXT;

-- A person's own journal entries. text and mood are sealed (aad '<id>:text' / '<id>:mood'); who and
-- which day stay plain so the journal lists and sorts in SQL.
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  mood TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_journal_entries_member_date ON journal_entries(member_id, date);
