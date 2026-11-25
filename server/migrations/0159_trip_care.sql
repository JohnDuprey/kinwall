-- Empty additive table only; no backfill or changes to existing trip/family records.
CREATE TABLE trip_care (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE INDEX idx_trip_care_trip ON trip_care(trip_id);
