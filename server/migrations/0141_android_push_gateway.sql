-- Android capability metadata only; tokens/credentials stay encrypted with the family key.
ALTER TABLE push_subscriptions ADD COLUMN gateway_fingerprint TEXT;
ALTER TABLE push_subscriptions ADD COLUMN gateway_server TEXT;

-- Preserve encrypted capability and its original AAD after key/grant FK cascades. No alert
-- content or raw token is needed to revoke. Scheduled processing is bounded and best effort.
CREATE TABLE android_push_revocations (
  fingerprint TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  credential TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_gateway_fingerprint ON push_subscriptions(gateway_fingerprint) WHERE gateway_fingerprint IS NOT NULL;
CREATE TRIGGER android_gateway_removed AFTER DELETE ON push_subscriptions
WHEN OLD.endpoint LIKE 'fcm:%' AND OLD.gateway_fingerprint IS NOT NULL AND OLD.gateway_credential LIKE 'v1:%'
BEGIN
  -- Not OR IGNORE: an outer upsert's conflict policy overrides the trigger's.
  INSERT INTO android_push_revocations(fingerprint,subscription_id,credential,created_at)
    SELECT OLD.gateway_fingerprint,OLD.id,OLD.gateway_credential,unixepoch()*1000
    WHERE NOT EXISTS (SELECT 1 FROM android_push_revocations WHERE fingerprint=OLD.gateway_fingerprint);
END;
CREATE TRIGGER android_gateway_replaced AFTER UPDATE OF gateway_credential ON push_subscriptions
WHEN OLD.endpoint LIKE 'fcm:%' AND OLD.gateway_fingerprint IS NOT NULL AND OLD.gateway_credential LIKE 'v1:%'
  AND NEW.gateway_credential IS NOT OLD.gateway_credential
BEGIN
  -- Not OR IGNORE: an outer upsert's conflict policy overrides the trigger's.
  INSERT INTO android_push_revocations(fingerprint,subscription_id,credential,created_at)
    SELECT OLD.gateway_fingerprint,OLD.id,OLD.gateway_credential,unixepoch()*1000
    WHERE NOT EXISTS (SELECT 1 FROM android_push_revocations WHERE fingerprint=OLD.gateway_fingerprint);
END;
