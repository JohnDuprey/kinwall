-- Points ledger + sticker book. A member's spendable balance is every points_awarded they earned
-- from chore completions plus the sum of their point_entries (negative for sticker-pack purchases,
-- positive for any future rewards/adjustments). The leaderboard keeps ranking by earned points.
CREATE TABLE point_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  at TEXT NOT NULL
);
CREATE INDEX idx_point_entries_member ON point_entries(member_id);

-- Sticker packs are defined in code (src/stickers.ts); this records which ones a member bought.
CREATE TABLE member_sticker_packs (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (member_id, pack_id)
);

-- Stickers placed on a member's scrapbook page. x/y are 0-1 fractions of the page (the sticker's
-- centre) so the page renders the same on any screen.
CREATE TABLE scrapbook_stickers (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sticker TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  scale REAL NOT NULL DEFAULT 1,
  rotation REAL NOT NULL DEFAULT 0,
  z INTEGER NOT NULL DEFAULT 0,
  placed_at TEXT NOT NULL
);
CREATE INDEX idx_scrapbook_stickers_member ON scrapbook_stickers(member_id);
