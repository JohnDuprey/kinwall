-- Indexes only, no data changes. Hosted pays per SQLite row read, and on 2026-11-06 a family hit
-- the free tier's daily cap. Each index covers just the rows a frequent query needs:
-- a child's live chores (routine mode, polled by the child's iPhone),
CREATE INDEX IF NOT EXISTS idx_chores_member_live ON chores(member_id) WHERE active = 1 AND archived = 0;
-- medicine notes still to seal and reading entries still to shelve (both at every server start),
CREATE INDEX IF NOT EXISTS idx_notifications_unsealed_medication ON notifications(id) WHERE kind = 'medication' AND substr(title, 1, 7) != 'enc:v1:';
CREATE INDEX IF NOT EXISTS idx_tracker_entries_unshelved ON tracker_entries(kind, created_at, id) WHERE kind = 'reading' AND json_extract(data, '$.bookId') IS NULL AND title IS NOT NULL;
-- and announcements not yet expired (the Board's poll).
CREATE INDEX IF NOT EXISTS idx_announcements_expires ON announcements(expires_at);
