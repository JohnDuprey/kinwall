-- A calendar can now be assigned to multiple members. member_ids is the source of truth from
-- here on; member_id (0001) stays for compatibility (nothing writes it anymore) but is
-- backfilled here so old rows still resolve.
ALTER TABLE calendars ADD COLUMN member_ids TEXT NOT NULL DEFAULT '[]';
UPDATE calendars SET member_ids = json_array(member_id) WHERE member_id IS NOT NULL;
