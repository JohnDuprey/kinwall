-- Each family member's 1-5 star rating of a recipe; clearing a rating deletes its row.
CREATE TABLE recipe_ratings (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  PRIMARY KEY (recipe_id, member_id)
);
