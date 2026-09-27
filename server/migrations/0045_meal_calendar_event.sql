-- How the calendar event Kinwall created for a meal starts: 'meal' (at the meal time) or 'cooking'
-- (ends at the meal time). NULL = no event, or one the family linked themselves (never edited).
ALTER TABLE meals ADD COLUMN calendar_event_start TEXT;
UPDATE meals SET calendar_event_start = 'meal' WHERE calendar_event_id LIKE 'meal:%';
