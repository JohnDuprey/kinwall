-- Outings imports (routes/outing-feeds.ts, docs/using/outings.md#community-calendars): a community
-- calendar's iCal (.ics) link, read once a day 90 days ahead. Its new items wait in a pile (outings.inbox
-- = 1) until a grown-up keeps them; feed_id + external_id (the feed item's UID) let a refetch update an
-- item instead of adding it again. canceled marks a kept item the feed called off. Additive only: a new
-- table and three new columns, nothing filled in or changed for existing outings.
CREATE TABLE IF NOT EXISTS outing_feeds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category_id TEXT REFERENCES outing_categories(id) ON DELETE SET NULL,
  audience TEXT NOT NULL DEFAULT '[]',
  skip_words TEXT NOT NULL DEFAULT 'meeting, committee, board, hearing',
  etag TEXT,
  fingerprint TEXT,
  last_fetched_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE outings ADD COLUMN feed_id TEXT REFERENCES outing_feeds(id) ON DELETE SET NULL;
ALTER TABLE outings ADD COLUMN external_id TEXT;
ALTER TABLE outings ADD COLUMN canceled INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outings_feed_item ON outings(feed_id, external_id);
