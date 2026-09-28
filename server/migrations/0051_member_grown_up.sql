-- Grown-ups (parents and other adults): their chores never wait for a parent's OK, so
-- needs_approval stays 0 for them (routes/members.ts). Backfill: anyone whose birthday has a
-- year and who is 18 or older today; a --MM-DD birthday (no year) or none stays a kid.
ALTER TABLE members ADD COLUMN grown_up INTEGER NOT NULL DEFAULT 0;
UPDATE members SET grown_up = 1, needs_approval = 0 WHERE birthday GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(birthday, '+18 years') <= date('now');
