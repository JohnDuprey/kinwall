-- The library (0089, 0098): details looked up on Open Library after a book is added (book-details.ts).
-- work_key is the Open Library work it matched; looked_up_at when it was last looked up, matched or
-- not, so a book Open Library doesn't know isn't asked about again for a month. Ratings are Open
-- Library readers' (average of 5, and how many).
ALTER TABLE library_books ADD COLUMN work_key TEXT;
ALTER TABLE library_books ADD COLUMN looked_up_at TEXT;
ALTER TABLE library_books ADD COLUMN ratings_average REAL;
ALTER TABLE library_books ADD COLUMN ratings_count INTEGER;
