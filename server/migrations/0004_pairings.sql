-- Display pairing (device-flow style): a display starts unauthenticated, an admin approves
-- with a 6-digit code, the display polls for its new key. Rows are short-lived (10 min TTL,
-- deleted on approval-poll or lazily on the next POST /api/pair once expired).
CREATE TABLE pairings (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  poll_token_hash TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  key_id TEXT,
  key_name TEXT,
  encrypted_key TEXT, -- AES-256-GCM via crypto.ts, AAD = pairings.id; plaintext key never stored
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_pairings_code ON pairings(code);
