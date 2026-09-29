-- Google Photos can also connect with the family's Google Calendar web client (routes/google-photos.ts):
-- which sign-in made the tokens, so they refresh with the same client, and the consent link while
-- signing in that way.
ALTER TABLE google_photos ADD COLUMN flow TEXT NOT NULL DEFAULT 'device';
ALTER TABLE google_photos ADD COLUMN auth_url TEXT;
