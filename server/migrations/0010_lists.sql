-- Lists: shopping/todo/reusable lists with items grouped by store or category. Mirrors the
-- calendars/events and chores/chore_completions parent-child pattern (FK ON DELETE CASCADE,
-- already relied on there for both D1 and the node:sqlite adapter - see d1-sqlite.ts's
-- `PRAGMA foreign_keys = ON`).
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  color TEXT,
  kind TEXT NOT NULL, -- 'todo' | 'shopping' | 'reusable'
  member_ids TEXT NOT NULL DEFAULT '[]', -- JSON array; [] = whole family
  group_by TEXT NOT NULL DEFAULT 'none', -- 'store' | 'category' | 'none'
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  quantity TEXT,
  store TEXT,
  category TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  done_by TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_list_items_list ON list_items(list_id);
-- "Remembers where things go": lookup by lower(trim(title)) across all lists (see routes/lists.ts).
CREATE INDEX idx_list_items_title_lookup ON list_items(lower(trim(title)));

CREATE TABLE list_groups (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'store' | 'category'
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, kind, name)
);
