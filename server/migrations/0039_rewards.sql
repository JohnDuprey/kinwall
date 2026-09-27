-- Rewards (routes/rewards.ts): parent-defined things a member spends chore points on.
-- member_ids: JSON array of who can see and redeem it; [] = everyone.
-- limit_period/limit_count: up to limit_count per member per household day / week; NULL period = no limit.
CREATE TABLE rewards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT,
  cost INTEGER NOT NULL,
  member_ids TEXT NOT NULL DEFAULT '[]',
  needs_approval INTEGER NOT NULL DEFAULT 1,
  limit_period TEXT,
  limit_count INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- One per redeem. The points come off right away (a point_entries row, reason 'reward', ref = this
-- id); declining refunds them (reason 'reward_refund'). title/emoji/cost are copied so history
-- survives the reward being edited or deleted. date = the household day, for the limits.
-- status: pending (waiting for a parent's OK) | approved | declined | given.
CREATE TABLE reward_redemptions (
  id TEXT PRIMARY KEY,
  reward_id TEXT REFERENCES rewards(id) ON DELETE SET NULL,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  emoji TEXT,
  cost INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  date TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  given_at TEXT
);
CREATE INDEX idx_reward_redemptions_member ON reward_redemptions(member_id, date);
CREATE INDEX idx_reward_redemptions_status ON reward_redemptions(status);

-- The reward a member is saving for (shown on the Board). No FK: a deleted or archived reward
-- just reads as no goal.
ALTER TABLE members ADD COLUMN reward_goal TEXT;
