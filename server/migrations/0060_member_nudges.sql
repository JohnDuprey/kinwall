-- The last few transition reminder headlines a person got (nudges.ts NudgeSeen, JSON, at most 10):
-- part indexes, never text, so the next one avoids them. Never returned by the API.
ALTER TABLE members ADD COLUMN nudges TEXT;
