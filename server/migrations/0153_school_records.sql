-- School records (routes/school.ts): yearly and daily goals per kid, an hour goal per subject, a photo
-- on logged time (the portfolio) and a photo of each report card. A kid's school year starts on their
-- year_start (MM-DD, August 15 unless set) and runs to the day before it comes round again; it's named by
-- its first calendar year (2026 = 2026-27), as grades are. A day counts toward a kid's
-- school days when they have approved time logged that day. photo_id has no foreign key, like a
-- memory's: the photo backup restores the photos after the export restores these rows. A photo
-- uploaded just for a log or report card (photos.family = 0) is deleted with the last row using it.
-- Additive only.
ALTER TABLE school_kids ADD COLUMN year_start TEXT NOT NULL DEFAULT '08-15';
ALTER TABLE school_kids ADD COLUMN year_goal_hours INTEGER;
ALTER TABLE school_kids ADD COLUMN year_goal_days INTEGER;
ALTER TABLE school_kids ADD COLUMN daily_goal_minutes INTEGER;
ALTER TABLE school_subjects ADD COLUMN goal_hours INTEGER;
ALTER TABLE school_logs ADD COLUMN photo_id TEXT;
CREATE TABLE IF NOT EXISTS school_report_cards (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL, -- a removed member's report cards stay under former_member
  former_member TEXT,
  year INTEGER NOT NULL,
  term INTEGER NOT NULL,
  photo_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (member_id, year, term)
);
