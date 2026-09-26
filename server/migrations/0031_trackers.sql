-- Trackers: family logs of books read, daily memories and doctor/dentist visits. One generic table;
-- `data` holds the kind's own fields as JSON, validated per kind in routes/trackers.ts.
-- member_id NULL = the family. Removing a member keeps their entries: members.ts copies the name
-- into former_member first, then SET NULL, so "Leo (removed)" never quietly becomes the family's.
-- photo_id: a memory's one photo. photo_own = the photo was added for this entry (a memory photo,
-- not a pick from the family photos); the entry then decides whether it's also a family photo and
-- deletes it with itself when it isn't.
CREATE TABLE tracker_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('reading', 'memory', 'health')),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  former_member TEXT,
  date TEXT NOT NULL,
  title TEXT,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  photo_own INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tracker_entries_kind ON tracker_entries(kind, member_id, date);

-- family = 0: a memory's own photo. It shows inside its memory only: not in Activities -> Photos,
-- the Board, the screensaver or GET /api/photos. It still counts toward the photo storage limits.
ALTER TABLE photos ADD COLUMN family INTEGER NOT NULL DEFAULT 1;
