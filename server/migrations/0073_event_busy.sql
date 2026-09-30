-- Free/busy ("Show as") on an event (docs/using/events.md "Free or busy"). 1 = busy (the default,
-- and what every existing event stays); 0 = free: shown lighter and marked "Free", left out of
-- Now/Next, transition warnings, leave-by and the energy battery. Synced calendars fill it from the
-- provider (Google transparency, Outlook showAs, ICS TRANSP) and write it back.
ALTER TABLE events ADD COLUMN busy INTEGER NOT NULL DEFAULT 1;
