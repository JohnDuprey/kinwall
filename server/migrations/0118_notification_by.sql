-- Who made the change a feed row is about (a list update, a new poll): the device's key and, for
-- someone's own device, that person. The feed and pushes leave them out (notify.ts), so you aren't
-- told about your own change. Older rows have neither and show to everyone, as before.
ALTER TABLE notifications ADD COLUMN by_key TEXT;
ALTER TABLE notifications ADD COLUMN by_member TEXT;
