-- Important items (sorted first among open items, see routes/lists.ts) and ordered sub-steps.
-- Steps cascade with their item (and so with the list); an item with steps is done exactly when
-- every step is (kept in step with it by the routes, not a trigger).
ALTER TABLE list_items ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'; -- 'normal' | 'high'

CREATE TABLE list_item_steps (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_list_item_steps_item ON list_item_steps(item_id);
