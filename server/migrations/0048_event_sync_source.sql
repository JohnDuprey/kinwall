-- Events an automation pushes into a local calendar (PUT /api/calendars/{id}/events/sync): the
-- source that owns them (e.g. 'ha:hellofresh') plus the source's own id in external_id, which
-- local events otherwise leave NULL. A sync only ever touches rows of its own source; NULL = made
-- in Kinwall.
ALTER TABLE events ADD COLUMN sync_source TEXT;
CREATE UNIQUE INDEX idx_events_sync_source ON events(calendar_id, sync_source, external_id) WHERE sync_source IS NOT NULL;
