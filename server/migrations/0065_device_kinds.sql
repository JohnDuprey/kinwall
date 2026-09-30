-- What a device is (auth.ts deviceKindOwner): 'wall' (a wall screen, the whole family's), 'kid' (a
-- kid's own device) or 'grownup' (a grown-up's own device), or NULL (not said: widgets, admin keys
-- nobody owns). Always matches api_keys.owner; set when a device is paired or an admin changes it.
ALTER TABLE api_keys ADD COLUMN device_kind TEXT;

-- Paired devices from before kinds: they follow their owner. Shared ones were paired as the
-- family's wall screens (an app's shared widget keys land here too, labeled a wall screen).
UPDATE api_keys SET device_kind = 'wall' WHERE kind = 'api' AND scope = 'display' AND owner = 'shared';
UPDATE api_keys SET device_kind = CASE WHEN (SELECT grown_up FROM members WHERE members.id = api_keys.owner) = 1 THEN 'grownup' ELSE 'kid' END
  WHERE kind = 'api' AND scope = 'display' AND owner IN (SELECT id FROM members);
UPDATE api_keys SET device_kind = 'grownup' WHERE kind = 'api' AND scope = 'admin' AND owner IN (SELECT id FROM members);
