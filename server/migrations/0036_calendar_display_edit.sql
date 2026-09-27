-- Whether wall screens and kids' devices (display keys) may change this calendar's events.
-- On by default, so existing calendars keep today's behavior. Admin keys ignore it.
ALTER TABLE calendars ADD COLUMN display_edit INTEGER NOT NULL DEFAULT 1;
