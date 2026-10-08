-- Who a list item is for ("Watch band" for Maya): a JSON array of member ids like lists.member_ids;
-- [] = for everyone. Separate from member_id, which is who an item is assigned to.
ALTER TABLE list_items ADD COLUMN for_member_ids TEXT NOT NULL DEFAULT '[]';
