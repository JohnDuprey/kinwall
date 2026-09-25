-- One-time admin recovery codes (routes/recovery.ts). Only SHA-256 hashes are stored; generating
-- a new set deletes the old one.
CREATE TABLE recovery_codes (
  hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  used_at TEXT
);
