-- Client address that started a pairing, for the per-IP pending cap on POST /api/pair.
ALTER TABLE pairings ADD COLUMN ip TEXT;
