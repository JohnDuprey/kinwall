-- Activity plugins (routes/plugins.ts): packages an admin installed, their files, and the small
-- per-person data each one saves (progress, high scores). Files live in the database so SQLite,
-- D1 and a Durable Object all behave the same, like photos.
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,            -- the manifest's id, e.g. 'sight-words'
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,         -- kinwall-plugin.json as installed
  source TEXT,                    -- 'owner/repo' on GitHub it installs and updates from; NULL = uploaded package
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE plugin_files (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (plugin_id, path)
);
CREATE TABLE plugin_data (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,        -- '' = the family's shared data
  key TEXT NOT NULL,
  value TEXT NOT NULL,            -- JSON
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, member_id, key)
);
