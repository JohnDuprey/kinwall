-- Who a paired device belongs to, set by an admin when approving it (Settings -> Access -> Displays).
-- NULL = paired before this existed: the device picks its own "Show only" member, as before.
-- 'shared' = the whole family (locked, no pin); anything else = a members.id the device is pinned to.
ALTER TABLE api_keys ADD COLUMN owner TEXT;
