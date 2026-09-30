-- Grocery catalog categories (docs/using/lists.md "Grocery catalog"): the family's own groupings for a
-- remembered item ("Breakfast", "Lunchbox"), apart from its store department. Keyed by the item's
-- matching key like item_names/item_memory; NOCASE so "snacks" and "Snacks" are one category.
-- sort keeps the order they were given in.
CREATE TABLE item_tags (
  name_key TEXT NOT NULL,
  tag TEXT NOT NULL COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name_key, tag)
);
CREATE INDEX item_tags_tag ON item_tags (tag);
