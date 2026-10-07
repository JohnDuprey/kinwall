-- The library (0089): a book or an audiobook, each its own item (a paper copy and an audiobook of one
-- title are two). Books made before from reading entries (shelve.ts) are sorted by their readers:
-- only audiobook entries makes it an audiobook; both makes a second, audiobook item (id + '-audiobook',
-- no ISBN, pages or shelf of the paper copy's) that the audiobook entries move to. Nothing is removed.
ALTER TABLE library_books ADD COLUMN format TEXT NOT NULL DEFAULT 'book';
UPDATE library_books SET format = 'audiobook'
  WHERE id IN (SELECT json_extract(data, '$.bookId') FROM tracker_entries WHERE kind = 'reading' AND json_extract(data, '$.format') = 'audiobook')
    AND id NOT IN (SELECT json_extract(data, '$.bookId') FROM tracker_entries WHERE kind = 'reading' AND json_extract(data, '$.bookId') IS NOT NULL
      AND coalesce(json_extract(data, '$.format'), 'book') != 'audiobook');
INSERT INTO library_books (id, title, author, isbn, pages, cover_url, year, series, series_number, lexile, description, genres, added_by, added_by_label, created_at, updated_at, format)
  SELECT b.id || '-audiobook', b.title, b.author, NULL, NULL,
    coalesce((SELECT json_extract(e.data, '$.coverUrl') FROM tracker_entries e WHERE e.kind = 'reading' AND json_extract(e.data, '$.bookId') = b.id
      AND json_extract(e.data, '$.format') = 'audiobook' AND json_extract(e.data, '$.coverUrl') IS NOT NULL ORDER BY e.created_at LIMIT 1), b.cover_url),
    b.year, b.series, b.series_number, b.lexile, b.description, b.genres, b.added_by, b.added_by_label, b.created_at, b.updated_at, 'audiobook'
  FROM library_books b WHERE b.format = 'book'
    AND b.id IN (SELECT json_extract(data, '$.bookId') FROM tracker_entries WHERE kind = 'reading' AND json_extract(data, '$.format') = 'audiobook');
UPDATE tracker_entries SET data = json_set(data, '$.bookId', json_extract(data, '$.bookId') || '-audiobook')
  WHERE kind = 'reading' AND json_extract(data, '$.format') = 'audiobook'
    AND json_extract(data, '$.bookId') IN (SELECT id FROM library_books WHERE format = 'book');
