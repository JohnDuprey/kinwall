-- An item on sale ("🏷️ Sale" on the row). Cleared when the item is checked off, so buy-again
-- doesn't carry an old sale into the next trip. New column only, no backfill.
ALTER TABLE list_items ADD COLUMN on_sale INTEGER NOT NULL DEFAULT 0;
