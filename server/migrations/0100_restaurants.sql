-- The restaurant binder (Meals → Restaurants): the places the family orders from or eats at, and
-- what's on their menus. favorite is the family's star on an item (pinned to the top). Prices are
-- shown, never totaled. Additive only: nothing existing changes.
CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cuisine TEXT,
  phone TEXT,
  address TEXT,
  website TEXT,
  order_url TEXT,
  menu_url TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS restaurant_menu_items (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER CHECK(price_cents >= 0),
  favorite INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_restaurant ON restaurant_menu_items(restaurant_id, sort);
