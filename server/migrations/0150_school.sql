-- School (routes/school.ts, docs/using/school.md): subjects, which kids are in school, and a log of
-- school time. Its own feature switch (settings.features.school), off until a family turns it on.
-- One save that covers several kids writes one log row per kid, tied by group_id, so each kid's
-- totals are a plain sum and one kid's note can change on its own. pending = 1: a kid logged it
-- from a wall or their own device and their school settings ask a grown-up to approve it first;
-- pending rows don't count toward hours. Removing a member keeps their logs: members.ts copies the
-- name into former_member first, then the FK clears member_id (as tracker_entries do). Additive only: new tables and a starter subject list the
-- family can rename, reorder, add to or delete.
CREATE TABLE IF NOT EXISTS school_subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO school_subjects (id, name, emoji, color, sort, created_at) VALUES
  ('ss-math', 'Math', '🔢', '#5B8DEF', 0, '2026-11-16T00:00:00.000Z'),
  ('ss-reading', 'Reading', '📖', '#E86A92', 1, '2026-11-16T00:00:00.000Z'),
  ('ss-writing', 'Writing', '✏️', '#C8610F', 2, '2026-11-16T00:00:00.000Z'),
  ('ss-science', 'Science', '🔬', '#2BAE8E', 3, '2026-11-16T00:00:00.000Z'),
  ('ss-history', 'History', '🏛️', '#B07A3B', 4, '2026-11-16T00:00:00.000Z'),
  ('ss-art', 'Art', '🎨', '#A06BE0', 5, '2026-11-16T00:00:00.000Z'),
  ('ss-music', 'Music', '🎵', '#3B9FC8', 6, '2026-11-16T00:00:00.000Z'),
  ('ss-pe', 'PE', '⚽', '#E0A431', 7, '2026-11-16T00:00:00.000Z');

-- A row = this kid is in school. mode: 'home' (homeschooled) or 'enrolled' (goes to a school).
CREATE TABLE IF NOT EXISTS school_kids (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'home' CHECK (mode IN ('home', 'enrolled')),
  grade TEXT,
  approve_logs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_logs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  former_member TEXT,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  title TEXT,
  notes TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_logs_date ON school_logs(date, member_id);
CREATE INDEX IF NOT EXISTS idx_school_logs_group ON school_logs(group_id);
