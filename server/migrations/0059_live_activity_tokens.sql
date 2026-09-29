-- The iPhone app's Live Activity push tokens (routes/live-activities.ts, apns.ts): its
-- push-to-start token, and one update token per running activity. Kept per device: the device key
-- it registered with, or the app's sign-in (OAuth grant), whose access keys rotate hourly. Either
-- going deletes them. Sealed with the family's key; never returned by the API or logged.
CREATE TABLE live_activity_tokens (
  id TEXT PRIMARY KEY,
  device TEXT NOT NULL, -- 'key:<api key id>' or 'grant:<oauth grant id>'
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE CASCADE,
  oauth_grant_id TEXT REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('start', 'update')),
  activity TEXT NOT NULL DEFAULT '', -- '' for the start token; 'leaveBy:<event id>@<start>' for an update token
  token TEXT NOT NULL,
  ends_at TEXT, -- an update token's activity: when to end it
  created_at TEXT NOT NULL,
  UNIQUE (device, kind, activity)
);
