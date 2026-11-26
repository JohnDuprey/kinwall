-- Rebuild only meal_kits so food without a recipe can share the existing inventory.
CREATE TABLE meal_kits_ready (
  id TEXT PRIMARY KEY,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  received_on TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'kit' CHECK(kind IN ('kit','prepped','frozen')),
  cook_by TEXT,
  title TEXT,
  UNIQUE(recipe_id, provider, received_on)
);
INSERT INTO meal_kits_ready (id,recipe_id,provider,received_on,quantity,done,created_at,updated_at)
  SELECT id,recipe_id,provider,received_on,quantity,done,created_at,updated_at FROM meal_kits;
DROP TABLE meal_kits;
ALTER TABLE meal_kits_ready RENAME TO meal_kits;
CREATE TRIGGER planning_meal_kits_insert AFTER INSERT ON meal_kits BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_meal_kits_update AFTER UPDATE ON meal_kits BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_meal_kits_delete AFTER DELETE ON meal_kits BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
ALTER TABLE meals ADD COLUMN ready_id TEXT;
ALTER TABLE meals ADD COLUMN prep_on TEXT;
CREATE INDEX idx_meals_ready_cooked ON meals(ready_id) WHERE status = 'prepared' AND ready_id IS NOT NULL;
CREATE INDEX idx_meals_prep_on ON meals(prep_on) WHERE prep_on IS NOT NULL AND ready_id IS NULL AND status = 'planned';
CREATE TRIGGER ready_item_delete AFTER DELETE ON meal_kits BEGIN UPDATE meals SET ready_id = NULL WHERE ready_id = OLD.id; END;
