-- Stores per catalog (docs/using/lists.md "Stores and departments"): each list type (Groceries,
-- Shopping) keeps its own stores' aisle orders, so a grocery list never offers the hardware store.
-- A store used in both catalogs has an order in each. Backfill: an existing order goes to every
-- catalog whose items (on lists or remembered) use that store, and to groceries when none do.
CREATE TABLE store_aisles_new (
  catalog TEXT NOT NULL DEFAULT 'groceries',
  store TEXT NOT NULL, -- '' = no store
  aisle TEXT NOT NULL,
  sort INTEGER NOT NULL,
  PRIMARY KEY (catalog, store, aisle)
);
CREATE TABLE store_catalogs (store TEXT NOT NULL, catalog TEXT NOT NULL, PRIMARY KEY (store, catalog));
INSERT OR IGNORE INTO store_catalogs (store, catalog)
SELECT DISTINCT coalesce(li.store, ''), coalesce(l.catalog, 'groceries') FROM list_items li JOIN lists l ON l.id = li.list_id
WHERE l.kind = 'shopping' AND coalesce(li.store, '') IN (SELECT store FROM store_aisles);
INSERT OR IGNORE INTO store_catalogs (store, catalog)
SELECT DISTINCT store, catalog FROM item_memory WHERE store IN (SELECT store FROM store_aisles);
INSERT INTO store_aisles_new (catalog, store, aisle, sort)
SELECT c.catalog, a.store, a.aisle, a.sort FROM store_aisles a JOIN store_catalogs c ON c.store = a.store;
INSERT INTO store_aisles_new (catalog, store, aisle, sort)
SELECT 'groceries', store, aisle, sort FROM store_aisles WHERE store NOT IN (SELECT store FROM store_catalogs);
DROP TABLE store_catalogs;
DROP TABLE store_aisles;
ALTER TABLE store_aisles_new RENAME TO store_aisles;
