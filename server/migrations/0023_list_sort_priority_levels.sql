-- Per-list item order ('manual' | 'added' | 'due' | 'priority' | 'alpha', see routes/lists.ts).
-- list_items.priority is TEXT already: it widens to 'low' | 'normal' | 'high' | 'urgent' in code
-- (existing 'normal'/'high' rows keep their meaning).
ALTER TABLE lists ADD COLUMN sort_by TEXT NOT NULL DEFAULT 'manual';
