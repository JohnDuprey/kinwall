-- Reward splitting (routes/rewards.ts): several people chip in for one reward. shares is a JSON
-- array [{ "memberId", "points" }] adding up to cost, the asker (member_id) first; NULL = member_id
-- pays it all, as before. Each share is its own point_entries row (reason 'reward', ref = the
-- redemption). New column only, no backfill.
ALTER TABLE reward_redemptions ADD COLUMN shares TEXT;
