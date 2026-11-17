-- School for kids who go to a school (routes/school.ts): their school hours and days, how they get
-- there and home (the bus, or a grown-up: to_school_by / from_school_by is 'bus' or a member id, with
-- a time), the calendar the school publishes (days off, early release), the school (a contact: the
-- number to call, for the teacher too) and the teacher's name, email and another way to reach them (a
-- ClassDojo or Seesaw link; both for parents' devices only), other contacts (a tutor, a coach), how
-- many terms a year has, and report card grades. Grades are for parents only: never a wall or a kid's
-- device. year is the school year's first calendar year (2026 = 2026-27); term counts from 1; grade is
-- free text (A-, 3, 92%, Meets). Additive only.
ALTER TABLE school_kids ADD COLUMN school_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE school_kids ADD COLUMN teacher_name TEXT;
ALTER TABLE school_kids ADD COLUMN teacher_email TEXT;
ALTER TABLE school_kids ADD COLUMN teacher_link TEXT;
ALTER TABLE school_kids ADD COLUMN contact_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE school_kids ADD COLUMN calendar_id TEXT REFERENCES calendars(id) ON DELETE SET NULL;
ALTER TABLE school_kids ADD COLUMN day_start TEXT;
ALTER TABLE school_kids ADD COLUMN day_end TEXT;
ALTER TABLE school_kids ADD COLUMN to_school_by TEXT;
ALTER TABLE school_kids ADD COLUMN to_school_time TEXT;
ALTER TABLE school_kids ADD COLUMN from_school_by TEXT;
ALTER TABLE school_kids ADD COLUMN from_school_time TEXT;
ALTER TABLE school_kids ADD COLUMN school_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]';
ALTER TABLE school_kids ADD COLUMN terms INTEGER NOT NULL DEFAULT 3;
CREATE TABLE IF NOT EXISTS school_grades (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL, -- a removed member's grades stay under former_member
  former_member TEXT,
  year INTEGER NOT NULL,
  term INTEGER NOT NULL CHECK (term BETWEEN 1 AND 12),
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (member_id, year, term, subject_id)
);
