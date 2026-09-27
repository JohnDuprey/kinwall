-- Who's eating a meal (member ids, JSON array); assignee_member_id stays who's cooking.
ALTER TABLE meals ADD COLUMN eater_ids TEXT NOT NULL DEFAULT '[]';
