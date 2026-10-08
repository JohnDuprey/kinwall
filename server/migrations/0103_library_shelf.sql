-- The library's shelves (0089): who a book is for, 'kids', 'grownups' or 'everyone'. Only a parent's
-- pick is stored; null is Auto, decided when the library is read (shelve.ts autoShelf), so nothing is
-- backfilled and existing books keep sorting themselves as their details fill in.
ALTER TABLE library_books ADD COLUMN shelf TEXT;
