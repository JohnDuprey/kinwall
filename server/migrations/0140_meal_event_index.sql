-- Calendar windows and reminders look up meal links by the matching event ids.
CREATE INDEX idx_meals_event ON meals(calendar_event_id) WHERE calendar_event_id IS NOT NULL;
