-- Per-device parent commands. No existing policy, app choice, or enrollment is changed.
-- Missing rows preserve current management; only an explicit parent action writes a row.
CREATE TABLE IF NOT EXISTS routine_device_enrollments (
  key_id TEXT PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  enrolled INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  acknowledged_revision INTEGER NOT NULL DEFAULT 0,
  choices_after_revision INTEGER NOT NULL DEFAULT 0
);
