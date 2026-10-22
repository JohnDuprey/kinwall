-- Internal completion ownership and Undo state. Existing history stays intact; an old entry
-- without a creating key can only be removed by a parent. No family records are backfilled.
ALTER TABLE upkeep_log ADD COLUMN created_key_id TEXT;
ALTER TABLE upkeep_log ADD COLUMN chore_date TEXT;
ALTER TABLE upkeep_log ADD COLUMN undo_state TEXT;

-- An upkeep Done that needs chore approval keeps the requested day until approval. Separate
-- from history: pending work does not advance the upkeep schedule or award points.
CREATE TABLE upkeep_pending (
  chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  input TEXT NOT NULL,
  PRIMARY KEY (chore_id, date)
);
