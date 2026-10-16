-- A member's display language ('en', 'de'): the app shows itself in it on their own devices, and
-- activities use it for them. NULL (everyone to start) follows the device, then the family's
-- language (the 'language' settings row; English until a parent picks one). Adds a column only.
ALTER TABLE members ADD COLUMN language TEXT;
