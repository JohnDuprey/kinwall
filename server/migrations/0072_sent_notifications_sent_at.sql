-- notify.ts prunes sent_notifications older than 3 days on every tick (every 5 minutes on hosted).
-- Without an index that DELETE read the whole table each time; hosted is billed per row read.
CREATE INDEX idx_sent_notifications_sent_at ON sent_notifications(sent_at);
