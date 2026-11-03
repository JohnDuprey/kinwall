-- Explicit per-device Live Activity choices. Existing devices keep leave-by behavior and do not
-- opt into medicine pushes. State is only a SHA-256 fingerprint, never medicine text or schedules.
ALTER TABLE live_activity_tokens ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}';
ALTER TABLE live_activity_tokens ADD COLUMN state_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE live_activity_tokens ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
