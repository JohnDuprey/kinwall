-- Each family member's favorite recipes (a heart, apart from their stars); un-hearting deletes the row.
CREATE TABLE recipe_favorites (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, member_id)
);
