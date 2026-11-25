-- A household's own recipe tags. Existing recipes start without tags.
CREATE TABLE IF NOT EXISTS recipe_tags (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS recipe_tag_links (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES recipe_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_tag_links_tag ON recipe_tag_links(tag_id, recipe_id);
