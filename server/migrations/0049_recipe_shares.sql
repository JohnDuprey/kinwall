-- A recipe's public share link (/r/{token}): one active link per recipe. Stopping sharing deletes
-- the row; sharing again makes a new token. Not in the data export (the token is the secret).
CREATE TABLE recipe_shares (
  recipe_id TEXT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
