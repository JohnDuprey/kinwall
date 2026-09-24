-- Key scopes ('admin' full access, 'display' restricted per the allow-list in src/auth.ts).
ALTER TABLE api_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'admin';

-- Chunked sync cursor (JSON: { farIndex, farSyncedAt }) so a calendar's far-future slices
-- rotate across ticks instead of refreshing the whole window every time.
ALTER TABLE calendars ADD COLUMN sync_cursor TEXT;

-- ICS conditional GET (If-None-Match / If-Modified-Since) so an unchanged feed costs one
-- cheap round trip instead of a full parse + replace.
ALTER TABLE calendars ADD COLUMN etag TEXT;
ALTER TABLE calendars ADD COLUMN last_modified TEXT;
