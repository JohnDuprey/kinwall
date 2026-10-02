-- The library (0089): books the family wants but doesn't have yet (a wishlist). Kept off the shelf
-- until "Got it"; borrowing one takes it off the wishlist.
ALTER TABLE library_books ADD COLUMN wanted INTEGER NOT NULL DEFAULT 0;
