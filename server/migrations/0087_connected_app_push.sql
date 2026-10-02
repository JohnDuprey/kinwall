-- A connected app (an OAuth sign-in that isn't Kinwall's own app) can no longer subscribe to push
-- (auth.ts CONNECTED_APP_DENIED): a subscription is a person's device, and a parent device's can
-- carry medicine names. Remove the ones made before that; the app's own sign-ins keep theirs.
DELETE FROM push_subscriptions WHERE api_key_id IN (
  SELECT k.id FROM api_keys k LEFT JOIN oauth_grants g ON g.id = k.oauth_grant_id
  WHERE k.kind = 'oauth' AND COALESCE(g.device_app, 0) = 0
);
