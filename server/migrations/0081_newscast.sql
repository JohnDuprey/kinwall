-- Newscast (routes/newscast.ts): what the family did and shared. Chores, rewards, photos, books,
-- memories and birthdays are read from their own tables when the feed is asked for; only
-- announcements and reactions are stored here. Both are deleted after 30 days (notify.ts).
-- status: live, or removed (by a parent: the author's devices show "Removed by a parent" in its place).
-- audience: everyone, or grownups (never on kids' devices or wall screens).
CREATE TABLE newscast_posts (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  emoji TEXT,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  audience TEXT NOT NULL DEFAULT 'everyone',
  status TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_newscast_posts_created ON newscast_posts(created_at);
-- item_key: a post (post:<id>) or a derived item's stable key (chores:<member>:<date>, book:<id>, ...).
CREATE TABLE newscast_reactions (
  item_key TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_key, member_id, emoji)
);
CREATE INDEX idx_newscast_reactions_created ON newscast_reactions(created_at);
-- Photos: a Paint drawing (and its artist in added_by), and who added a photo from their own device.
ALTER TABLE photos ADD COLUMN drawing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN added_by TEXT REFERENCES members(id) ON DELETE SET NULL;
-- The feed reads rewards given and memories by date: through these, not every row ever written.
CREATE INDEX idx_reward_redemptions_given ON reward_redemptions(status, given_at);
CREATE INDEX idx_tracker_entries_kind_date ON tracker_entries(kind, date);
