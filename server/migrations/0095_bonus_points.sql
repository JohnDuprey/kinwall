-- Bonus points: a parent gives a member points outside a chore. Each is a point_entries row with
-- reason 'bonus', ref = the household day it counts on (YYYY-MM-DD) and an optional short note
-- ("Helped carry groceries"), so it adds to the balance like any ledger entry. The index serves the
-- today/week/leaderboard sums, which read bonus rows by day.
ALTER TABLE point_entries ADD COLUMN note TEXT;
CREATE INDEX idx_point_entries_reason_ref ON point_entries(reason, ref);
