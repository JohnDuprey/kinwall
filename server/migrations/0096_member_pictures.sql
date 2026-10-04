-- Profile pictures: a member's picture is a small square crop (the web app makes a 256 px WebP),
-- stored as a photo row with avatar = 1 and family = 0 (so it's off the Photos page, the Board and
-- the screensaver) and member_id = whose it is; members.picture_id points at it. It travels in the
-- photo zip and is deleted with the member. source_id: the album photo it was cropped from, if any
-- (a reference, not a second copy of the original).
ALTER TABLE photos ADD COLUMN avatar INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN source_id TEXT;
ALTER TABLE members ADD COLUMN picture_id TEXT;
