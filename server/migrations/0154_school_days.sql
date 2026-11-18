-- School days (school-days.ts, routes/school.ts): which days a kid has school, a half day or none.
-- Several school calendars per kid (the school's and the district's), replacing calendar_id (kept,
-- unused, so this stays additive); a grown-up's mark for one kid's day (a snow day, a make-up day),
-- which wins over what the calendars say; the half-day schedule (dismissal, and the bus drop-off or
-- pickup); the last day of school when the calendars don't say; and schoolwork that's still due on
-- days off (homework over a break). The family's day rules and reminder times are the settings row
-- 'school'. Additive only.
ALTER TABLE school_kids ADD COLUMN calendar_ids TEXT NOT NULL DEFAULT '[]';
UPDATE school_kids SET calendar_ids = json_array(calendar_id) WHERE calendar_id IS NOT NULL;
ALTER TABLE school_kids ADD COLUMN half_day_end TEXT;
ALTER TABLE school_kids ADD COLUMN half_from_school_time TEXT;
ALTER TABLE school_kids ADD COLUMN last_day TEXT;
ALTER TABLE chores ADD COLUMN school_days_off INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS school_day_marks (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('school', 'half', 'off')),
  PRIMARY KEY (member_id, date)
);
