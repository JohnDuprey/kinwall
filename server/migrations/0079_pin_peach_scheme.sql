-- Sage is the default color scheme from here on (routes/settings.ts DEFAULTS). A family that never
-- picked a scheme had Peach (id 'meadow') implied, not stored; store it so their screens don't
-- change color under them. A brand-new database has no members yet, so it gets the new default.
INSERT OR IGNORE INTO settings (key, value) SELECT 'colorScheme', 'meadow' WHERE EXISTS (SELECT 1 FROM members);
