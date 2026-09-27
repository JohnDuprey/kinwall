CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  preparation_notes TEXT,
  source_url TEXT,
  default_servings REAL NOT NULL CHECK(default_servings > 0),
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  quantity REAL CHECK(quantity >= 0),
  unit TEXT,
  preparation TEXT,
  qualifier TEXT,
  category TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id, sort);
CREATE TABLE meals (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK(slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  title TEXT NOT NULL,
  meal_kind TEXT NOT NULL CHECK(meal_kind IN ('recipe', 'freeform', 'dining_out')),
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  recipe_snapshot TEXT,
  servings REAL NOT NULL CHECK(servings > 0),
  assignee_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  notes TEXT,
  planned_time TEXT,
  -- No event FK: provider sync deletes and re-inserts its cached rows. Stable event ids survive it.
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'prepared', 'handled')),
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_meals_date ON meals(date, slot);
-- Per contribution rather than per date range: overlapping projections cannot add the same meal twice.
-- Removing a shopping item releases its sources so explicitly applying again can recreate it.
CREATE TABLE meal_shopping_sources (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (list_id, source_ref)
);
CREATE INDEX idx_meal_shopping_sources_item ON meal_shopping_sources(item_id);
