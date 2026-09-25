-- Link a list item (task) to a calendar event. No FK on purpose: synced events are deleted and
-- reinserted wholesale on every sync (with the same deterministic id, see event-id.ts), and the
-- link must survive that. A link to an event that's gone simply stops resolving.
ALTER TABLE list_items ADD COLUMN event_id TEXT;
CREATE INDEX idx_list_items_event ON list_items(event_id);
