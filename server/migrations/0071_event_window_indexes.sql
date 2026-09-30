-- Reading events by window (routes/events.ts eventRowsStmts): hosted is billed per SQLite row read, and
-- every calendar view, the board and each notification tick used to read the whole events table.
-- (calendar_id, start) finds the rows starting near a window and replaces the calendar_id-only index,
-- so writes keep the same number of index rows. idx_events_open holds the few rows that can reach a
-- window from further back: local repeats and rows longer than a week (or with dates julianday can't
-- read). Its WHERE must match EVENT_OPEN in routes/events.ts exactly, or SQLite won't use it.
DROP INDEX IF EXISTS idx_events_calendar;
CREATE INDEX idx_events_calendar_start ON events(calendar_id, start);
CREATE INDEX idx_events_open ON events(calendar_id, start) WHERE rrule IS NOT NULL OR (julianday(end) - julianday(start) <= 7) IS NOT 1;
