-- Who added and who checked off list items and steps, and when a reusable list was last done
-- (routes/lists.ts actorOf). A person is a member id (gone with them: the FK, or for list_items.done_by,
-- which predates it and has no FK, the member delete clears it); a device that is nobody's (a wall
-- screen, an automation key) or an AI connector ("Assistant") is a label instead. Both NULL: unknown.
ALTER TABLE list_items ADD COLUMN added_by TEXT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE list_items ADD COLUMN added_by_label TEXT;
ALTER TABLE list_items ADD COLUMN done_by_label TEXT;
ALTER TABLE list_item_steps ADD COLUMN added_by TEXT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE list_item_steps ADD COLUMN added_by_label TEXT;
ALTER TABLE list_item_steps ADD COLUMN done_by TEXT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE list_item_steps ADD COLUMN done_by_label TEXT;
ALTER TABLE lists ADD COLUMN last_done_at TEXT;
ALTER TABLE lists ADD COLUMN last_done_by TEXT REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE lists ADD COLUMN last_done_by_label TEXT;
