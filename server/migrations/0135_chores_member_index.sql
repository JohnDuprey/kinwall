-- A child's chores by member: routine mode polls this from the child's iPhone. No data changes.
CREATE INDEX IF NOT EXISTS idx_chores_member ON chores(member_id);
