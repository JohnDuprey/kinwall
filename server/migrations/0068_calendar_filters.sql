-- Calendar filters (docs/using/calendar.md "Calendar filters"): JSON { mode, keywords, allDay,
-- categoryIds }, NULL = show everything. Evaluated when events are read (calendar-filter.ts), so
-- sync keeps storing every event and changing a filter needs no resync.
ALTER TABLE calendars ADD COLUMN filter TEXT;
