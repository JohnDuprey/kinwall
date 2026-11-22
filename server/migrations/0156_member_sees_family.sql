-- Whether someone's own everyday devices (a paired tablet, the phone app's everyday sign-in) show the
-- whole family or only them. Either way it's still their device: credited as them, acting only for
-- them, their private things stay private. Set by a parent. Grown-ups start on (nothing changes for
-- them), kids start off.
ALTER TABLE members ADD COLUMN sees_family INTEGER NOT NULL DEFAULT 0;
UPDATE members SET sees_family = 1 WHERE grown_up = 1;
