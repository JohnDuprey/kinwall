-- Groceries: an aisle on list items, the per-list "keep checked items in place" option, what the
-- household remembers about where things go, and each store's own aisle order.

ALTER TABLE list_items ADD COLUMN aisle TEXT; -- per store, e.g. "Aisle 4" or "Back wall"

-- Checked items stay where they are (crossed off) until Checkout / Reset. On by default for
-- shopping and reusable lists; to-do lists keep their Done section.
ALTER TABLE lists ADD COLUMN keep_checked INTEGER NOT NULL DEFAULT 0;
UPDATE lists SET keep_checked = 1 WHERE kind IN ('shopping', 'reusable');

-- The store/category/aisle last used for an item, by matching key (src/item-memory.ts itemKey).
-- store '' = no store. The newest row for a name gives its store and category; the row for the
-- chosen store gives its aisle.
CREATE TABLE item_memory (
  name_key TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '',
  category TEXT,
  aisle TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (name_key, store)
);

-- A store's aisles in walking order, when the family set one (otherwise natural order).
CREATE TABLE store_aisles (
  store TEXT NOT NULL, -- '' = no store
  aisle TEXT NOT NULL,
  sort INTEGER NOT NULL,
  PRIMARY KEY (store, aisle)
);

-- Each item's matching key (src/item-memory.ts itemKey), so a list's items join to what's
-- remembered about them in one query. Backfilled with itemKey's rules: drop a plural s, then a
-- final e, then a final y becomes i (in SQL, without itemKey's Unicode normalization).
ALTER TABLE list_items ADD COLUMN name_key TEXT;
UPDATE list_items SET name_key = lower(trim(title));
UPDATE list_items SET name_key = substr(name_key, 1, length(name_key) - 1)
  WHERE length(name_key) > 3 AND name_key LIKE '%s' AND name_key NOT LIKE '%ss' AND name_key NOT LIKE '%us' AND name_key NOT LIKE '%is';
UPDATE list_items SET name_key = substr(name_key, 1, length(name_key) - 1) WHERE length(name_key) > 2 AND name_key LIKE '%e';
UPDATE list_items SET name_key = substr(name_key, 1, length(name_key) - 1) || 'i' WHERE name_key LIKE '%y';

-- Seed the memory from existing shopping items (previously looked up by title on each add).
INSERT INTO item_memory (name_key, store, category, aisle, updated_at)
SELECT li.name_key, coalesce(li.store, ''), li.category, NULL, li.updated_at
FROM list_items li JOIN lists l ON l.id = li.list_id
WHERE l.kind = 'shopping' AND (li.store IS NOT NULL OR li.category IS NOT NULL) AND true
ON CONFLICT (name_key, store) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at
  WHERE excluded.updated_at > item_memory.updated_at;
