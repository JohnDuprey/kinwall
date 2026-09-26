-- Family photos, stored as blobs so every backend (SQLite, D1, a Durable Object) works the same.
-- The web client downscales before upload; the route caps each photo at 600 KB and the family at
-- 200 photos / 100 MB.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  caption TEXT,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_photos_created ON photos(created_at);
