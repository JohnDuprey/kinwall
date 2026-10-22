-- Additive only: no backfill or deletion. Existing direct APNs subscriptions are unchanged.
ALTER TABLE push_subscriptions ADD COLUMN gateway_credential TEXT;
ALTER TABLE push_subscriptions ADD COLUMN gateway_expires_at INTEGER;
ALTER TABLE live_activity_tokens ADD COLUMN gateway_credential TEXT;
ALTER TABLE live_activity_tokens ADD COLUMN gateway_expires_at INTEGER;
ALTER TABLE live_activity_tokens ADD COLUMN gateway_token_hash TEXT;
CREATE INDEX idx_live_gateway_token ON live_activity_tokens(gateway_token_hash, kind);
