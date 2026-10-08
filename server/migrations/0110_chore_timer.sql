-- A chore's timer (routes/chores.ts): "Practice piano - 20 min". Start on the chore starts the app's
-- timer for this many minutes; null = no timer. Additive, no backfill. The chore's start time is the
-- existing due_time ("HH:MM"), now shown in the app.
ALTER TABLE chores ADD COLUMN timer_minutes INTEGER;
