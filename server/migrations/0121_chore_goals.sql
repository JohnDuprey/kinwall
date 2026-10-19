-- Flexible repeat goals. Existing chores keep their exact schedule; no backfill.
ALTER TABLE chores ADD COLUMN repeat_goal TEXT;
