-- Passkey (WebAuthn) credentials for admins, plus session keys minted at passkey login.
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE, -- base64url credential id from the authenticator
  public_key TEXT NOT NULL, -- base64url COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT, -- JSON string[]
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- api_keys gains an optional expiry (session keys expire; plain API keys don't) and a kind so
-- passkey-login sessions can be told apart from ordinary automation keys (e.g. hidden from the
-- API Keys list, cleaned up when their passkey is removed).
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'api';
-- Which passkey a session came from, so deleting a passkey can reliably delete its sessions
-- even after the passkey has been renamed (session.name is a point-in-time copy, not a link).
ALTER TABLE api_keys ADD COLUMN passkey_id TEXT;

-- Short-lived WebAuthn ceremony state: registration/authentication challenges, and one-time
-- "finish on your phone" registration tokens. Single-use, 5-15 min expiry - same disposable-row
-- pattern as `pairings`. `subject` disambiguates rows sharing this table:
--   kind='reg_challenge'  / 'auth_challenge' -> subject = challenge string itself (lookup key)
--   kind='reg_token'      -> subject = the token (lookup key); data unused
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_webauthn_challenges_subject ON webauthn_challenges(kind, subject);
