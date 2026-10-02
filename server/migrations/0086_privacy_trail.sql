-- The trail around private journals (routes/journal.ts "Private journals") that another parent's
-- device can't erase or sidestep.

-- When a sign-in became its owner's (NULL: since it was made). A privacy note is removed only from
-- a device that was already that person's before the note was written (routes/push.ts), so a device
-- that says it's someone's can't remove the note about that. A passkey's sessions and an app
-- sign-in's rotating keys go by the passkey's and the grant's.
ALTER TABLE api_keys ADD COLUMN owner_since TEXT;
ALTER TABLE passkeys ADD COLUMN owner_since TEXT;
ALTER TABLE oauth_grants ADD COLUMN owner_since TEXT;

-- The member a security event is about (whose device, whose journal; '' for none). The log keeps
-- the newest 500 of each kind for each person (routes/security-events.ts), so a flood of other
-- events, or of events about someone else, can't push those out.
ALTER TABLE security_events ADD COLUMN about TEXT NOT NULL DEFAULT '';
CREATE INDEX security_events_kind ON security_events (kind, about);

-- journal_entries.private and temp_checks.private say what reading the words takes: 1 written as a
-- kid (their own device), 2 written as a grown-up (their own full-access device only), so marking
-- a grown-up as a kid later never hands their entries to an everyday-access device.
UPDATE journal_entries SET private = 2 WHERE private = 1 AND member_id IN (SELECT id FROM members WHERE grown_up = 1);
UPDATE temp_checks SET private = 2 WHERE private = 1 AND member_id IN (SELECT id FROM members WHERE grown_up = 1);
