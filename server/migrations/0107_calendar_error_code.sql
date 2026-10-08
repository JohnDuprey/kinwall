-- Why a calendar's last sync failed, beside last_error (sync.ts): 'revoked' when Google or Microsoft
-- turned down the sign-in (OAuth invalid_grant), so only reconnecting fixes it; NULL otherwise.
-- reconnect_notified_at: when the grown-ups were told (notify.ts), so they're told once per outage;
-- a good sync clears both. Additive: existing rows start NULL and the next sync fills them.
ALTER TABLE calendars ADD COLUMN last_error_code TEXT;
ALTER TABLE calendars ADD COLUMN reconnect_notified_at TEXT;
