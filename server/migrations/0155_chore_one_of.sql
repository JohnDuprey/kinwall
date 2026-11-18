-- "Just one of them": an Anyone chore limited to some people (a JSON array of member ids). The first of
-- them to tick it finishes it for the day, and only they can be credited. NULL = anyone at all.
ALTER TABLE chores ADD COLUMN eligible_member_ids TEXT;
