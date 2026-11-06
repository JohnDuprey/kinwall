-- Indexes and derived counts only; no data changes.
-- Each list's item and open counts, built once and kept in step with every item change
-- (including cascades), so the list overview doesn't count years of done items.
CREATE TABLE list_item_counts (
  list_id TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  items INTEGER NOT NULL DEFAULT 0,
  open INTEGER NOT NULL DEFAULT 0
);
INSERT INTO list_item_counts(list_id, items, open)
SELECT list_id, COUNT(*), SUM(done = 0) FROM list_items GROUP BY list_id;

CREATE TRIGGER list_counts_insert AFTER INSERT ON list_items BEGIN
  INSERT INTO list_item_counts(list_id, items, open) VALUES (new.list_id, 1, new.done = 0)
  ON CONFLICT(list_id) DO UPDATE SET items = items + 1, open = open + excluded.open;
END;
CREATE TRIGGER list_counts_delete AFTER DELETE ON list_items BEGIN
  UPDATE list_item_counts SET items = items - 1, open = open - (old.done = 0) WHERE list_id = old.list_id;
END;
CREATE TRIGGER list_counts_update AFTER UPDATE OF list_id, done ON list_items BEGIN
  UPDATE list_item_counts SET items = items - 1, open = open - (old.done = 0) WHERE list_id = old.list_id;
  INSERT INTO list_item_counts(list_id, items, open) VALUES (new.list_id, 1, new.done = 0)
  ON CONFLICT(list_id) DO UPDATE SET items = items + 1, open = open + excluded.open;
END;

-- The notifications feed pages newest day first, then insertion order (rowid rides along).
CREATE INDEX IF NOT EXISTS idx_notifications_day ON notifications(substr(at, 1, 10));
-- Recent reward requests, newest first.
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_requested ON reward_redemptions(requested_at);
-- The board's active chores, in order, without reading archived ones.
CREATE INDEX IF NOT EXISTS idx_chores_active ON chores(sort, created_at) WHERE active = 1;
