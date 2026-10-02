-- A default list per shopping type (routes/lists.ts PATCH isDefault): the Groceries or Shopping list that
-- barcode scans, meal ingredients, the app's widgets, Siri and tiles use. At most one per catalog,
-- kept by the route; 0 everywhere to start (clients fall back to the first list of the type).
ALTER TABLE lists ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
