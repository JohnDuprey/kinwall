-- Autocomplete: the names the household has put on shopping lists, by matching key
-- (src/item-memory.ts itemKey), with the spelling last used and how often. Checkout deletes items,
-- so this is the only record of past names.
CREATE TABLE item_names (
  name_key TEXT PRIMARY KEY,
  title TEXT NOT NULL, -- the spelling last used
  uses INTEGER NOT NULL DEFAULT 0, -- times added
  last_used TEXT NOT NULL
);
CREATE INDEX idx_item_names_rank ON item_names(uses DESC, last_used DESC);

-- Backfill from items on shopping lists now: the newest spelling (SQLite takes bare columns from
-- the max() row), one use per item.
INSERT INTO item_names (name_key, title, uses, last_used)
SELECT li.name_key, trim(li.title), count(*), max(li.updated_at)
FROM list_items li JOIN lists l ON l.id = li.list_id
WHERE l.kind = 'shopping' AND coalesce(li.name_key, '') != ''
GROUP BY li.name_key;

-- Checked-out items live on only in item_memory, which keeps no spelling: the key stands in for the
-- title (e.g. "banana milk") until the item is added again with a real one.
INSERT INTO item_names (name_key, title, uses, last_used)
SELECT name_key, name_key, count(*), max(updated_at) FROM item_memory
WHERE name_key != '' AND name_key NOT IN (SELECT name_key FROM item_names)
GROUP BY name_key;
