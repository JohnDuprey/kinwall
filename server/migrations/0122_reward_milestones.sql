-- Additive only: no existing family data is changed or enrolled.
CREATE TABLE reward_milestones (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT,
  reward TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('points', 'chores')),
  target INTEGER NOT NULL CHECK(target > 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
-- baseline contains stable source keys already earned at enrollment, not a balance.
-- This avoids crediting old work or losing new progress when old work is undone.
CREATE TABLE reward_milestone_members (
  milestone_id TEXT NOT NULL REFERENCES reward_milestones(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  baseline TEXT NOT NULL DEFAULT '[]',
  paused_sources TEXT,
  paused_progress INTEGER,
  earned_at TEXT,
  given_at TEXT,
  PRIMARY KEY (milestone_id, member_id)
);
CREATE INDEX idx_reward_milestone_member ON reward_milestone_members(member_id);
