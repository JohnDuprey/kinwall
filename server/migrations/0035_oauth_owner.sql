-- Whose device a native app's sign-in is for, picked on the consent screen (Kinwall's own app only).
-- Same values as api_keys.owner: 'shared', a members.id, or NULL (approved before this, or an MCP
-- client). The grant's keys copy it. It pins everyday-access keys; full-access keys only use it for
-- personal defaults.
ALTER TABLE oauth_codes ADD COLUMN owner TEXT;
ALTER TABLE oauth_grants ADD COLUMN owner TEXT;
