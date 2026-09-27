-- Per-person transition reminders (JSON: { on, minutes, repeat, leaveBy }), pushed to that
-- person's own devices before their events. NULL = off (the default).
ALTER TABLE members ADD COLUMN transitions TEXT;
