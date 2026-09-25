-- In-app notification feed: one row per notification Kinwall sends (reminder, daily summary,
-- chore nudge, list update, custom message), recorded whether or not any device has push on.
-- Pruned to 90 days by the notification tick (notify.ts).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'reminder' | 'summary' | 'chore' | 'list' | 'message'
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  member_ids TEXT NOT NULL DEFAULT '[]', -- JSON array; [] = everyone
  source TEXT -- 'system' | 'api' | 'mcp'
);

CREATE INDEX idx_notifications_at ON notifications(at);
