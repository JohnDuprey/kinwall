-- OAuth 2.1 for the MCP endpoint (clients that can't send a custom header, e.g. Claude connectors).
-- Kinwall is its own authorization server. Secrets (codes, refresh tokens) are stored as sha256 hashes,
-- like api_keys; access tokens ARE api_keys rows (kind 'oauth', short expiry, tied to a grant).
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array, exact-match only
  created_at TEXT NOT NULL
);

-- One per approved connection; what Settings → Access lists and revokes.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL, -- 'admin' | 'display'
  approved_by TEXT,    -- api_keys.name of the approving session, for the audit line
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE oauth_codes (
  hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL, -- S256 only
  approved_by TEXT,
  expires_at TEXT NOT NULL,
  grant_id TEXT -- set once exchanged; a replayed code then revokes that grant
);

CREATE TABLE oauth_refresh_tokens (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT -- rotation: a used token presented again revokes the whole grant
);
CREATE INDEX idx_oauth_refresh_grant ON oauth_refresh_tokens(grant_id);

ALTER TABLE api_keys ADD COLUMN oauth_grant_id TEXT;
