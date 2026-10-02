-- Consecutive failed syncs per calendar (sync.ts): a success resets it. Parents' Home warning waits
-- for two in a row, so one network blip doesn't cry wolf; Settings still shows last_error at once.
ALTER TABLE calendars ADD COLUMN sync_failures INTEGER NOT NULL DEFAULT 0;
