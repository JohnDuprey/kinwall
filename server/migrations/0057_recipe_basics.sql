-- Basics: recipes for components used inside other recipes (seasoning blends, sauces, doughs, stocks).
-- kind 'meal' is every recipe before this; makes is how much a recipe makes ("about ½ cup").
ALTER TABLE recipes ADD COLUMN kind TEXT NOT NULL DEFAULT 'meal' CHECK(kind IN ('meal', 'basic'));
ALTER TABLE recipes ADD COLUMN makes TEXT;
-- An ingredient line made from a basic. Deleting the basic unlinks the line and keeps its text.
ALTER TABLE recipe_ingredients ADD COLUMN basic_id TEXT REFERENCES recipes(id) ON DELETE SET NULL;
CREATE INDEX idx_recipe_ingredients_basic ON recipe_ingredients(basic_id) WHERE basic_id IS NOT NULL;
