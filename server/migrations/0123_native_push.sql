-- Native APNs subscriptions belong to a stable OAuth grant, not its hourly access key.
-- Existing browser subscriptions are unchanged. No backfill or deletion.
ALTER TABLE push_subscriptions ADD COLUMN oauth_grant_id TEXT REFERENCES oauth_grants(id) ON DELETE CASCADE;
CREATE INDEX idx_push_subscriptions_grant ON push_subscriptions(oauth_grant_id);
CREATE INDEX idx_api_keys_oauth_grant_created ON api_keys(oauth_grant_id, created_at);
