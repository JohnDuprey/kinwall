-- Points actually earned by a completion, fixed at completion time: a chore ticked off for a past
-- day earns the household's lateCompletionCredit percent. Leaderboard/member points sum this, so
-- history stays honest if a chore's points change later. Existing rows earned full points.
ALTER TABLE chore_completions ADD COLUMN points_awarded INTEGER;
UPDATE chore_completions SET points_awarded = COALESCE((SELECT points FROM chores WHERE chores.id = chore_completions.chore_id), 0);
