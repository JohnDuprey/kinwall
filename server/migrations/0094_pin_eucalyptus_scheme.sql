-- Peacock is the default color scheme from here on (routes/settings.ts DEFAULTS). A family set up
-- after 0084 that never picked a scheme had Eucalyptus implied, not stored; store it so their screens
-- don't change color under them. Families that picked a scheme (or got Peach from 0079 or Sage from
-- 0084) keep theirs, and a brand-new database has no members yet, so it gets the new default.
INSERT OR IGNORE INTO settings (key, value) SELECT 'colorScheme', 'eucalyptus' WHERE EXISTS (SELECT 1 FROM members);
