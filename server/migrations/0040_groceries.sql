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

-- Seed the memory from existing shopping items (previously looked up by title on each add), with
-- itemKey's rules: drop a plural s, then a final e, then a final y becomes i.
INSERT INTO item_memory (name_key, store, category, aisle, updated_at)
SELECT k3, store, category, NULL, updated_at FROM (
  SELECT CASE WHEN k2 LIKE '%y' THEN substr(k2, 1, length(k2) - 1) || 'i' ELSE k2 END AS k3, store, category, updated_at FROM (
    SELECT CASE WHEN length(k1) > 2 AND k1 LIKE '%e' THEN substr(k1, 1, length(k1) - 1) ELSE k1 END AS k2, store, category, updated_at FROM (
      SELECT CASE WHEN length(k0) > 3 AND k0 LIKE '%s' AND k0 NOT LIKE '%ss' AND k0 NOT LIKE '%us' AND k0 NOT LIKE '%is'
               THEN substr(k0, 1, length(k0) - 1) ELSE k0 END AS k1, store, category, updated_at FROM (
        SELECT lower(trim(li.title)) AS k0, coalesce(li.store, '') AS store, li.category, li.updated_at
        FROM list_items li JOIN lists l ON l.id = li.list_id
        WHERE l.kind = 'shopping' AND (li.store IS NOT NULL OR li.category IS NOT NULL)
      )
    )
  )
) WHERE true
ON CONFLICT (name_key, store) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at
  WHERE excluded.updated_at > item_memory.updated_at;
