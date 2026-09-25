-- Content fingerprint (sha256 of the feed with DTSTAMP/UID lines stripped) so a feed that
-- regenerates UID/DTSTAMP on every fetch (and ignores If-None-Match) still short-circuits to
-- "unchanged" instead of a full parse + DB replace on every sync tick.
ALTER TABLE calendars ADD COLUMN content_hash TEXT;
