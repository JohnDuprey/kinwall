-- Transient outbound retries only. Payload, dose state, retry times and expiry are sealed.
-- No backfill; deleting a subscription discards its pending deliveries.
CREATE TABLE push_retries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_retries_subscription ON push_retries(subscription_id);
