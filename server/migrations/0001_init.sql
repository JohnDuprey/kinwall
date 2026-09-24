CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- 'google' | 'microsoft' | 'caldav'
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', -- JSON, never returned by the API
  created_at TEXT NOT NULL
);

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- 'local' | 'ics' | 'google' | 'microsoft' | 'caldav'
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  remote_id TEXT,
  name TEXT NOT NULL,
  color TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  config TEXT NOT NULL DEFAULT '{}', -- JSON, e.g. {url} for ics; never returned by the API
  writable INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_error TEXT
);

CREATE INDEX idx_calendars_account ON calendars(account_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  external_id TEXT,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  description TEXT,
  rrule TEXT,
  member_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_events_calendar ON events(calendar_id);
CREATE INDEX idx_events_start ON events(start);

CREATE TABLE chores (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  points INTEGER NOT NULL DEFAULT 0,
  rrule TEXT,
  due_date TEXT,
  due_time TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE chore_completions (
  id TEXT PRIMARY KEY,
  chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  date TEXT NOT NULL, -- YYYY-MM-DD
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  completed_at TEXT NOT NULL,
  UNIQUE(chore_id, date)
);

CREATE INDEX idx_chore_completions_date ON chore_completions(date);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX idx_api_keys_hash ON api_keys(hash);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]', -- JSON array
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
