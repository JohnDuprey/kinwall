-- Scanning products into a shopping list (routes/lists.ts GET /api/lists/{id}/barcodes/{code}): the
-- family's own name for a barcode, per catalog, learned when a scanned item is added (item-memory.ts).
CREATE TABLE IF NOT EXISTS item_barcodes (
  catalog TEXT NOT NULL DEFAULT 'groceries',
  barcode TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (catalog, barcode)
);
