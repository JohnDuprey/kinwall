-- A paired device (everyday access) is never a grown-up's (auth.ts validOwner): whoever approves a
-- pairing code mustn't get a key that opens a grown-up's private journal. Ones already paired as a
-- grown-up's keep their key and owner (nothing is removed or re-assigned quietly), but lose the
-- 'grownup' kind: they show under "Needs a fix" in Settings -> Access for a parent to change, and
-- journal-privacy.ts journalOwner never opens a private journal for them.
UPDATE api_keys SET device_kind = NULL WHERE scope = 'display' AND device_kind = 'grownup';
