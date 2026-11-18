-- Derived cooking history: no family records are changed.
CREATE INDEX IF NOT EXISTS idx_meals_recipe_cooked ON meals(recipe_id, date) WHERE status = 'prepared' AND recipe_id IS NOT NULL;
