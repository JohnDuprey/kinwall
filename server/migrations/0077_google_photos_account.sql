-- Which Google account Google Photos is connected to, shown in Settings (Google's Ambient UX
-- guidelines): the name and email from the sign-in's ID token. Not a secret; gone on disconnect.
ALTER TABLE google_photos ADD COLUMN account_name TEXT;
ALTER TABLE google_photos ADD COLUMN account_email TEXT;
