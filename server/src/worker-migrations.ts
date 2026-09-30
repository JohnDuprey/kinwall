// Every migration, bundled as text by wrangler (.sql files are Text modules). Keep in sync with
// server/migrations/ - test/migrate.test.ts fails if a file is missing here.
import type { Migration } from './migrate.ts';
import m0001 from '../migrations/0001_init.sql';
import m0002 from '../migrations/0002_security.sql';
import m0003 from '../migrations/0003_ics_fingerprint.sql';
import m0004 from '../migrations/0004_pairings.sql';
import m0005 from '../migrations/0005_passkeys.sql';
import m0006 from '../migrations/0006_event_member_overrides.sql';
import m0007 from '../migrations/0007_series_member_overrides.sql';
import m0008 from '../migrations/0008_calendar_multi_member.sql';
import m0009 from '../migrations/0009_calendar_kind_from_account.sql';
import m0010 from '../migrations/0010_lists.sql';
import m0011 from '../migrations/0011_categories.sql';
import m0012 from '../migrations/0012_sort_order.sql';
import m0013 from '../migrations/0013_push.sql';
import m0014 from '../migrations/0014_oauth.sql';
import m0015 from '../migrations/0015_pairings_ip.sql';
import m0016 from '../migrations/0016_host_events_rate_limits.sql';
import m0017 from '../migrations/0017_recovery_codes.sql';
import m0018 from '../migrations/0018_list_item_event.sql';
import m0019 from '../migrations/0019_travel_time.sql';
import m0020 from '../migrations/0020_points_awarded.sql';
import m0021 from '../migrations/0021_list_item_priority_steps.sql';
import m0022 from '../migrations/0022_notifications.sql';
import m0023 from '../migrations/0023_list_sort_priority_levels.sql';
import m0024 from '../migrations/0024_notes.sql';
import m0025 from '../migrations/0025_stickers.sql';
import m0026 from '../migrations/0026_snapshot.sql';
import m0027 from '../migrations/0027_chore_checklist.sql';
import m0028 from '../migrations/0028_photos.sql';
import m0029 from '../migrations/0029_device_owner.sql';
import m0030 from '../migrations/0030_list_notification_links.sql';
import m0031 from '../migrations/0031_trackers.sql';
import m0032 from '../migrations/0032_plugins.sql';
import m0033 from '../migrations/0033_activity_chores.sql';
import m0034 from '../migrations/0034_meals.sql';
import m0035 from '../migrations/0035_oauth_owner.sql';
import m0036 from '../migrations/0036_calendar_display_edit.sql';
import m0037 from '../migrations/0037_member_transitions.sql';
import m0038 from '../migrations/0038_chore_approval.sql';
import m0039 from '../migrations/0039_rewards.sql';
import m0040 from '../migrations/0040_groceries.sql';
import m0041 from '../migrations/0041_item_names.sql';
import m0042 from '../migrations/0042_recipe_import.sql';
import m0043 from '../migrations/0043_recipe_times.sql';
import m0044 from '../migrations/0044_meal_eaters.sql';
import m0045 from '../migrations/0045_meal_calendar_event.sql';
import m0046 from '../migrations/0046_recipe_steps.sql';
import m0047 from '../migrations/0047_recipe_ratings.sql';
import m0048 from '../migrations/0048_event_sync_source.sql';
import m0049 from '../migrations/0049_recipe_shares.sql';
import m0050 from '../migrations/0050_chore_archive.sql';
import m0051 from '../migrations/0051_member_grown_up.sql';
import m0052 from '../migrations/0052_contacts.sql';
import m0053 from '../migrations/0053_check_ins.sql';
import m0054 from '../migrations/0054_temp_checks.sql';
import m0055 from '../migrations/0055_goal_journal.sql';
import m0056 from '../migrations/0056_medications.sql';
import m0057 from '../migrations/0057_recipe_basics.sql';
import m0058 from '../migrations/0058_battery_drained.sql';
import m0059 from '../migrations/0059_live_activity_tokens.sql';
import m0060 from '../migrations/0060_member_nudges.sql';
import m0061 from '../migrations/0061_google_photos.sql';
import m0062 from '../migrations/0062_google_photos_web.sql';
import m0063 from '../migrations/0063_private_journals.sql';
import m0064 from '../migrations/0064_oauth_device_app.sql';
import m0065 from '../migrations/0065_device_kinds.sql';
import m0066 from '../migrations/0066_no_grownup_paired_devices.sql';

