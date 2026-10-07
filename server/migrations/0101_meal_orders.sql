-- Order nights (Meals): a dining_out meal from a restaurant in the binder (0100), how (eat there,
-- pickup or delivery), and each person's order. items is JSON [{ menuItemId, name, qty, note }] with
-- the name copied in, so editing the menu never rewrites a past order. Additive only: existing meals
-- keep restaurant_id and order_type empty.
ALTER TABLE meals ADD COLUMN restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL;
ALTER TABLE meals ADD COLUMN order_type TEXT CHECK(order_type IN ('dine_in', 'pickup', 'delivery'));
CREATE INDEX IF NOT EXISTS idx_meals_restaurant ON meals(restaurant_id, date);
CREATE TABLE IF NOT EXISTS meal_orders (
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (meal_id, member_id)
);
