-- Actions taken by whoever hosts this instance, written only via recordHostEvent() (host-events.ts)
-- by an embedding host; shown to the family in Settings -> Access.
CREATE TABLE host_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_host_events_at ON host_events(at);

-- Fixed-window attempt counters for checkRate() (ratelimit.ts), e.g. 'passkey-login:<ip>'.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

-- The setup-code lockout moved from these settings keys to rate_limits.
DELETE FROM settings WHERE key IN ('setupCodeAttempts', 'setupCodeWindowStart');
