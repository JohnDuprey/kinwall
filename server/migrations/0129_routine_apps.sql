-- Opt-in remote app choices. Opaque Apple selections are encrypted with the family's key.
-- No existing routines, chores, device ownership, or restrictions are changed.
CREATE TABLE IF NOT EXISTS routine_app_selections (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  selected_apps INTEGER NOT NULL,
  selected_categories INTEGER NOT NULL,
  allowed_apps INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routine_devices (
  key_id TEXT PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  authorized INTEGER NOT NULL,
  applied_revision INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS routine_devices_member ON routine_devices(member_id);
