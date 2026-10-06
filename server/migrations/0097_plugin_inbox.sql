-- Activity plugin actions (routes/plugins.ts): things an integration (the REST API, MCP, Home
-- Assistant, n8n) asked a plugin to do for one person, like "add this spelling list". The plugin's
-- data format stays its own: Kinwall only queues the request, and the plugin applies it the next time
-- that person opens it, then acknowledges it (which deletes the row).
CREATE TABLE plugin_inbox (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,        -- '' = the family's shared data
  action TEXT NOT NULL,           -- a name the plugin's manifest declares under "actions"
  input TEXT NOT NULL,            -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX plugin_inbox_by_member ON plugin_inbox (plugin_id, member_id, created_at);
