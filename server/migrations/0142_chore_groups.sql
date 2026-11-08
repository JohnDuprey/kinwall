-- A chore for several people is one linked chore each (same group_id), so each ticks it off on
-- their own. Editing or deleting one changes the whole group.
ALTER TABLE chores ADD COLUMN group_id TEXT;
CREATE INDEX idx_chores_group ON chores(group_id) WHERE group_id IS NOT NULL;
