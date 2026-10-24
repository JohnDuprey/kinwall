-- Existing selections are interpreted on read. No chores or family policies are rewritten.
ALTER TABLE routine_mode ADD COLUMN required_one_time_names TEXT NOT NULL DEFAULT '[]';
