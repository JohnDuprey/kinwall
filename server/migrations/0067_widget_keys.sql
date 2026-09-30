-- Widget and Apple Watch keys (POST /api/device-keys): the everyday-access keys the Kinwall app makes
-- for its widgets and Watch. Each remembers what made it: the key (a paired device, an API key, a
-- passkey session, or the widgets' key for the Watch) or the Kinwall app's sign-in (an OAuth grant,
-- whose access keys rotate). Removing that signs its widgets and Watch out too (the cascade), and
-- Settings -> Access lists them under it instead of among the paired devices (device_kind 'widgets').
ALTER TABLE api_keys ADD COLUMN parent_key_id TEXT REFERENCES api_keys(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN parent_grant_id TEXT REFERENCES oauth_grants(id) ON DELETE CASCADE;
-- Ones made before this have no link. They're marked by the exact names the app gives them, and keep
-- working (revoking them would break widgets that work today); anything else is left as it is.
UPDATE api_keys SET device_kind = 'widgets'
  WHERE kind = 'api' AND scope = 'display' AND name IN ('Widgets on iPhone', 'Widgets on iPad', 'Widgets on Android', 'Apple Watch');
