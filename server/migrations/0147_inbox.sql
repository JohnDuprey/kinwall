-- Additive only: the quick-capture inbox. Existing data and settings are unchanged.
CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sorted', 'cleared')),
  target TEXT, -- JSON: where a sorted thought went ({kind, id, listId?, label?, at?}); null until it's made
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_items_status ON inbox_items(status, created_at);
