-- Ongoing responsibilities keep their definition; each tick has its own ordinary completion row.
ALTER TABLE chores ADD COLUMN category TEXT;
ALTER TABLE chores ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chores ADD COLUMN source_id TEXT;
CREATE INDEX idx_chores_source ON chores(source_id) WHERE source_id IS NOT NULL;
