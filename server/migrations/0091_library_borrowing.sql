-- The library (0089): books borrowed rather than owned (from the town library, a friend), with the
-- date they're due back. Returning dates it and keeps the book as history (a Returned filter).
ALTER TABLE library_books ADD COLUMN borrowed_from TEXT;
ALTER TABLE library_books ADD COLUMN due_on TEXT;
ALTER TABLE library_books ADD COLUMN returned_on TEXT;
