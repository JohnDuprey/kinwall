-- Private journals (routes/journal.ts "Private journals").
-- members.journal_private: the person's own choice, 1 on, 0 off, NULL = the default (a grown-up's
-- journal is private, a kid's isn't). members.journal_private_allowed: a parent lets a kid keep one.
ALTER TABLE members ADD COLUMN journal_private INTEGER;
ALTER TABLE members ADD COLUMN journal_private_allowed INTEGER NOT NULL DEFAULT 0;

-- Marked on the entry (and on the day's goal check, whose notes are journal text) when it's
-- written in a private journal, and never cleared, so turning privacy off later exposes nothing.
ALTER TABLE journal_entries ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
ALTER TABLE temp_checks ADD COLUMN private INTEGER NOT NULL DEFAULT 0;

-- Whose passkey this is (a grown-up's member id, or NULL): sessions it signs in carry it as their
-- api_keys.owner, so a parent reads their own private journal from their own devices.
ALTER TABLE passkeys ADD COLUMN owner TEXT;

-- Grown-ups are private by default, so what they already wrote becomes private too: it only ever
-- hides more (they read it again from a device that belongs to them). Kids' entries stay as they were.
UPDATE journal_entries SET private = 1 WHERE member_id IN (SELECT id FROM members WHERE grown_up = 1);
UPDATE temp_checks SET private = 1 WHERE followup IS NOT NULL AND member_id IN (SELECT id FROM members WHERE grown_up = 1);
