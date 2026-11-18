-- Schoolwork (routes/school.ts, routes/chores.ts): a lesson, homework, a test or a project is a chore
-- with a school subject, so it repeats, belongs to one kid or several, shows on the wall and earns
-- points (0 by default) like any chore. Ticking it off (once approved, if it needs approval) logs
-- school_minutes of school time under its subject; undoing the tick takes that log back. A log made
-- that way keeps chore_id and chore_date. Additive only.
ALTER TABLE chores ADD COLUMN school_subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL;
ALTER TABLE chores ADD COLUMN school_kind TEXT CHECK (school_kind IN ('lesson', 'homework', 'test', 'project'));
ALTER TABLE chores ADD COLUMN school_minutes INTEGER;
ALTER TABLE school_logs ADD COLUMN chore_id TEXT;
ALTER TABLE school_logs ADD COLUMN chore_date TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_logs_chore ON school_logs(chore_id, chore_date) WHERE chore_id IS NOT NULL;
