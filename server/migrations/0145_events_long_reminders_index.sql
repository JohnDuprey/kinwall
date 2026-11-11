-- Reminders more than a day ahead (notify.ts reads up to four weeks ahead for them): a partial index
-- of the events whose reminders hold a number of 1000 or more, so each tick scans only those rows
-- instead of every event in the next four weeks. The GLOB is a cheap superset; the query checks the
-- exact values.
CREATE INDEX idx_events_long_reminders ON events(calendar_id, start) WHERE reminders GLOB '*[0-9][0-9][0-9][0-9]*';
