-- Groceries and Shopping (docs/using/lists.md "List types"): a shopping list is either Groceries or
-- Shopping (hardware store, department store...), and each type keeps its own catalog of remembered names,
-- places and categories. lists.kind stays 'shopping' for both (older apps know only that kind);
-- lists.catalog says which: 'groceries' | 'shopping', NULL on to-do and reusable lists.
ALTER TABLE lists ADD COLUMN catalog TEXT;

-- Existing shopping lists: Groceries when the name looks like groceries (the same words as
-- src/item-memory.ts looksLikeGroceries), when meals were added to it, or when it's the family's only
-- shopping list (before list types, a shopping list was the grocery list). Otherwise Shopping.
UPDATE lists SET catalog = CASE
  WHEN lower(name) LIKE '%grocer%' OR lower(name) LIKE '%food%' OR lower(name) LIKE '%market%'
    OR lower(name) LIKE '%produce%' OR lower(name) LIKE '%pantry%'
    OR EXISTS (SELECT 1 FROM meal_shopping_sources s WHERE s.list_id = lists.id)
    OR (SELECT count(*) FROM lists o WHERE o.kind = 'shopping') = 1
  THEN 'groceries' ELSE 'shopping' END
WHERE kind = 'shopping';

-- Names on a Shopping list now (grocery = 1 when on a Groceries list too). Everything remembered
-- goes to the grocery catalog except names only on Shopping lists; names on Shopping lists also go
-- to the shopping catalog. Checked-out names left no item behind, so they stay groceries.
CREATE TABLE catalog_split (name_key TEXT PRIMARY KEY, grocery INTEGER NOT NULL);
INSERT INTO catalog_split (name_key, grocery)
SELECT li.name_key, max(l.catalog = 'groceries') FROM list_items li JOIN lists l ON l.id = li.list_id
WHERE l.kind = 'shopping' AND li.name_key IS NOT NULL
GROUP BY li.name_key HAVING max(l.catalog = 'shopping') = 1;

CREATE TABLE item_names_new (
  catalog TEXT NOT NULL DEFAULT 'groceries',
  name_key TEXT NOT NULL,
  title TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  last_used TEXT NOT NULL,
  PRIMARY KEY (catalog, name_key)
);
INSERT INTO item_names_new (catalog, name_key, title, uses, last_used)
SELECT 'groceries', name_key, title, uses, last_used FROM item_names WHERE name_key NOT IN (SELECT name_key FROM catalog_split WHERE grocery = 0);
INSERT INTO item_names_new (catalog, name_key, title, uses, last_used)
SELECT 'shopping', name_key, title, uses, last_used FROM item_names WHERE name_key IN (SELECT name_key FROM catalog_split);
DROP TABLE item_names;
ALTER TABLE item_names_new RENAME TO item_names;
CREATE INDEX idx_item_names_rank ON item_names(catalog, uses DESC, last_used DESC);

CREATE TABLE item_memory_new (
  catalog TEXT NOT NULL DEFAULT 'groceries',
  name_key TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '',
  category TEXT,
  aisle TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (catalog, name_key, store)
);
INSERT INTO item_memory_new (catalog, name_key, store, category, aisle, updated_at)
SELECT 'groceries', name_key, store, category, aisle, updated_at FROM item_memory WHERE name_key NOT IN (SELECT name_key FROM catalog_split WHERE grocery = 0);
INSERT INTO item_memory_new (catalog, name_key, store, category, aisle, updated_at)
SELECT 'shopping', name_key, store, category, aisle, updated_at FROM item_memory WHERE name_key IN (SELECT name_key FROM catalog_split);
DROP TABLE item_memory;
ALTER TABLE item_memory_new RENAME TO item_memory;

CREATE TABLE item_tags_new (
  catalog TEXT NOT NULL DEFAULT 'groceries',
  name_key TEXT NOT NULL,
  tag TEXT NOT NULL COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (catalog, name_key, tag)
);
INSERT INTO item_tags_new (catalog, name_key, tag, sort)
SELECT 'groceries', name_key, tag, sort FROM item_tags WHERE name_key NOT IN (SELECT name_key FROM catalog_split WHERE grocery = 0);
INSERT INTO item_tags_new (catalog, name_key, tag, sort)
SELECT 'shopping', name_key, tag, sort FROM item_tags WHERE name_key IN (SELECT name_key FROM catalog_split);
DROP TABLE item_tags;
ALTER TABLE item_tags_new RENAME TO item_tags;
CREATE INDEX item_tags_tag ON item_tags (catalog, tag);

DROP TABLE catalog_split;
