-- What a list is for, beyond its kind. 'pantry': food at home, on a to-do list (kind stays 'todo' so
-- older apps keep working): an item's due_date is its use-by date and its category where it's kept.
-- NULL on every other list.
ALTER TABLE lists ADD COLUMN purpose TEXT;
-- Pantry lists: add food to the family's default Groceries list when it's checked off (used up).
ALTER TABLE lists ADD COLUMN restock INTEGER NOT NULL DEFAULT 0;
-- The Groceries item a pantry item added when checked off, so unticking a mis-tap takes it back off.
ALTER TABLE list_items ADD COLUMN restock_item_id TEXT;
