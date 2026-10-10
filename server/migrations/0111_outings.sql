-- Outings (routes/outings.ts, docs/using/outings.md): things to do and places to go that the family
-- keeps, apart from the calendar. kind 'upcoming' has a date (or will: starts_on empty means the date
-- isn't announced yet); 'place' is any time. A run (a pumpkin patch open all October) has ends_on.
-- audience is a JSON array of kids, family, grownups; member_ids names people it's for. Prices are
-- shown and filtered, never added up (0 = free, empty = not known). calendar_event_id is the event
-- "Add to our calendar" made (cleared when that event is deleted). archived doubles as "Not for us".
-- source and inbox are for imports later (share sheet, town calendar feeds): inbox = 1 waits in a
-- pile until someone keeps it. Additive only: new tables, and a default category list the family can
-- rename, reorder, add to or delete.
CREATE TABLE IF NOT EXISTS outing_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO outing_categories (id, name, emoji, sort, created_at) VALUES
  ('oc-food', 'Food', '🍔', 0, '2026-10-09T00:00:00.000Z'),
  ('oc-drinks', 'Drinks', '🍺', 1, '2026-10-09T00:00:00.000Z'),
  ('oc-music', 'Music', '🎵', 2, '2026-10-09T00:00:00.000Z'),
  ('oc-movies', 'Movies', '🎬', 3, '2026-10-09T00:00:00.000Z'),
  ('oc-shows', 'Shows & theater', '🎭', 4, '2026-10-09T00:00:00.000Z'),
  ('oc-art', 'Art & museums', '🎨', 5, '2026-10-09T00:00:00.000Z'),
  ('oc-fairs', 'Fairs & festivals', '🎪', 6, '2026-10-09T00:00:00.000Z'),
  ('oc-markets', 'Markets', '🧺', 7, '2026-10-09T00:00:00.000Z'),
  ('oc-outdoors', 'Outdoors & nature', '🌲', 8, '2026-10-09T00:00:00.000Z'),
  ('oc-water', 'Beaches & water', '🏖', 9, '2026-10-09T00:00:00.000Z'),
  ('oc-sports', 'Sports', '🏟', 10, '2026-10-09T00:00:00.000Z'),
  ('oc-classes', 'Classes & workshops', '🧵', 11, '2026-10-09T00:00:00.000Z'),
  ('oc-library', 'Library & story time', '📚', 12, '2026-10-09T00:00:00.000Z'),
  ('oc-seasonal', 'Holidays & seasonal', '🎃', 13, '2026-10-09T00:00:00.000Z');
CREATE TABLE IF NOT EXISTS outings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'upcoming' CHECK (kind IN ('upcoming', 'place')),
  category_id TEXT REFERENCES outing_categories(id) ON DELETE SET NULL,
  starts_on TEXT,                 -- YYYY-MM-DD
  ends_on TEXT,                   -- YYYY-MM-DD, a run's last day
  start_time TEXT,                -- HH:MM household time; none = all day
  end_time TEXT,
  hours TEXT,                     -- a run's days and hours, as a note ("Fri–Sun, 9 to 5")
  place_name TEXT,
  address TEXT,
  price_cents INTEGER CHECK (price_cents >= 0),
  price_note TEXT,
  audience TEXT NOT NULL DEFAULT '[]',
  member_ids TEXT NOT NULL DEFAULT '[]',
  age_min INTEGER,
  age_max INTEGER,
  url TEXT,
  tickets_url TEXT,
  tickets_on_sale_at TEXT,        -- ISO time tickets go on sale
  buy_by TEXT,                    -- YYYY-MM-DD, last day to get tickets or sign up
  got_tickets INTEGER NOT NULL DEFAULT 0,
  visit_status TEXT CHECK (visit_status IN ('want', 'been')),
  last_visited_on TEXT,
  notes TEXT,
  calendar_event_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  inbox INTEGER NOT NULL DEFAULT 0,
  added_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outings_starts ON outings(archived, starts_on);
CREATE INDEX IF NOT EXISTS idx_outings_event ON outings(calendar_event_id);
CREATE TABLE IF NOT EXISTS outing_interest (
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('interested', 'really')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (outing_id, member_id)
);
