-- Additive only. No existing family rows are backfilled or changed.
CREATE TABLE IF NOT EXISTS weekly_plans (
  week_start TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft TEXT NOT NULL DEFAULT '{"dinners":[],"prep":[]}',
  applied TEXT NOT NULL DEFAULT '{"dinners":{},"prep":{}}'
);
CREATE TABLE IF NOT EXISTS weekly_plan_applies (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL REFERENCES weekly_plans(week_start) ON DELETE CASCADE,
  request TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_applies_week ON weekly_plan_applies(week_start);
-- A review token changes in the same transaction as its source data, including sync/import.
CREATE TABLE IF NOT EXISTS weekly_plan_source (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO weekly_plan_source VALUES (1, 0);
CREATE TRIGGER IF NOT EXISTS planning_events_insert AFTER INSERT ON events BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_events_update AFTER UPDATE OF calendar_id, title, start, end, all_day, rrule, member_ids, series_id, category_id ON events WHEN NEW.calendar_id IS NOT OLD.calendar_id OR NEW.title IS NOT OLD.title OR NEW.start IS NOT OLD.start OR NEW.end IS NOT OLD.end OR NEW.all_day IS NOT OLD.all_day OR NEW.rrule IS NOT OLD.rrule OR NEW.member_ids IS NOT OLD.member_ids OR NEW.series_id IS NOT OLD.series_id OR NEW.category_id IS NOT OLD.category_id BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_events_delete AFTER DELETE ON events BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_calendars_insert AFTER INSERT ON calendars BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_calendars_update AFTER UPDATE OF name, color, member_ids, enabled, filter, category_id, kind ON calendars WHEN NEW.name IS NOT OLD.name OR NEW.color IS NOT OLD.color OR NEW.member_ids IS NOT OLD.member_ids OR NEW.enabled IS NOT OLD.enabled OR NEW.filter IS NOT OLD.filter OR NEW.category_id IS NOT OLD.category_id OR NEW.kind IS NOT OLD.kind BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_calendars_delete AFTER DELETE ON calendars BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_hidden_insert AFTER INSERT ON event_hidden BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_hidden_update AFTER UPDATE ON event_hidden BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_hidden_delete AFTER DELETE ON event_hidden BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_member_overrides_insert AFTER INSERT ON event_member_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_member_overrides_update AFTER UPDATE ON event_member_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_member_overrides_delete AFTER DELETE ON event_member_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_series_member_overrides_insert AFTER INSERT ON event_series_member_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_series_member_overrides_update AFTER UPDATE ON event_series_member_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_series_member_overrides_delete AFTER DELETE ON event_series_member_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_category_overrides_insert AFTER INSERT ON event_category_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_category_overrides_update AFTER UPDATE ON event_category_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_category_overrides_delete AFTER DELETE ON event_category_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_series_category_overrides_insert AFTER INSERT ON event_series_category_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_series_category_overrides_update AFTER UPDATE ON event_series_category_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_event_series_category_overrides_delete AFTER DELETE ON event_series_category_overrides BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_members_insert AFTER INSERT ON members BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_members_update AFTER UPDATE ON members BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_members_delete AFTER DELETE ON members BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_meals_insert AFTER INSERT ON meals BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_meals_update AFTER UPDATE ON meals BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_meals_delete AFTER DELETE ON meals BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_recipes_insert AFTER INSERT ON recipes BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_recipes_update AFTER UPDATE ON recipes BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_recipes_delete AFTER DELETE ON recipes BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_recipe_ingredients_insert AFTER INSERT ON recipe_ingredients BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_recipe_ingredients_update AFTER UPDATE ON recipe_ingredients BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_recipe_ingredients_delete AFTER DELETE ON recipe_ingredients BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_lists_insert AFTER INSERT ON lists BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_lists_update AFTER UPDATE ON lists BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_lists_delete AFTER DELETE ON lists BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_list_items_insert AFTER INSERT ON list_items BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_list_items_update AFTER UPDATE ON list_items BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_list_items_delete AFTER DELETE ON list_items BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_jobs_insert AFTER INSERT ON upkeep_jobs BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_jobs_update AFTER UPDATE ON upkeep_jobs BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_jobs_delete AFTER DELETE ON upkeep_jobs BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_things_insert AFTER INSERT ON upkeep_things BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_things_update AFTER UPDATE ON upkeep_things BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_things_delete AFTER DELETE ON upkeep_things BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_log_insert AFTER INSERT ON upkeep_log BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_log_update AFTER UPDATE ON upkeep_log BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_upkeep_log_delete AFTER DELETE ON upkeep_log BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_settings_insert AFTER INSERT ON settings WHEN NEW.key IN ('timezone','weekStart','features') BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_settings_update AFTER UPDATE ON settings WHEN NEW.key IN ('timezone','weekStart','features') BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_settings_delete AFTER DELETE ON settings WHEN OLD.key IN ('timezone','weekStart','features') BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_categories_insert AFTER INSERT ON categories BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_categories_update AFTER UPDATE ON categories BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS planning_categories_delete AFTER DELETE ON categories BEGIN UPDATE weekly_plan_source SET version = version + 1 WHERE id = 1; END;
