-- Home upkeep (routes/upkeep.ts, docs/using/upkeep.md): the things a family looks after, the jobs
-- that keep them working and a log of each time one was done. Costs are cents; dates are
-- YYYY-MM-DD in the family's timezone. Next due is computed (upkeep-rules.ts), never stored.
-- A job repeats 'once' (due_on), 'after' (every + unit from the last time it was done) or 'on'
-- (on_months + on_day: every March 1, spring and fall). handed_chore_id is the one-off chore made for a kid on the
-- due date (chore_points set), so ticking that chore logs the job. Additive only: new tables and a
-- default area list the family can rename, reorder, add to or delete.
CREATE TABLE IF NOT EXISTS upkeep_areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO upkeep_areas (id, name, emoji, sort, created_at) VALUES
  ('ua-heating', 'Heating & cooling', '🌡', 0, '2026-10-21T00:00:00.000Z'),
  ('ua-water', 'Water & plumbing', '🚰', 1, '2026-10-21T00:00:00.000Z'),
  ('ua-kitchen', 'Kitchen & laundry', '🧺', 2, '2026-10-21T00:00:00.000Z'),
  ('ua-safety', 'Safety', '🧯', 3, '2026-10-21T00:00:00.000Z'),
  ('ua-outside', 'Outside & yard', '🌳', 4, '2026-10-21T00:00:00.000Z'),
  ('ua-cars', 'Cars & bikes', '🚗', 5, '2026-10-21T00:00:00.000Z'),
  ('ua-pets', 'Pets', '🐾', 6, '2026-10-21T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS upkeep_things (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  area_id TEXT REFERENCES upkeep_areas(id) ON DELETE SET NULL,
  room TEXT,
  brand TEXT,
  model TEXT,
  serial TEXT,                    -- grown-ups' devices only
  part_notes TEXT,                -- what to buy: "Filter 16x25x1 MERV 8"
  bought_on TEXT,
  price_cents INTEGER CHECK (price_cents >= 0),
  warranty_until TEXT,
  manual_url TEXT,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0, -- sold or gone; its history stays
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upkeep_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT,
  thing_id TEXT REFERENCES upkeep_things(id) ON DELETE SET NULL,
  area_id TEXT REFERENCES upkeep_areas(id) ON DELETE SET NULL,
  repeat_kind TEXT NOT NULL DEFAULT 'after' CHECK (repeat_kind IN ('once', 'after', 'on')),
  every INTEGER CHECK (every > 0),
  unit TEXT CHECK (unit IN ('day', 'week', 'month', 'year')),
  on_months TEXT NOT NULL DEFAULT '[]', -- 'on': JSON months 1-12 ([3, 9] = March and September)
  on_day INTEGER CHECK (on_day BETWEEN 1 AND 31), -- 'on': day of the month (past the month's end = its last day)
  start_on TEXT,
  due_on TEXT,
  heads_up_days INTEGER NOT NULL DEFAULT 7 CHECK (heads_up_days BETWEEN 0 AND 60),
  snoozed_until TEXT,
  skipped_until TEXT,             -- "Skip this time": the next due date counts from here
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  usual_cost_cents INTEGER CHECK (usual_cost_cents >= 0),
  steps TEXT NOT NULL DEFAULT '[]',
  supplies TEXT NOT NULL DEFAULT '[]',
  supplies_list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
  supplies_days INTEGER NOT NULL DEFAULT 7 CHECK (supplies_days BETWEEN 0 AND 60),
  chore_points INTEGER CHECK (chore_points >= 0),
  handed_chore_id TEXT,
  calendar_event_id TEXT,
  wall_visible INTEGER NOT NULL DEFAULT 1,
  library_key TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upkeep_jobs_thing ON upkeep_jobs(thing_id);
CREATE INDEX IF NOT EXISTS idx_upkeep_jobs_chore ON upkeep_jobs(handed_chore_id);

CREATE TABLE IF NOT EXISTS upkeep_log (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES upkeep_jobs(id) ON DELETE SET NULL,
  thing_id TEXT REFERENCES upkeep_things(id) ON DELETE SET NULL,
  title TEXT NOT NULL,            -- copied from the job, so history reads right after a rename
  done_on TEXT NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  cost_cents INTEGER CHECK (cost_cents >= 0),
  reading INTEGER CHECK (reading >= 0),
  reading_unit TEXT CHECK (reading_unit IN ('mi', 'km', 'h')),
  notes TEXT,
  chore_id TEXT,
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upkeep_log_job ON upkeep_log(job_id, done_on);
CREATE INDEX IF NOT EXISTS idx_upkeep_log_thing ON upkeep_log(thing_id, done_on);

-- Receipts, invoices, the warranty card, a photo of the label. Apart from family photos so they
-- never show on the Board or the Night screen.
CREATE TABLE IF NOT EXISTS upkeep_files (
  id TEXT PRIMARY KEY,
  thing_id TEXT REFERENCES upkeep_things(id) ON DELETE CASCADE,
  log_id TEXT REFERENCES upkeep_log(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (thing_id IS NOT NULL OR log_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_upkeep_files_thing ON upkeep_files(thing_id);
CREATE INDEX IF NOT EXISTS idx_upkeep_files_log ON upkeep_files(log_id);

-- The morning tick's notes, chores and supplies, each once by its key (upkeep-rules.ts dueNotes).
-- Kept a year rather than sent_notifications' 3 days: a heads-up window can be weeks long.
CREATE TABLE IF NOT EXISTS upkeep_sent (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