export const MIGRATIONS: Migration[] = [
  { name: '0001_init.sql', sql: m0001 },
  { name: '0002_security.sql', sql: m0002 },
  { name: '0003_ics_fingerprint.sql', sql: m0003 },
  { name: '0004_pairings.sql', sql: m0004 },
  { name: '0005_passkeys.sql', sql: m0005 },
  { name: '0006_event_member_overrides.sql', sql: m0006 },
  { name: '0007_series_member_overrides.sql', sql: m0007 },
  { name: '0008_calendar_multi_member.sql', sql: m0008 },
  { name: '0009_calendar_kind_from_account.sql', sql: m0009 },
  { name: '0010_lists.sql', sql: m0010 },
  { name: '0011_categories.sql', sql: m0011 },
  { name: '0012_sort_order.sql', sql: m0012 },
  { name: '0013_push.sql', sql: m0013 },
  { name: '0014_oauth.sql', sql: m0014 },
  { name: '0015_pairings_ip.sql', sql: m0015 },
  { name: '0016_host_events_rate_limits.sql', sql: m0016 },
  { name: '0017_recovery_codes.sql', sql: m0017 },
  { name: '0018_list_item_event.sql', sql: m0018 },
  { name: '0019_travel_time.sql', sql: m0019 },
  { name: '0020_points_awarded.sql', sql: m0020 },
  { name: '0021_list_item_priority_steps.sql', sql: m0021 },
  { name: '0022_notifications.sql', sql: m0022 },
  { name: '0023_list_sort_priority_levels.sql', sql: m0023 },
  { name: '0024_notes.sql', sql: m0024 },
  { name: '0025_stickers.sql', sql: m0025 },
  { name: '0026_snapshot.sql', sql: m0026 },
  { name: '0027_chore_checklist.sql', sql: m0027 },
  { name: '0028_photos.sql', sql: m0028 },
  { name: '0029_device_owner.sql', sql: m0029 },
  { name: '0030_list_notification_links.sql', sql: m0030 },
  { name: '0031_trackers.sql', sql: m0031 },
  { name: '0032_plugins.sql', sql: m0032 },
  { name: '0033_activity_chores.sql', sql: m0033 },
  { name: '0034_meals.sql', sql: m0034 },
  { name: '0035_oauth_owner.sql', sql: m0035 },
  { name: '0036_calendar_display_edit.sql', sql: m0036 },
  { name: '0037_member_transitions.sql', sql: m0037 },
  { name: '0038_chore_approval.sql', sql: m0038 },
  { name: '0039_rewards.sql', sql: m0039 },
  { name: '0040_groceries.sql', sql: m0040 },
  { name: '0041_item_names.sql', sql: m0041 },
  { name: '0042_recipe_import.sql', sql: m0042 },
  { name: '0043_recipe_times.sql', sql: m0043 },
  { name: '0044_meal_eaters.sql', sql: m0044 },
  { name: '0045_meal_calendar_event.sql', sql: m0045 },
  { name: '0046_recipe_steps.sql', sql: m0046 },
  { name: '0047_recipe_ratings.sql', sql: m0047 },
  { name: '0048_event_sync_source.sql', sql: m0048 },
  { name: '0049_recipe_shares.sql', sql: m0049 },
  { name: '0050_chore_archive.sql', sql: m0050 },
  { name: '0051_member_grown_up.sql', sql: m0051 },
  { name: '0052_contacts.sql', sql: m0052 },
  { name: '0053_check_ins.sql', sql: m0053 },
  { name: '0054_temp_checks.sql', sql: m0054 },
  { name: '0055_goal_journal.sql', sql: m0055 },
  { name: '0056_medications.sql', sql: m0056 },
  { name: '0057_recipe_basics.sql', sql: m0057 },
  { name: '0058_battery_drained.sql', sql: m0058 },
  { name: '0059_live_activity_tokens.sql', sql: m0059 },
  { name: '0060_member_nudges.sql', sql: m0060 },
  { name: '0061_google_photos.sql', sql: m0061 },
  { name: '0062_google_photos_web.sql', sql: m0062 },
  { name: '0063_private_journals.sql', sql: m0063 },
  { name: '0064_oauth_device_app.sql', sql: m0064 },
  { name: '0065_device_kinds.sql', sql: m0065 },
  { name: '0066_no_grownup_paired_devices.sql', sql: m0066 },
];
