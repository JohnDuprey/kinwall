-- Whether a connected app is Kinwall's own app (a family device) comes from the link it actually
-- signed in on, stored on the grant, not from every redirect its client registered
-- (routes/mcp-oauth.ts, auth.ts deviceAppGrant).
ALTER TABLE oauth_grants ADD COLUMN device_app INTEGER NOT NULL DEFAULT 0;

-- Existing sign-ins: the Kinwall app's clients only ever registered its own link, so their grants
-- stay family devices. A client that also listed other addresses isn't the app.
UPDATE oauth_grants SET device_app = 1 WHERE client_id IN (
  SELECT c.id FROM oauth_clients c
  WHERE EXISTS (SELECT 1 FROM json_each(c.redirect_uris) WHERE value LIKE 'family.kinwall.app:%')
    AND NOT EXISTS (SELECT 1 FROM json_each(c.redirect_uris) WHERE value NOT LIKE 'family.kinwall.app:%')
);
