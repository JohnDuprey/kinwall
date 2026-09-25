-- Members and categories were created with sort = 0, so every row tied and the saved order
-- couldn't hold. Renumber them in their current order (sort, then creation time).
UPDATE members SET sort = (SELECT n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY sort, created_at) - 1 AS n FROM members) r WHERE r.id = members.id);
UPDATE categories SET sort = (SELECT n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY sort, created_at) - 1 AS n FROM categories) r WHERE r.id = categories.id);
