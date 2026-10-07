-- Family polls (routes/polls.ts): a parent asks ("Where are we eating Friday?"), everyone votes once
-- and can change it while the poll is open. A poll can be about a meal (date and slot); closing it
-- picks the winner, and planning it links the meal. Options are typed ideas or recipes; a recipe
-- option keeps its label if the recipe goes. Additive only: new tables, nothing else changes.
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  date TEXT,                      -- YYYY-MM-DD the poll decides, if any
  slot TEXT,                      -- breakfast, lunch, dinner or snack, with date
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  winner_option_id TEXT,
  meal_id TEXT REFERENCES meals(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status, created_at);
CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,            -- the idea, or the recipe's name when it was added
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id, sort);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, member_id)  -- one vote each; changing it replaces it
);
