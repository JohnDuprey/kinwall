CREATE TABLE meal_kits (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  received_on TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(recipe_id, provider, received_on)
);

-- Keep reviewed weekly plans current when a box or its cook-by window changes.
CREATE TRIGGER planning_meal_kits_insert AFTER INSERT ON meal_kits BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_meal_kits_update AFTER UPDATE ON meal_kits BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_meal_kits_delete AFTER DELETE ON meal_kits BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_kit_days_insert AFTER INSERT ON settings WHEN NEW.key = 'mealKitDays' BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_kit_days_update AFTER UPDATE ON settings WHEN NEW.key = 'mealKitDays' BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER planning_kit_days_delete AFTER DELETE ON settings WHEN OLD.key = 'mealKitDays' BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
