-- Imported recipes (e.g. a meal kit pushed from Home Assistant): where each came from, so importing
-- the same recipe again updates it instead of adding a copy, plus its picture.
ALTER TABLE recipes ADD COLUMN source TEXT;
ALTER TABLE recipes ADD COLUMN external_id TEXT;
ALTER TABLE recipes ADD COLUMN image_url TEXT;
CREATE UNIQUE INDEX idx_recipes_external ON recipes(source, external_id) WHERE external_id IS NOT NULL;
