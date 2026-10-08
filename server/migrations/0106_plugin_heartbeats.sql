-- When each person's play time for an activity last reached the server (routes/plugins.ts), so a
-- heartbeat counts at most the real time since the one before: a wall or a script sending many at
-- once can't finish an activity chore without the play. Additive; at is milliseconds since 1970.
CREATE TABLE IF NOT EXISTS plugin_heartbeats (
  member_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (member_id, plugin_id)
);
