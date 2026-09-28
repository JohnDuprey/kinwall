-- Structured recipe steps (JSON: [{ text, bullets, imageUrl }]). When set they're what the app shows;
-- instructions still carries the same steps as numbered text for exports and plain-text readers.
ALTER TABLE recipes ADD COLUMN steps TEXT;
