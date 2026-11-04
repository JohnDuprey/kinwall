-- Personal choices only; existing events remain unfollowed. No family-data backfill.
-- No event FK: synced event rows can be replaced; their deterministic IDs survive a resync.
CREATE TABLE event_follows (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 target TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('occurrence','series')),
 occurrence_start TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1,
 minutes INTEGER NOT NULL DEFAULT 15,
 show_now TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(member_id,calendar_id,target,scope,occurrence_start)
);
