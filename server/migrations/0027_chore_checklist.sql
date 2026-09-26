-- A chore can require a list (its checklist) to be fully ticked before it can be completed.
ALTER TABLE chores ADD COLUMN list_id TEXT;
