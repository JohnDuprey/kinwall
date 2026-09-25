-- Web Push: subscriptions (one per device), reminder storage on events, and a dedupe table so a
-- reminder/summary/nudge fires at most once per tick window.

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE, -- capability URL, treat as secret - never returned by the API
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_name TEXT NOT NULL,
  member_ids TEXT NOT NULL DEFAULT '[]', -- JSON array; [] = follows everyone
  prefs TEXT NOT NULL DEFAULT '{}', -- JSON: {eventReminders, dailySummary, summaryTime, choreNudge, choreNudgeTime, listUpdates}
  created_at TEXT NOT NULL,
  last_success_at TEXT
);

CREATE INDEX idx_push_subscriptions_api_key ON push_subscriptions(api_key_id);

ALTER TABLE events ADD COLUMN reminders TEXT; -- JSON array of minutes-before; NULL = unknown/none (falls back to the household default)

CREATE TABLE sent_notifications (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
