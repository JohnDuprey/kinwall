-- Google Photos for the Night screen and the Board's picture (routes/google-photos.ts, Ambient API).
-- One row per family, apart from calendar accounts, so either can be disconnected alone. config is
-- sealed with the family key: the pending device code while connecting, then the tokens.
CREATE TABLE google_photos (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL,
  request_id TEXT NOT NULL,       -- v4 UUID Google creates the Ambient device under
  user_code TEXT,                 -- while signing in: the code the parent types at verification_url
  verification_url TEXT,
  code_expires_at TEXT,
  device_id TEXT,                 -- set once signed in and the Ambient device exists
  settings_uri TEXT,              -- Google Photos page where the parent picks albums
  sources_set INTEGER NOT NULL DEFAULT 0,
  poll_seconds INTEGER NOT NULL DEFAULT 5,
  next_poll_at TEXT,
  items_at TEXT,                  -- last media list refresh
  problem TEXT,                   -- 'reconnect': Google refused the tokens or the device is gone
  created_at TEXT NOT NULL
);
-- The picked photos: ids and a little metadata only. base_url is Google's 60-minute link to the
-- bytes, replaced on each refresh; the bytes themselves are never stored.
CREATE TABLE google_photo_items (
  id TEXT PRIMARY KEY,
  created TEXT,
  width INTEGER,
  height INTEGER,
  base_url TEXT,
  shown_at TEXT
);
