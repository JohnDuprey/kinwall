-- Notes threads on events and list items: who said what, in their colour. Polymorphic target, so
-- no FK on target_id - routes delete a target's notes with it. Event notes key on the Kinwall event
-- id: deterministic for synced events (event-id.ts), so they survive a resync; a recurring local
-- event is one series row, so its notes belong to the whole series. list_items.notes stays the
-- item's own description; these are the discussion.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('event', 'list_item')),
  target_id TEXT NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_target ON notes(target_type, target_id);
