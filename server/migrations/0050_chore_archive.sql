-- Deleting a chore that has been done archives it instead (routes/chores.ts), so its completions,
-- the points earned from them and all-time counts on member profiles survive. An archived chore is
-- also inactive and is left out of GET /api/chores, edits and ticks; the data export carries it.
ALTER TABLE chores ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
