-- Hosted is billed per SQLite row read. lists.items_rev goes up on every change to a list's items or
-- their steps (triggers, so no write path can miss it): sync clients (Home Assistant) compare it from
-- GET /api/lists and refetch only the lists that changed. An item moved between lists bumps both.
ALTER TABLE lists ADD COLUMN items_rev INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER list_items_rev_insert AFTER INSERT ON list_items BEGIN
  UPDATE lists SET items_rev = items_rev + 1 WHERE id = NEW.list_id;
END;
CREATE TRIGGER list_items_rev_update AFTER UPDATE ON list_items BEGIN
  UPDATE lists SET items_rev = items_rev + 1 WHERE id IN (OLD.list_id, NEW.list_id);
END;
CREATE TRIGGER list_items_rev_delete AFTER DELETE ON list_items BEGIN
  UPDATE lists SET items_rev = items_rev + 1 WHERE id = OLD.list_id;
END;
CREATE TRIGGER list_item_steps_rev_insert AFTER INSERT ON list_item_steps BEGIN
  UPDATE lists SET items_rev = items_rev + 1 WHERE id = (SELECT list_id FROM list_items WHERE id = NEW.item_id);
END;
CREATE TRIGGER list_item_steps_rev_update AFTER UPDATE ON list_item_steps BEGIN
  UPDATE lists SET items_rev = items_rev + 1 WHERE id = (SELECT list_id FROM list_items WHERE id = NEW.item_id);
END;
CREATE TRIGGER list_item_steps_rev_delete AFTER DELETE ON list_item_steps BEGIN
  UPDATE lists SET items_rev = items_rev + 1 WHERE id = (SELECT list_id FROM list_items WHERE id = OLD.item_id);
END;
-- The board and snapshots show open items that are due or high priority: this holds just those, so
-- they stop reading every item (done ones included). Its WHERE must match FLAGGED_OPEN in
-- routes/lists.ts exactly, or SQLite won't use it.
CREATE INDEX idx_list_items_flagged_open ON list_items(member_id) WHERE done = 0 AND (due_date IS NOT NULL OR priority IN ('high', 'urgent'));
