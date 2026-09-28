-- Temp check: a person's daily questions at the end of their day (routes/temp-check.ts).
-- members.temp_check: which questions they get (JSON { on, sleep, feelings, goal, showGoal }); NULL = off.
-- members.temp_check_feelings: their own feelings added with "Other" (a JSON array), sealed (enc:v1:).
ALTER TABLE members ADD COLUMN temp_check TEXT;
ALTER TABLE members ADD COLUMN temp_check_feelings TEXT;

-- One row per member per household day, changed in place. sleep and feelings (a JSON array) are health
-- data, sealed with the family's key (aad '<member>:<date>:sleep' / ':feelings'). goal is family content.
CREATE TABLE temp_checks (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sleep TEXT,
  feelings TEXT,
  goal TEXT,
  goal_skipped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, date)
);
