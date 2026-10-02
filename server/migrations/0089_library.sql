-- The family's library (routes/library.ts): books the family owns, apart from who is reading what
-- (tracker_entries; a reading entry started from a book carries data.bookId). Details from Open
-- Library are copied in when a book is added (series, reading level, description), so browsing the
-- library never calls out.
CREATE TABLE IF NOT EXISTS library_books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  pages INTEGER,
  cover_url TEXT,
  year INTEGER,
  series TEXT,
  series_number TEXT,
  lexile INTEGER,
  description TEXT,
  genres TEXT, -- JSON array, e.g. ["Fantasy","Animals"]
  added_by TEXT,
  added_by_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS library_books_isbn ON library_books (isbn) WHERE isbn IS NOT NULL;
