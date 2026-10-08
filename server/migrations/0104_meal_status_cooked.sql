-- A meal is planned or cooked (prepared; Ordered when eating out). 'handled' meant the same as
-- prepared everywhere, so it's folded into it and no longer offered.
UPDATE meals SET status = 'prepared' WHERE status = 'handled';
