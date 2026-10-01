-- The family's security log (security-events.ts): sign-ins, passkeys, recovery codes, keys, paired
-- devices, connected apps, whose device something is. Parent devices read it in Settings → Access.
-- Never secrets: no keys, tokens, codes or credential IDs. Pruned on write to a year / 500 rows.
CREATE TABLE security_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_member_id TEXT,
  actor_label TEXT,
  device TEXT,
  detail TEXT
);
CREATE INDEX security_events_at ON security_events (at); -- the year cutoff; the order is rowid (the order written)
